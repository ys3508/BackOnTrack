import { describe, expect, it } from "vitest"

import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import { initialSession } from "@/lib/session"
import type { Session } from "@/lib/session"
import { buildSummary, summaryToMarkdown } from "@/lib/summary"

const scenario = DEMO_SCENARIOS[0]
const step = {
  action: scenario.ladders.REDUCE[1][0],
  adaptationNote: "",
  suggestWrapUp: false,
  origin: "completed" as const,
  source: "demo" as const,
}

const session: Session = {
  ...initialSession,
  screen: "summary",
  intake: { ...initialSession.intake, responsibility: scenario.input },
  analysis: scenario.analysis,
  analysisSource: "demo",
  strategy: "FINISH",
  steps: [
    {
      instruction: "Did this one",
      approach: "write-in-app",
      outcome: "completed",
      userText: "Acme",
      note: "",
      source: "demo",
    },
    {
      instruction: "Got stuck on this one",
      approach: "decide",
      outcome: "stuck",
      userText: "",
      note: "too big",
      source: "demo",
    },
  ],
  current: step,
}

describe("recovery summary", () => {
  const summary = buildSummary(session)

  it("lists only user-completed steps as completed", () => {
    expect(summary.completed.map((s) => s.instruction)).toEqual([
      "Did this one",
    ])
    expect(summary.attempted.map((s) => s.instruction)).toEqual([
      "Got stuck on this one",
    ])
  })

  it("never lists the pending suggestion as completed", () => {
    expect(summary.completed.map((s) => s.instruction)).not.toContain(
      step.action.instruction
    )
    expect(summary.remainingStep).toBe(step.action.instruction)
  })

  it("records when the user overrode the suggestion", () => {
    expect(summary.strategy).toBe("FINISH")
    expect(summary.recommended).toBe("REDUCE")
    expect(summary.overridden).toBe(true)
  })

  it("exports all sections and labels Demo Mode honestly", () => {
    const markdown = summaryToMarkdown(summary)
    for (const heading of [
      "Original responsibility",
      "What was known",
      "What was uncertain",
      "Selected recovery strategy",
      "Actions you marked completed",
      "Remaining next step (suggested, not done)",
      "Unresolved questions",
    ]) {
      expect(markdown).toContain(`## ${heading}`)
    }
    expect(markdown).toContain('You wrote: "Acme"')
    expect(markdown).toContain("not AI-generated")
  })

  it("reports no completions for an empty session", () => {
    const empty = buildSummary({ ...session, steps: [], current: null })
    expect(empty.completed).toEqual([])
    expect(empty.remainingStep).toBeNull()
    expect(summaryToMarkdown(empty)).toContain("None yet")
  })
})
