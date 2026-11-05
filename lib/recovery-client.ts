import { demoAnalysis, demoNextStep } from "@/lib/demo/engine"
import { demoWritingAssist } from "@/lib/recovery/demo-assist"
import { demoBreakdown } from "@/lib/recovery/demo-breakdown"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import { demoStepHelp, demoWorkspaceSetup } from "@/lib/recovery/demo-setup"
import type {
  Analysis,
  Intake,
  NextStepRequest,
  NextStepResult,
  StepHelpRequest,
  StepHelpResult,
  TaskBreakdownRequest,
  TaskBreakdownResult,
  TaskRecoveryRequest,
  TaskRecoveryResult,
  WorkspaceSetupRequest,
  WorkspaceSetupResult,
  WritingAssistRequest,
  WritingAssistResult,
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

export async function requestTaskRecovery(
  mode: Source,
  request: TaskRecoveryRequest
): Promise<TaskRecoveryResult> {
  if (mode === "demo") return demoTaskRecovery(request)
  return postRecovery<TaskRecoveryResult>(request)
}

export async function requestBreakdown(
  mode: Source,
  request: TaskBreakdownRequest
): Promise<TaskBreakdownResult> {
  if (mode === "demo") return demoBreakdown(request)
  return postRecovery<TaskBreakdownResult>(request)
}

export async function requestWritingAssist(
  mode: Source,
  request: WritingAssistRequest
): Promise<WritingAssistResult> {
  if (mode === "demo") return demoWritingAssist(request)
  return postRecovery<WritingAssistResult>(request)
}

export async function requestStepHelp(
  mode: Source,
  request: StepHelpRequest
): Promise<StepHelpResult> {
  if (mode === "demo") return demoStepHelp(request)
  return postRecovery<StepHelpResult>(request)
}

export async function requestWorkspaceSetup(
  mode: Source,
  request: WorkspaceSetupRequest
): Promise<WorkspaceSetupResult> {
  if (mode === "demo") return demoWorkspaceSetup(request)
  return postRecovery<WorkspaceSetupResult>(request)
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
