import { generateText, NoObjectGeneratedError, Output } from "ai"
import type { LanguageModel } from "ai"

import {
  STEP_HELP_SYSTEM,
  TASK_BREAKDOWN_SYSTEM,
  WORKSPACE_SETUP_SYSTEM,
  WRITING_ASSIST_SYSTEM,
  stepHelpPrompt,
  taskBreakdownPrompt,
  workspaceSetupPrompt,
  writingAssistPrompt,
} from "@/lib/ai/prompts"
import { InvalidModelOutputError, similarity } from "@/lib/guards"
import { demoWritingAssist } from "@/lib/recovery/demo-assist"
import { demoBreakdown } from "@/lib/recovery/demo-breakdown"
import { demoStepHelp, demoWorkspaceSetup } from "@/lib/recovery/demo-setup"
import {
  StepHelpOutputSchema,
  TaskBreakdownOutputSchema,
  WorkspaceSetupOutputSchema,
  WritingAssistOutputSchema,
} from "@/lib/schemas"
import type {
  StepHelpOutput,
  StepHelpRequest,
  StepHelpResult,
  TaskBreakdownOutput,
  WorkspaceSetupOutput,
  WorkspaceSetupRequest,
  WorkspaceSetupResult,
  TaskBreakdownRequest,
  TaskBreakdownResult,
  WritingAssistRequest,
  WritingAssistResult,
} from "@/lib/schemas"

const MAX_OUTPUT_TOKENS = 4000
const REQUEST_TIMEOUT_MS = 25_000
export const VAGUE =
  /why (this|it) matters|your priorities|your motivation|reflect on|what matters most|^\s*(think about|consider|reflect|try to think)\b/i

export function isBadOutput(error: unknown) {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    error instanceof InvalidModelOutputError
  )
}

export function normalizeBreakdown(
  raw: TaskBreakdownOutput,
  request: TaskBreakdownRequest
): TaskBreakdownOutput {
  const finished = request.task.completedActions.map((item) =>
    item.replace(/^Completed:\s*/, "")
  )
  const seen = new Set<string>()
  const steps = raw.steps
    .map((step) => step.trim().slice(0, 200))
    .filter((step) => {
      const key = step.toLowerCase()
      if (!step || seen.has(key)) return false
      seen.add(key)
      return !finished.some((done) => similarity(step, done) >= 0.6)
    })
    .slice(0, 10)
  if (!steps.length) {
    throw new InvalidModelOutputError("The breakdown has no steps.")
  }
  return {
    note: raw.note.trim().slice(0, 300),
    steps,
    ambiguities: raw.ambiguities
      .map((item) => item.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 5),
  }
}

export function breakdownProblem(steps: string[]) {
  const vague = steps.find((step) => VAGUE.test(step))
  return vague ? `"${vague}" asks for reflection, not an action.` : null
}

/** A bad breakdown gets one corrected retry, then an honestly labeled template. */
export async function generateTaskBreakdown(
  model: LanguageModel,
  request: TaskBreakdownRequest
): Promise<TaskBreakdownResult> {
  let correction: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model,
        system: TASK_BREAKDOWN_SYSTEM,
        prompt: taskBreakdownPrompt(request, correction),
        output: Output.object({ schema: TaskBreakdownOutputSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const breakdown = normalizeBreakdown(output, request)
      const problem = breakdownProblem(breakdown.steps)
      if (!problem) return breakdown
      correction = problem
    } catch (error) {
      if (!isBadOutput(error) || attempt === 1) throw error
    }
  }
  return { ...demoBreakdown(request), usedFallback: true }
}

const CITATION =
  /\([A-Z][a-z]+(?: et al\.?| & [A-Z][a-z]+)?,? (?:19|20)\d{2}\)|\bdoi:|\bdoi\.org|\bhttps?:\/\/\S+/g

/** Finds citations and links that aren't in anything the user provided. */
export function inventedCitations(
  content: string,
  request: WritingAssistRequest
) {
  const provided = [
    request.task.instructions,
    request.task.document,
    request.task.description,
    request.selection,
    request.source,
  ].join(" ")
  return (content.match(CITATION) ?? []).filter(
    (found) => !provided.includes(found)
  )
}

/** A suggestion citing something invented gets a retry, then a labeled template. */
export async function generateWritingAssist(
  model: LanguageModel,
  request: WritingAssistRequest
): Promise<WritingAssistResult> {
  let correction: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model,
        system: WRITING_ASSIST_SYSTEM,
        prompt: writingAssistPrompt(request, correction),
        output: Output.object({ schema: WritingAssistOutputSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const content = output.content.trim().slice(0, 8000)
      if (!content) {
        throw new InvalidModelOutputError("The suggestion is empty.")
      }
      const invented = inventedCitations(content, request)
      if (!invented.length) {
        return {
          title: output.title.trim().slice(0, 120) || "Suggestion",
          note: output.note.trim().slice(0, 300),
          content,
        }
      }
      correction = `It cites sources that weren't provided: ${invented.join(", ")}. Remove them, and use [brackets] where a source would go.`
    } catch (error) {
      if (!isBadOutput(error) || attempt === 1) throw error
    }
  }
  return { ...demoWritingAssist(request), usedFallback: true }
}

function cleanStarter(starter: StepHelpOutput["starter"]) {
  const content = starter.content.trim().slice(0, 8000)
  if (!content) throw new InvalidModelOutputError("The starter is empty.")
  return {
    kind: starter.kind,
    title: starter.title.trim().slice(0, 120) || "A place to start",
    content,
  }
}

function cleanAction(action: string) {
  const text = action.trim().slice(0, 300)
  if (!text) throw new InvalidModelOutputError("There's no first action.")
  return text
}

const cleanList = (items: string[], max: number) =>
  items
    .map((item) => item.trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, max)

function startingProblem(
  action: string,
  starter: string,
  task: StepHelpRequest["task"]
) {
  if (VAGUE.test(action)) {
    return `"${action}" asks them to think, not act. Give a physical action.`
  }
  const provided = [task.instructions, task.document, task.description].join(
    " "
  )
  const invented = (starter.match(CITATION) ?? []).filter(
    (found) => !provided.includes(found)
  )
  return invented.length
    ? `It cites sources that weren't provided: ${invented.join(", ")}.`
    : null
}

export async function generateStepHelp(
  model: LanguageModel,
  request: StepHelpRequest
): Promise<StepHelpResult> {
  let correction: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model,
        system: STEP_HELP_SYSTEM,
        prompt: stepHelpPrompt(request, correction),
        output: Output.object({ schema: StepHelpOutputSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const result: StepHelpResult = {
        firstAction: cleanAction(output.firstAction),
        why: output.why.trim().slice(0, 300),
        starter: cleanStarter(output.starter),
        smallerSteps: cleanList(output.smallerSteps, 5),
        note: output.note.trim().slice(0, 300),
      }
      const problem = startingProblem(
        result.firstAction,
        result.starter.content,
        request.task
      )
      if (!problem) return result
      correction = problem
    } catch (error) {
      if (!isBadOutput(error) || attempt === 1) throw error
    }
  }
  return { ...demoStepHelp(request), usedFallback: true }
}

export async function generateWorkspaceSetup(
  model: LanguageModel,
  request: WorkspaceSetupRequest
): Promise<WorkspaceSetupResult> {
  let correction: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model,
        system: WORKSPACE_SETUP_SYSTEM,
        prompt: workspaceSetupPrompt(request, correction),
        output: Output.object({ schema: WorkspaceSetupOutputSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const clean: WorkspaceSetupOutput = {
        summary: output.summary.trim().slice(0, 300),
        deliverables: cleanList(output.deliverables, 8),
        // A date the text doesn't contain is invented, so it's dropped.
        datesMentioned: cleanList(output.datesMentioned, 5).filter((date) =>
          request.task.instructions.includes(date)
        ),
        dependencies: cleanList(output.dependencies, 6),
        unclear: cleanList(output.unclear, 5),
        steps: cleanList(output.steps, 10),
        firstAction: cleanAction(output.firstAction),
        starter: cleanStarter(output.starter),
        questions: cleanList(output.questions, 4),
        outline: cleanList(output.outline, 8),
        firstSection: {
          title:
            output.firstSection.title
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80) || "First section",
          content: output.firstSection.content.trim().slice(0, 4000),
        },
        note: output.note.trim().slice(0, 300),
      }
      if (!clean.steps.length) {
        throw new InvalidModelOutputError("The setup has no steps.")
      }
      const problem =
        breakdownProblem(clean.steps) ??
        startingProblem(
          clean.firstAction,
          [
            clean.starter.content,
            clean.firstSection.content,
            ...clean.questions,
            ...clean.outline,
          ].join("\n"),
          request.task
        )
      if (!problem) return clean
      correction = problem
    } catch (error) {
      if (!isBadOutput(error) || attempt === 1) throw error
    }
  }
  return { ...demoWorkspaceSetup(request), usedFallback: true }
}
