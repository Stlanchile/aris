import { Context } from "koishi";
import { BaseAdapter } from "../adapters/base";
import { AssistantMessage, SystemMessage, UserMessage } from "../adapters/creators/component";
import { Config } from "../config";
import { calculateCosineSimilarity, EmbeddingBase } from "../embeddings/base";
import { EnabledEmbeddingConfig } from "../embeddings/config";
import { getAdapter, getEmbedding } from "./factory";

export class ResponseVerifier {
  private previousResponse = new Map<string, string>();
  private config: Config;
  private client: EmbeddingBase | BaseAdapter;

  constructor(ctx: Context, config: Config) {
    this.config = config;
    if (this.config.Verifier.Method.Type === "Embedding") {
      if (this.config.Embedding.Enabled) {
        this.client = getEmbedding(config.Embedding as EnabledEmbeddingConfig);
      } else {
        ctx.logger.error("Embedding 模型未启用，相似度验证已被禁用");
        this.config.Verifier.Enabled = false;
      }
    } else {
      this.client = getAdapter(
        this.config.Verifier.Method,
        this.config.Parameters
      );
    }
  }

  setPreviousResponse(channelId, response) {
    this.previousResponse.set(channelId, response);
  }

  async verifyResponse(channelId, currentResponse: string): Promise<boolean> {
    if (!this.config.Verifier.Enabled || !this.previousResponse.has(channelId)) {
      this.setPreviousResponse(channelId, currentResponse);
      return true; // Allow if verification is disabled or no previous response
    }

    try {
      if (this.client instanceof EmbeddingBase) {
        // 使用 embedding 模型验证相似度
        const previousEmbedding = await this.client._embed(this.previousResponse.get(channelId));

        const currentEmbedding = await this.client._embed(currentResponse);

        const similarityScore = calculateCosineSimilarity(
          previousEmbedding,
          currentEmbedding
        );

        return similarityScore <= this.config.Verifier.SimilarityThreshold;
      } else {
        const sysPrompt = `请分析以下两段文本的相似度，返回一个0到1之间的数字，精确到小数点后两位。
0表示完全不同，1表示完全相同。只返回数字，不要有任何其他文字。

判断标准：
1. 考虑语义相似度，而不仅仅是字面相似度
2. 考虑表达的核心意思是否相近
3. 如果两段文本表达了相同的情感或态度，认为相似度较高

如果你理解了我的需求，请回复“Resolve OK”，我将在这之后给你提供要分析相似度的两个句子, 分别用 'A:' 和 'B:' 标识。`;
        const promptInput = `A: ${this.previousResponse.get(channelId)}\nB: ${currentResponse}`;
        const response = await this.client.chat(
          [
            SystemMessage(sysPrompt),
            AssistantMessage("Resolve OK"),
            UserMessage(promptInput)
          ],
          null,
          this.config.Debug.DebugAsInfo
        );

        const similarityScore = this.extractSimilarityScore(response);
        return similarityScore <= this.config.Verifier.SimilarityThreshold;
      }
    } catch (error) {
      console.error("Verification failed:", error);
      return true;
    }
  }

  private extractSimilarityScore(response: any): number {
    let score: number;

    if (typeof response === "string") {
      const match = response.match(/\d+(\.\d+)?/);
      score = match ? parseFloat(match[0]) : 0;
    } else if (response.choices && response.choices[0]?.message?.content) {
      const match = response.choices[0].message.content.match(/\d+(\.\d+)?/);
      score = match ? parseFloat(match[0]) : 0;
    } else {
      score = 0;
    }

    return Math.min(Math.max(score, 0), 1); // Ensure score is between 0 and 1
  }
}
