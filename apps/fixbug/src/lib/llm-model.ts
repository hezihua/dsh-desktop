import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";

export type LlmBackend = "openrouter" | "gateway" | "none";

export function getLlmBackend(): LlmBackend {
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  if (
    process.env.AI_GATEWAY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN
  ) {
    return "gateway";
  }
  return "none";
}

export function isLlmConfigured(): boolean {
  return getLlmBackend() !== "none";
}

/** 监控 Agent 使用的模型（OpenRouter 上为 provider/model 形式） */
export function getMonitorModelId(): string {
  if (process.env.MONITOR_AI_MODEL?.trim()) {
    return process.env.MONITOR_AI_MODEL.trim();
  }
  if (process.env.OPENROUTER_MODEL?.trim()) {
    return process.env.OPENROUTER_MODEL.trim();
  }
  // OpenRouter 默认国内常用：DeepSeek（可在 .env 改为 qwen / glm 等）
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return "deepseek/deepseek-chat";
  }
  return "openai/gpt-4o-mini";
}

export function resolveMonitorLanguageModel(): LanguageModel {
  const modelId = getMonitorModelId();

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const openrouter = createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer":
          process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:3000",
        // fetch 要求 header 值为 ByteString（仅 Latin-1）；勿用中文标题
        "X-Title":
          process.env.OPENROUTER_APP_TITLE?.trim() || "Infini Ops Agent",
      },
    });
    return openrouter(modelId);
  }

  return modelId;
}

/** 用官方设置里的模型做一次补全。未配置或调用失败时返回 null。 */
export async function completeOfficialModel(system: string, prompt: string): Promise<string | null> {
  if (!isLlmConfigured()) return null;
  try {
    const result = await generateText({
      model: resolveMonitorLanguageModel(),
      system,
      prompt: prompt.slice(0, 24_000),
    });
    const text = result.text?.trim();
    return text || null;
  } catch {
    return null;
  }
}
