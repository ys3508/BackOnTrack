import { createAnthropic } from "@ai-sdk/anthropic"
import { createGateway } from "@ai-sdk/gateway"
import type { LanguageModel } from "ai"

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"
const DEFAULT_GATEWAY_MODEL = "anthropic/claude-haiku-5-5"

export type LiveConfig = {
  provider: "anthropic" | "gateway"
  modelId: string
  apiKey: string
}

/** Server-only. Live AI is enabled only when an API key is present. */
export function getLiveConfig(): LiveConfig | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim()
  const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim()
  const modelOverride = process.env.AI_MODEL?.trim()

  if (anthropicKey) {
    return {
      provider: "anthropic",
      modelId: modelOverride || DEFAULT_ANTHROPIC_MODEL,
      apiKey: anthropicKey,
    }
  }
  if (gatewayKey) {
    return {
      provider: "gateway",
      modelId: modelOverride || DEFAULT_GATEWAY_MODEL,
      apiKey: gatewayKey,
    }
  }
  return null
}

export function getLiveModel(config: LiveConfig): LanguageModel {
  return config.provider === "anthropic"
    ? createAnthropic({ apiKey: config.apiKey })(config.modelId)
    : createGateway({ apiKey: config.apiKey })(config.modelId)
}
