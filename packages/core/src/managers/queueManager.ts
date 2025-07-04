import { Context, Query } from "koishi";

import { DATABASE_NAME } from "../database";
import { ChatMessage } from "../models/ChatMessage";

export class QueueManager {
  constructor(private ctx: Context) {}

  async getQueue(channelId: string, limit?: number): Promise<ChatMessage[]> {
    let chatMessages = await this.ctx.database
      .select(DATABASE_NAME)
      .where({ channelId })
      .orderBy("sendTime", "desc")
      .limit(limit || 100)
      .execute();
    return chatMessages.reverse();
  }

  async getMixedQueue(channels: Set<string>, limit?: number): Promise<ChatMessage[]> {
    const selectQuery = async (query: Query) => {
      let select = this.ctx.database
        .select(DATABASE_NAME)
        .where(query)
        .orderBy("sendTime", "desc")
      if (limit) select = select.limit(limit);
      let chatMessages = await select.execute();
      return chatMessages.reverse();
    };

    if (channels.has("all")) {
      return selectQuery({
        $or: [
          { channelType: "guild" },
          { channelId: { $in: Array.from(channels) } },
        ],
      });
    }

    if (channels.has("private:all")) {
      return selectQuery({
        $or: [
          { channelType: "private" },
          { channelId: { $in: Array.from(channels) } },
        ],
      });
    }

    return selectQuery({
      channelId: { $in: Array.from(channels) },
    });
  }

  // 消息入队
  public async enqueue(chatMessage: ChatMessage): Promise<void> {
    try {
      await this.ctx.database.create(DATABASE_NAME, chatMessage);
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        // 更新已存在的记录
        const { messageId, ...updateData } = chatMessage;
        this.ctx.logger.warn(`存在重复的数据库条目：${messageId}，先前的数据将被覆盖`)
        await this.ctx.database.set(DATABASE_NAME, { messageId }, updateData);
      } else {
        throw error; // 重新抛出其他类型的错误
      }
    }
  }

  public async clearBySenderId(senderId: string): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      "sender.id": senderId,
    });
    return result.removed > 0;
  }

  public async clearChannel(channelId: string): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      channelId,
    });
    return result.removed > 0;
  }

  public async clearAll(): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      channelId: { $regex: /^(?!.*private:[a-zA-Z0-9_]+).*$/ },
    });
    return result.removed > 0;
  }

  public async clearPrivateAll(): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      channelId: { $regex: /private:[a-zA-Z0-9_]+/ },
    });
    return result.removed > 0;
  }

  public async findChannelByMessageId(messageId: string): Promise<string> {
    const messages = await this.ctx.database
      .select(DATABASE_NAME)
      .where({ messageId })
      .execute();
    if (messages.length == 0) return null;
    return messages[0].channelId;
  }
}
