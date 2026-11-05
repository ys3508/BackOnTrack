import { describe, expect, it } from "vitest"

import {
  applySafetyGuards,
  detectSupportConcern,
  findRepeatReason,
  normalizeAnalysis,
  pickFallbackStep,
  similarity,
} from "@/lib/guards"
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import type { ActionStep, Analysis, HistoryEntry, Intake } from "@/lib/schemas"

const intake = (responsibility: string): Intake => ({
  responsibility,
  deadline: "",
  status: "",
  obstacle: "",
})

const analysis: Analysis = {
  ...DEMO_SCENARIOS[0].analysis,
  decision: { ...DEMO_SCENARIOS[0].analysis.decision, recommended: "RELEASE" },
}

const action = (
  instruction: string,
  approach: ActionStep["approach"]
): ActionStep => ({
  instruction,
  approach,
  why: "",
  inputLabel: "",
  inputPlaceholder: "",
  minutes: 1,
})

const failed = (
  instruction: string,
  approach: ActionStep["approach"]
): HistoryEntry => ({
  instruction,
  approach,
  outcome: "stuck",
  userText: "",
  note: "",
})

describe("safety guards", () => {
  it("never leaves RELEASE recommended for a high-stakes obligation", () => {
    const result = applySafetyGuards(
      analysis,
      intake("I keep avoiding my tax filing.")
    )
    expect(result.decision.recommended).toBe("REDUCE")
    expect(result.decision.highStakes).toBe(true)
    expect(result.decision.caution).not.toBe("")
    expect(result.decision.reasoning).toContain("remains your choice")
  })

  it("respects the model's high-stakes flag when no keyword matches", () => {
    const flagged: Analysis = {
      ...analysis,
      decision: { ...analysis.decision, highStakes: true },
    }
    const result = applySafetyGuards(
      flagged,
      intake("I keep avoiding that form.")
    )
    expect(result.decision.recommended).toBe("REDUCE")
  })

  it("leaves RELEASE alone for low-stakes tasks", () => {
    const result = applySafetyGuards(
      analysis,
      intake("I never finished knitting that scarf.")
    )
    expect(result.decision.recommended).toBe("RELEASE")
  })

  it("detects crisis language in any intake field", () => {
    expect(detectSupportConcern(intake("I want to die, I can't do this"))).toBe(
      true
    )
    expect(
      detectSupportConcern({
        ...intake("my taxes"),
        obstacle: "thinking about suicide",
      })
    ).toBe(true)
    expect(detectSupportConcern(intake("this deadline is killing me"))).toBe(
      false
    )
  })
})

describe("normalizing model output", () => {
  it("rejects an analysis with no known facts or unknowns", () => {
    const empty: Analysis = {
      ...analysis,
      realityCheck: { ...analysis.realityCheck, knownFacts: ["  "] },
    }
    expect(() => normalizeAnalysis(empty)).toThrow()
  })

  it("caps list lengths", () => {
    const long: Analysis = {
      ...analysis,
      realityCheck: {
        ...analysis.realityCheck,
        assumptions: Array.from({ length: 20 }, (_, i) => `assumption ${i}`),
      },
    }
    expect(normalizeAnalysis(long).realityCheck.assumptions).toHaveLength(5)
  })
})

describe("repeat detection", () => {
  it("scores reworded instructions as similar and different ones as not", () => {
    expect(
      similarity(
        "Open the job application website.",
        "Open up the job application website now."
      )
    ).toBeGreaterThan(0.6)
    expect(
      similarity(
        "Open the job application website.",
        "Type the company name you remember."
      )
    ).toBeLessThan(0.2)
  })

  it("flags a reworded repeat of an earlier step", () => {
    const history = [
      failed("Open the job application website.", "gather-information"),
    ]
    expect(
      findRepeatReason(
        action("Open up the job application website.", "write-in-app"),
        history
      )
    ).not.toBeNull()
  })

  it("flags the approach that just failed, even with new wording", () => {
    const history = [
      failed("Open the job application website.", "gather-information"),
    ]
    expect(
      findRepeatReason(
        action("Look up the closing date.", "gather-information"),
        history
      )
    ).not.toBeNull()
  })

  it("accepts a different step with a different approach", () => {
    const history = [
      failed("Open the job application website.", "gather-information"),
    ]
    expect(
      findRepeatReason(
        action("Type the company name you remember.", "recall-from-memory"),
        history
      )
    ).toBeNull()
  })

  it("fallback steps run out without ever repeating", () => {
    const history: HistoryEntry[] = []
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const step = pickFallbackStep(history)
      if (!step) break
      expect(seen.has(step.instruction)).toBe(false)
      seen.add(step.instruction)
      history.push(failed(step.instruction, step.approach))
    }
    expect(seen.size).toBeGreaterThanOrEqual(3)
    expect(pickFallbackStep(history)).toBeNull()
  })
})
