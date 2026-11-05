import { afterEach, describe, expect, it } from "vitest"

import { demoAnalysis, demoNextStep } from "@/lib/demo/engine"
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import {
  EMPTY_INTAKE,
  applyIntakeDetails,
  describeDetails,
  formatDeadlineDate,
  migrateIntake,
} from "@/lib/intake"
import { IntakeSchema, isCalendarDate } from "@/lib/schemas"
import type { Intake } from "@/lib/schemas"
import { initialSession, restoreSession } from "@/lib/session"
import { buildSummary, summaryToMarkdown } from "@/lib/summary"

const JOB = DEMO_SCENARIOS[0]
const intake = (extra: Partial<Intake> = {}): Intake => ({
  ...EMPTY_INTAKE,
  responsibility: JOB.input,
  ...extra,
})

describe("deadline dates", () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it.each(["Pacific/Kiritimati", "America/Los_Angeles", "UTC"])(
    "keeps the same calendar day in %s",
    (zone) => {
      process.env.TZ = zone
      expect(formatDeadlineDate("2026-03-01")).toBe("Sunday, March 1, 2026")
    }
  )

  it("accepts past and future dates, and rejects impossible ones", () => {
    expect(isCalendarDate("1999-12-31")).toBe(true)
    expect(isCalendarDate("2099-01-01")).toBe(true)
    expect(isCalendarDate("2028-02-29")).toBe(true)
    expect(isCalendarDate("2026-02-29")).toBe(false)
    expect(isCalendarDate("03/01/2026")).toBe(false)
  })
})

describe("optional answers", () => {
  it("defaults every skipped question to null", () => {
    expect(IntakeSchema.parse({ responsibility: "my taxes" })).toEqual({
      responsibility: "my taxes",
      deadline: null,
      status: null,
      obstacle: null,
      obstacleOther: "",
      legacyNotes: "",
    })
  })

  it("accepts a few words", () => {
    expect(IntakeSchema.safeParse({ responsibility: "my taxes" }).success).toBe(
      true
    )
  })

  it("keeps skipped, no deadline, and not sure distinct", () => {
    expect(describeDetails(intake()).deadline).toBeNull()
    expect(
      describeDetails(intake({ deadline: { type: "none" } })).deadline
    ).toBe("No deadline")
    expect(
      describeDetails(intake({ deadline: { type: "unsure" } })).deadline
    ).toBe("I’m not sure")
  })
})

describe("Reality Check details in Demo Mode", () => {
  it("adds nothing for skipped questions, apart from an unknown deadline", () => {
    const custom = "I keep avoiding my garage"
    const result = demoAnalysis(intake({ responsibility: custom }))
    expect(result.realityCheck.knownFacts).toEqual([`You wrote: "${custom}"`])
    expect(result.decision.uncertainty).not.toContain("Demo Mode records")

    const noMention = applyIntakeDetails(
      {
        ...JOB.analysis,
        realityCheck: {
          ...JOB.analysis.realityCheck,
          knownFacts: ["You feel tired."],
          unknowns: ["How long this takes."],
        },
      },
      intake()
    )
    expect(noMention.realityCheck.unknowns[0]).toMatch(/exact deadline/)
    expect(noMention.realityCheck.knownFacts).toEqual(["You feel tired."])
  })

  it("shows a chosen date as a fact and settles the deadline unknown", () => {
    const { realityCheck } = demoAnalysis(
      intake({ deadline: { type: "date", date: "2026-03-01" } })
    )
    expect(realityCheck.knownFacts[0]).toContain("Sunday, March 1, 2026")
    expect(realityCheck.unknowns.join(" ")).not.toMatch(/closing date/)
    expect(realityCheck.unknowns.length).toBeGreaterThan(0)
  })

  it("shows no deadline as a fact", () => {
    const { realityCheck } = demoAnalysis(
      intake({ deadline: { type: "none" } })
    )
    expect(realityCheck.knownFacts).toContain("You said there is no deadline.")
  })

  it("treats every 'not sure' answer as unknown, never as a fact", () => {
    const { realityCheck } = demoAnalysis(
      intake({
        deadline: { type: "unsure" },
        status: "unsure",
        obstacle: "unsure",
      })
    )
    const unknowns = realityCheck.unknowns.join(" ")
    expect(unknowns).toMatch(/What the deadline is/)
    expect(unknowns).toMatch(/Where things currently stand/)
    expect(unknowns).toMatch(/getting in the way/)
    expect(realityCheck.knownFacts.join(" ")).not.toMatch(/not sure/)
  })

  it("uses the Something else text, or marks it unknown when empty", () => {
    expect(
      demoAnalysis(
        intake({ obstacle: "something-else", obstacleOther: "No laptop" })
      ).realityCheck.knownFacts.join(" ")
    ).toContain("No laptop")
    expect(
      demoAnalysis(
        intake({ obstacle: "something-else" })
      ).realityCheck.unknowns.join(" ")
    ).toContain("Something else")
  })

  it("says the prewritten decision doesn't change with the details", () => {
    const { decision } = demoAnalysis(intake({ status: "missed-deadline" }))
    expect(decision.uncertainty).toMatch(/doesn't change based on them/)
  })

  it("still matches the sample scenario and its steps with details chosen", () => {
    const chosen = intake({ obstacle: "no-energy" })
    const analysis = demoAnalysis(chosen)
    const result = demoNextStep({
      stage: "next-step",
      intake: chosen,
      knownFacts: analysis.realityCheck.knownFacts,
      unknowns: analysis.realityCheck.unknowns,
      strategy: "REDUCE",
      event: "start",
      note: "",
      history: [],
    })
    expect(result.action?.instruction).toBe(
      JOB.ladders.REDUCE[0][0].instruction
    )
  })
})

describe("Recovery Summary details", () => {
  const session = (details: Partial<Intake>) => ({
    ...initialSession,
    intake: intake(details),
    analysis: JOB.analysis,
  })

  it("shows skipped questions as Not answered", () => {
    const markdown = summaryToMarkdown(buildSummary(session({})))
    expect(markdown).toContain("Original deadline: Not answered")
    expect(markdown).toContain("Current status: Not answered")
    expect(markdown).toContain("Main obstacle: Not answered")
  })

  it("shows the chosen answers", () => {
    const markdown = summaryToMarkdown(
      buildSummary(
        session({
          deadline: { type: "date", date: "2026-03-01" },
          status: "missed-deadline",
          obstacle: "something-else",
          obstacleOther: "No laptop",
        })
      )
    )
    expect(markdown).toContain("Original deadline: Sunday, March 1, 2026")
    expect(markdown).toContain("Current status: Missed the deadline")
    expect(markdown).toContain("Main obstacle: Something else: No laptop")
  })
})

describe("saved sessions", () => {
  const oldIntake = {
    responsibility: JOB.input,
    deadline: "last Friday",
    status: "started, then stopped",
    obstacle: "my laptop broke",
  }
  const oldSession = {
    ...initialSession,
    screen: "reality",
    analysis: JOB.analysis,
    analysisSource: "demo",
    intake: oldIntake,
  }

  it("migrates old free text without guessing or losing it", () => {
    const migrated = migrateIntake(oldIntake)
    expect(migrated.deadline).toBeNull()
    expect(migrated.status).toBeNull()
    expect(migrated.obstacle).toBe("something-else")
    expect(migrated.obstacleOther).toBe("my laptop broke")
    expect(migrated.legacyNotes).toContain("Original deadline: last Friday.")
    expect(migrated.legacyNotes).toContain(
      "Current status: started, then stopped."
    )
    expect(IntakeSchema.safeParse(migrated).success).toBe(true)
  })

  it("treats old empty fields as unanswered", () => {
    expect(
      migrateIntake({
        responsibility: "abc",
        deadline: "",
        status: "",
        obstacle: "",
      })
    ).toEqual({ ...EMPTY_INTAKE, responsibility: "abc" })
  })

  it("restores new-format answers unchanged", () => {
    const saved = intake({
      deadline: { type: "date", date: "2026-03-01" },
      status: "unsure",
      obstacle: "no-energy",
    })
    expect(migrateIntake(saved)).toEqual(saved)
  })

  it("restores an old session on the same screen", () => {
    const restored = restoreSession(oldSession)
    expect(restored.screen).toBe("reality")
    expect(restored.analysis).toEqual(JOB.analysis)
    expect(restored.intake.legacyNotes).toContain("last Friday")
    expect(buildSummary(restored).details.at(-1)?.label).toBe("Earlier details")
  })

  it.each([
    ["null", null],
    ["a string", "nonsense"],
    ["another version", { version: 2 }],
    ["an empty object", {}],
  ])("falls back to a fresh session for %s", (_name, raw) => {
    expect(restoreSession(raw)).toEqual(initialSession)
  })

  it("returns to a safe screen when saved data is damaged", () => {
    const noAnalysis = restoreSession({
      ...oldSession,
      analysis: { broken: true },
    })
    expect(noAnalysis.screen).toBe("intake")
    expect(noAnalysis.intake.responsibility).toBe(JOB.input)

    const noStrategy = restoreSession({
      ...oldSession,
      screen: "summary",
      strategy: null,
    })
    expect(noStrategy.screen).toBe("decision")

    const badSteps = restoreSession({
      ...oldSession,
      steps: "x",
      current: { action: { nope: 1 } },
      screen: "nowhere",
    })
    expect(badSteps.screen).toBe("intake")
    expect(badSteps.steps).toEqual([])
    expect(badSteps.current).toBeNull()
  })
})
