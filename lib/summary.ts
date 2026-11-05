import type { Session, Source } from "@/lib/session"
import type { Strategy } from "@/lib/schemas"

export const STRATEGY_LABEL: Record<Strategy, string> = {
  FINISH: "Finish",
  REDUCE: "Reduce",
  RELEASE: "Release",
}

export type SummaryStep = {
  instruction: string
  userText: string
  note: string
}

export type RecoverySummary = {
  responsibility: string
  knownFacts: string[]
  uncertain: string[]
  unresolvedQuestions: string[]
  strategy: Strategy | null
  recommended: Strategy | null
  overridden: boolean
  completed: SummaryStep[]
  attempted: SummaryStep[]
  remainingStep: string | null
  sources: Source[]
}

/**
 * Built only from recorded state, never from a model's description of it.
 * A step appears under "completed" only if the user pressed Completed.
 */
export function buildSummary(session: Session): RecoverySummary {
  const { analysis, steps, strategy, current } = session
  const toStep = ({ instruction, userText, note }: SummaryStep) => ({
    instruction,
    userText,
    note,
  })
  const recommended = analysis?.decision.recommended ?? null

  const sources = new Set<Source>()
  if (session.analysisSource) sources.add(session.analysisSource)
  steps.forEach((step) => sources.add(step.source))
  if (current) sources.add(current.source)

  return {
    responsibility: session.intake.responsibility,
    knownFacts: analysis?.realityCheck.knownFacts ?? [],
    uncertain: [
      ...(analysis?.realityCheck.assumptions ?? []),
      ...(analysis?.realityCheck.consequences
        .filter((item) => item.status === "uncertain")
        .map((item) => item.text) ?? []),
    ],
    unresolvedQuestions: analysis?.realityCheck.unknowns ?? [],
    strategy,
    recommended,
    overridden: Boolean(strategy && recommended && strategy !== recommended),
    completed: steps.filter((s) => s.outcome === "completed").map(toStep),
    attempted: steps.filter((s) => s.outcome !== "completed").map(toStep),
    remainingStep: current?.action.instruction ?? null,
    sources: [...sources],
  }
}

export function sourceText(sources: Source[]) {
  if (sources.includes("live") && sources.includes("demo")) {
    return "Partly live AI, partly prewritten Demo Mode content"
  }
  if (sources.includes("live")) return "Live AI"
  return "Demo Mode (prewritten, not AI-generated)"
}

function bullets(items: string[], empty: string) {
  return items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : `- ${empty}`
}

export function summaryToMarkdown(summary: RecoverySummary) {
  const stepLine = (step: SummaryStep) => {
    const details = [
      step.userText && `You wrote: "${step.userText}"`,
      step.note && `Your note: "${step.note}"`,
    ].filter(Boolean)
    return details.length
      ? `${step.instruction} (${details.join("; ")})`
      : step.instruction
  }

  const strategy = summary.strategy
    ? `${STRATEGY_LABEL[summary.strategy]}${
        summary.overridden && summary.recommended
          ? ` (your choice; the suggestion was ${STRATEGY_LABEL[summary.recommended]})`
          : ""
      }`
    : "Not selected"

  return `# BackOnTrack Recovery Summary

## Original responsibility
${summary.responsibility}

## What was known
${bullets(summary.knownFacts, "Nothing recorded")}

## What was uncertain
${bullets(summary.uncertain, "Nothing recorded")}

## Selected recovery strategy
${strategy}

## Actions you marked completed
${bullets(summary.completed.map(stepLine), "None yet")}

## Tried, but not completed
${bullets(summary.attempted.map(stepLine), "None")}

## Remaining next step (suggested, not done)
${summary.remainingStep ?? "None set"}

## Unresolved questions
${bullets(summary.unresolvedQuestions, "None recorded")}

---
Source: ${sourceText(summary.sources)}. AI suggestions can be wrong. Check anything important with the person or office responsible.
`
}
