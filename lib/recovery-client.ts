import { demoAnalysis, demoNextStep } from "@/lib/demo/engine"
import type {
  Analysis,
  Intake,
  NextStepRequest,
  NextStepResult,
} from "@/lib/schemas"
import type { Source } from "@/lib/session"

export class RecoveryRequestError extends Error {}

async function postRecovery<T>(body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch("/api/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new RecoveryRequestError(
      "Could not reach the server. Check your connection and try again."
    )
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new RecoveryRequestError(
      data?.error?.message ?? "Something went wrong. Please try again."
    )
  }
  return data as T
}

/** Demo Mode runs entirely in the browser and sends nothing to any server. */
export async function requestAnalysis(
  mode: Source,
  intake: Intake
): Promise<Analysis> {
  if (mode === "demo") return demoAnalysis(intake)
  const { analysis } = await postRecovery<{ analysis: Analysis }>({
    stage: "analyze",
    intake,
  })
  return analysis
}

export async function requestNextStep(
  mode: Source,
  request: NextStepRequest
): Promise<NextStepResult> {
  if (mode === "demo") return demoNextStep(request)
  return postRecovery<NextStepResult>(request)
}

export async function fetchLiveStatus(): Promise<{
  live: boolean
  model: string | null
}> {
  try {
    const response = await fetch("/api/recovery")
    if (!response.ok) return { live: false, model: null }
    return await response.json()
  } catch {
    return { live: false, model: null }
  }
}
