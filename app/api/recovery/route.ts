import { getLiveConfig, getLiveModel } from "@/lib/ai/provider"
import { generateCasePlan } from "@/lib/ai/case-assist"
import { checkRateLimit } from "@/lib/ai/rate-limit"
import { generateAnalysis, generateNextStep } from "@/lib/ai/recovery"
import {
  generateStepHelp,
  generateTaskBreakdown,
  generateWorkspaceSetup,
  generateWritingAssist,
} from "@/lib/ai/task-assist"
import { generateTaskRecovery } from "@/lib/ai/task-recovery"
import { RecoveryRequestSchema } from "@/lib/schemas"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 64 * 1024

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

/** Tells the browser whether live AI is available. Never returns the key. */
export function GET() {
  const config = getLiveConfig()
  return Response.json({
    live: Boolean(config),
    model: config?.modelId ?? null,
  })
}

export async function POST(request: Request) {
  const config = getLiveConfig()
  if (!config) {
    return fail(
      503,
      "not_configured",
      "Live AI is not configured on this server. You can use Demo Mode instead."
    )
  }

  const clientId =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  if (!checkRateLimit(clientId)) {
    return fail(
      429,
      "rate_limited",
      "Too many requests for now. Please wait a few minutes, or use Demo Mode."
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return fail(413, "too_large", "That request is too large.")
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fail(400, "invalid_input", "The request could not be read.")
  }

  const parsed = RecoveryRequestSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      400,
      "invalid_input",
      parsed.error.issues[0]?.message ?? "The request was not valid."
    )
  }

  try {
    const model = getLiveModel(config)
    const data = parsed.data
    if (data.stage === "analyze") {
      const analysis = await generateAnalysis(model, data.intake)
      return Response.json({ analysis, model: config.modelId })
    }
    if (data.stage === "recovery-case") {
      const result = await generateCasePlan(model, data)
      return Response.json({ ...result, model: config.modelId })
    }
    if (data.stage === "step-help") {
      const result = await generateStepHelp(model, data)
      return Response.json({ ...result, model: config.modelId })
    }
    if (data.stage === "workspace-setup") {
      const result = await generateWorkspaceSetup(model, data)
      return Response.json({ ...result, model: config.modelId })
    }
    if (data.stage === "writing-assist") {
      const result = await generateWritingAssist(model, data)
      return Response.json({ ...result, model: config.modelId })
    }
    if (data.stage === "task-breakdown") {
      const result = await generateTaskBreakdown(model, data)
      return Response.json({ ...result, model: config.modelId })
    }
    if (data.stage === "task-recovery") {
      const result = await generateTaskRecovery(model, data)
      return Response.json({ ...result, model: config.modelId })
    }
    const result = await generateNextStep(model, data)
    return Response.json({ ...result, model: config.modelId })
  } catch (error) {
    // Log only the error type: request text may be personal, and provider
    // errors may echo request details.
    console.error(
      "recovery_ai_error",
      error instanceof Error ? error.name : "unknown"
    )
    return fail(
      502,
      "ai_unavailable",
      "The AI service could not complete this request. Nothing you entered was lost."
    )
  }
}
