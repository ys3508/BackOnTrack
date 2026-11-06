// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MockLanguageModelV4 } from "ai/test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import {
  caseProblem,
  generateCasePlan,
  groundedFacts,
  normalizeCase,
} from "@/lib/ai/case-assist"
import { isCrisisText } from "@/lib/guards"
import {
  demoAnother,
  demoInitialPlan,
  demoPlanB,
  deriveTitle,
  draftRealityGap,
  isSimpleErrand,
  suggestBlocker,
  topicOf,
} from "@/lib/recovery/case-engine"
import type { CaseContext } from "@/lib/recovery/case-engine"
import { reasonsFor } from "@/lib/planning/priority"
import { CaseOutputSchema, CaseRequestSchema } from "@/lib/schemas"
import type { CaseOutput, CaseRequest } from "@/lib/schemas"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { restoreWorkspace } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({
  default: {},
  Draggable: class {
    destroy() {}
  },
}))
vi.mock("@fullcalendar/multimonth", () => ({ default: {} }))
vi.mock("@fullcalendar/rrule", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })

const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

const seed = (state: Workspace) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...state, legacyMigrated: true })
  )

const context = (
  input: string,
  extra: Partial<CaseContext> = {}
): CaseContext => ({
  originalInput: input,
  title: deriveTitle(input),
  blocker: null,
  path: null,
  completed: [],
  tried: [],
  realityGap: null,
  realityCheck: null,
  ...extra,
})

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/avoid"
  // Demo Mode: no live key.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("reading what someone wrote", () => {
  it.each(["Buy lunch", "Pick up the dry cleaning", "Order printer ink"])(
    "treats %s as a simple errand",
    (text) => {
      expect(isSimpleErrand(text)).toBe(true)
    }
  )

  it.each([
    "I haven't cleaned my apartment in weeks.",
    "I need to make an important phone call, but I keep avoiding it.",
    "I know I need to start, but I just can't.",
    "I've fallen behind on several responsibilities.",
    "I missed a deadline and I'm afraid of the consequences.",
    "Pay my taxes",
    "Call the landlord, I'm scared",
  ])("doesn't treat %s as an errand", (text) => {
    expect(isSimpleErrand(text)).toBe(false)
  })

  it.each([
    ["My room is a mess. I don't know where to begin.", "dont-know-start"],
    ["I know what to do, but I can't start.", "cant-start"],
    ["I need to exercise, but I can't get myself to start.", "cant-start"],
    [
      "I missed my assignment and I'm afraid my professor will fail me.",
      "worried",
    ],
    ["I was supposed to finish my project yesterday, but I didn't.", "behind"],
    ["I've fallen behind on several responsibilities.", "behind"],
    ["The garden shed", null],
  ])("suggests a blocker for %s", (text, expected) => {
    expect(suggestBlocker(text)).toBe(expected)
  })

  it.each([
    [
      "I need to make an important phone call, but I keep avoiding it.",
      "Make an important phone call",
    ],
    [
      "I was supposed to finish my project yesterday, but I didn't.",
      "Finish my project",
    ],
    [
      "My apartment is a mess and I haven't cleaned it in weeks.",
      "My apartment is a mess",
    ],
    ["I need to exercise, but I can't get myself to start.", "Exercise"],
  ])("names %s", (text, title) => {
    expect(deriveTitle(text)).toBe(title)
  })

  it("handles arbitrary text with a specific, non-empty plan", () => {
    for (const input of [
      "Sort out the grandmother's piano situation",
      "xyzzy",
      "My passport expired",
      "Everything about the wedding",
    ]) {
      for (const blocker of [
        "dont-know-start",
        "cant-start",
        "worried",
      ] as const) {
        const plan = demoInitialPlan(context(input, { blocker }))
        expect(plan.action?.text.length).toBeGreaterThan(5)
        expect(plan.source).toBe("demo")
      }
    }
  })

  it("asks for the one missing detail when no responsibility is named", () => {
    const plan = demoInitialPlan(
      context("I know what to do, but I can't start.", {
        blocker: "cant-start",
      })
    )
    expect(plan.missingDetail).toMatch(/what is the thing/i)
    expect(plan.action).not.toBeNull()
  })

  it("recognizes crisis wording, including curly apostrophes", () => {
    expect(isCrisisText("I want to kill myself")).toBe(true)
    expect(isCrisisText("I don’t want to be here anymore")).toBe(true)
    expect(isCrisisText("This deadline is killing me")).toBe(false)
  })
})

describe("Reality Gap draft", () => {
  const gap = draftRealityGap(
    "I missed my assignment and I'm afraid my professor will fail me."
  )

  it("separates facts from predictions", () => {
    expect(gap.known).toEqual(["I missed my assignment"])
    expect(gap.worried).toEqual(["My professor might fail me"])
  })

  it("says what isn't known, and invents no policy", () => {
    expect(gap.unknown.join(" ")).toMatch(/whether late submissions/i)
    const all = [...gap.known, ...gap.worried, ...gap.can].join(" ")
    expect(all).not.toMatch(/\d/)
    expect(all).not.toMatch(/policy (says|allows)|you will/i)
    expect(gap.can[0]).toMatch(/course policy/i)
  })

  it("is about the topic, not a template for one case", () => {
    expect(topicOf("I owe taxes")).toBe("money")
    expect(draftRealityGap("I owe taxes and I'm scared").unknown[0]).toMatch(
      /deadline or penalty/i
    )
  })
})

describe("never repeating itself", () => {
  it("doesn't offer something already tried, and says when it runs out", () => {
    const ctx = context("I need to clean my kitchen", {
      blocker: "cant-start",
    })
    const seen: string[] = []
    let current = demoInitialPlan(ctx).action!.text
    for (let i = 0; i < 25; i++) {
      seen.push(current)
      const next = demoAnother({ ...ctx, tried: seen }, current, [])
      if (!next.action) {
        expect(next.missingDetail).toMatch(/out of built-in/i)
        expect(next.keepCurrent).toBe(true)
        return
      }
      expect(seen).not.toContain(next.action.text)
      current = next.action.text
    }
    throw new Error("It never ran out of ideas")
  })

  it.each([
    ["too-big", /smaller/i],
    ["dont-know-how", /information/i],
    ["low-energy", /pause/i],
  ] as const)("adapts Plan B to %s", (reason, note) => {
    const ctx = context("I need to clean my kitchen", {
      blocker: "dont-know-start",
    })
    const current = demoInitialPlan(ctx).action!.text
    const plan = demoPlanB(ctx, current, { reason, detail: "" })
    expect(plan.note).toMatch(note)
    expect(plan.action?.text).not.toBe(current)
  })

  it("offers Reality Gap for worry, and the three paths when the plan is dead", () => {
    const ctx = context("I need to clean my kitchen", {
      blocker: "dont-know-start",
    })
    const worried = demoPlanB(ctx, "x", { reason: "worried", detail: "" })
    expect(worried.openTools).toEqual(["reality-gap"])
    expect(worried.realityGap).toBeTruthy()
    const dead = demoPlanB(ctx, "x", { reason: "not-viable", detail: "" })
    expect(dead.openTools).toEqual(["paths"])
    expect(dead.action).toBeNull()
  })
})

describe("persistence", () => {
  it("keeps every field through saving and restoring", () => {
    const state = run([
      {
        type: "start-case",
        id: "a",
        at: AT,
        input: "I missed it and I'm afraid",
        title: "I missed it",
        suggestedBlocker: "worried",
      },
      { type: "case-set-blocker", id: "a", at: AT, blocker: "behind" },
      {
        type: "case-apply-plan",
        id: "a",
        at: AT,
        plan: {
          action: { text: "Do a small thing", why: "Because" },
          queue: ["Then this"],
          alternatives: ["Or that"],
          missingDetail: "",
          note: "",
          source: "demo",
        },
      },
      { type: "case-complete-action", id: "a", at: AT },
      { type: "case-set-path", id: "a", at: AT, path: "reduce" },
      {
        type: "case-update",
        id: "a",
        at: AT,
        patch: {
          messageDraft: "Hi",
          realityGap: {
            known: ["k"],
            worried: ["w"],
            unknown: ["u"],
            can: ["c"],
          },
        },
      },
    ])
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(state)))
    const recovery = restored.tasks[0].recoveryCase!
    expect(restored.tasks[0].id).toBe("a")
    expect(recovery.originalInput).toBe("I missed it and I'm afraid")
    expect(recovery.blocker).toBe("behind")
    expect(recovery.path).toBe("reduce")
    expect(recovery.current?.text).toBe("Then this")
    expect(recovery.completed.map((item) => item.text)).toEqual([
      "Do a small thing",
    ])
    expect(recovery.realityGap?.known).toEqual(["k"])
    expect(recovery.messageDraft).toBe("Hi")
    expect(restored.tasks[0].nextAction).toBe("Then this")
  })

  it("restores older data, which has no cases, unchanged", () => {
    const old = run([{ type: "create-task", id: "a", at: AT, title: "Old" }])
    const raw = JSON.parse(JSON.stringify(old))
    delete raw.tasks[0].recoveryCase
    delete raw.tasks[0].quick
    delete raw.intakeDraft
    const restored = restoreWorkspace(raw)
    expect(restored.tasks[0].recoveryCase).toBeNull()
    expect(restored.tasks[0].quick).toBe(false)
    expect(restored.intakeDraft).toBe("")
  })

  it("keeps a damaged case from losing the task", () => {
    const state = run([{ type: "create-task", id: "a", at: AT, title: "Kept" }])
    const raw = JSON.parse(JSON.stringify(state))
    raw.tasks[0].recoveryCase = { nonsense: true }
    const restored = restoreWorkspace(raw)
    expect(restored.tasks[0].title).toBe("Kept")
    expect(restored.tasks[0].recoveryCase).toBeNull()
  })

  it("marks the case's step done from the task page too", () => {
    const state = run([
      {
        type: "start-case",
        id: "a",
        at: AT,
        input: "x y z",
        title: "x",
        suggestedBlocker: null,
      },
      {
        type: "case-apply-plan",
        id: "a",
        at: AT,
        plan: {
          action: { text: "Step one", why: "" },
          queue: [],
          alternatives: [],
          missingDetail: "",
          note: "",
          source: "demo",
        },
      },
      { type: "complete-next-action", id: "a", at: AT },
    ])
    const recovery = state.tasks[0].recoveryCase!
    expect(recovery.completed[0].text).toBe("Step one")
    expect(recovery.current).toBeNull()
    expect(state.tasks[0].nextAction).toBe("")
  })
})

describe("Live AI", () => {
  const request = (extra: Partial<CaseRequest> = {}): CaseRequest =>
    CaseRequestSchema.parse({
      stage: "recovery-case",
      purpose: "initial",
      originalInput:
        "I missed my assignment and I'm afraid my professor will fail me.",
      title: "I missed my assignment",
      blocker: "worried",
      path: null,
      current: "",
      alternatives: [],
      completed: [],
      tried: [],
      stuckReason: null,
      stuckDetail: "",
      realityGap: null,
      realityCheck: null,
      ...extra,
    })

  const output = (extra: Partial<CaseOutput> = {}): CaseOutput =>
    CaseOutputSchema.parse({
      title: "Missed assignment",
      suggestedBlocker: "worried",
      action: "Open the syllabus and find the late-work section.",
      why: "So you know what's true.",
      laterSteps: [],
      alternatives: ["Email the professor"],
      realityGap: {
        known: [
          "I missed my assignment",
          "The deadline was March 3",
          "The school allows 3 late days",
        ],
        worried: ["My professor might fail me"],
        unknown: ["Whether late work is accepted"],
        can: ["Check the syllabus"],
      },
      messageDraft: "",
      note: "",
      missingDetail: "",
      supportConcern: false,
      ...extra,
    })

  const modelReturning = (...answers: CaseOutput[]) => {
    let call = 0
    return new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(answers[Math.min(call++, answers.length - 1)]),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    })
  }

  it("drops facts that the user never gave", () => {
    const facts = groundedFacts(output().realityGap.known, request())
    expect(facts).toContain("I missed my assignment")
    expect(facts.join(" ")).not.toMatch(/March 3|3 late days/)
  })

  it("rejects vague, repeated, and invented answers", () => {
    expect(
      caseProblem(output({ action: "Think about your priorities" }), request())
    ).toMatch(/think/i)
    expect(
      caseProblem(
        output({ action: "Open the syllabus and find the late work section" }),
        request({
          tried: ["Open the syllabus and find the late-work section."],
        })
      )
    ).toMatch(/repeats/)
    expect(
      caseProblem(output({ why: "The policy says you will fail." }), request())
    ).toMatch(/policy/i)
    expect(caseProblem(output({ action: "" }), request())).toMatch(/no action/i)
  })

  it("cleans a valid answer", () => {
    const plan = normalizeCase(output(), request())
    expect(plan.source).toBe("live")
    expect(plan.action?.text).toContain("syllabus")
    expect(plan.realityGap?.known).toEqual(["I missed my assignment"])
  })

  it("retries a bad answer, then uses a labeled template", async () => {
    const bad = output({ action: "Reflect on your motivation" })
    const plan = await generateCasePlan(modelReturning(bad, bad), request())
    expect(plan.source).toBe("demo")
    expect(plan.usedFallback).toBe(true)
  })

  it("recovers after one correction", async () => {
    const plan = await generateCasePlan(
      modelReturning(output({ action: "Reflect on it" }), output()),
      request()
    )
    expect(plan.source).toBe("live")
    expect(plan.action?.text).toContain("syllabus")
  })

  it("never lets a model skip the user's choice of path", async () => {
    const plan = await generateCasePlan(
      modelReturning(output()),
      request({ blocker: "behind" })
    )
    expect(plan.action).toBeNull()
    expect(plan.source).toBe("demo")
  })

  it("stops for crisis wording without calling the model", async () => {
    const plan = await generateCasePlan(
      modelReturning(output()),
      request({ originalInput: "I want to kill myself" })
    )
    expect(plan.supportConcern).toBe(true)
  })

  it("honors the model's safety flag", async () => {
    const plan = await generateCasePlan(
      modelReturning(output({ supportConcern: true })),
      request()
    )
    expect(plan.supportConcern).toBe(true)
  })
})

describe("audited bugs", () => {
  const task = (patch: Record<string, unknown> = {}) => ({
    ...run([{ type: "create-task", id: "a", at: AT, title: "T" }]).tasks[0],
    ...patch,
  })

  it("explains priority truthfully", () => {
    const today = "2026-11-05"
    expect(
      reasonsFor(task({ priority: "low" }) as never, EMPTY_WORKSPACE, today)
    ).toEqual(["You marked it low priority"])
    expect(
      reasonsFor(task({ priority: "high" }) as never, EMPTY_WORKSPACE, today)
    ).toEqual(["You marked it high priority"])
    // A far-off deadline isn't "no deadline".
    expect(
      reasonsFor(
        task({ deadline: "2027-06-01" }) as never,
        EMPTY_WORKSPACE,
        today
      ).join()
    ).toMatch(/Due .*so there’s time/)
    expect(reasonsFor(task() as never, EMPTY_WORKSPACE, today)).toEqual([
      "No deadline or priority set",
    ])
  })

  it("doesn't offer Pause on a task that was never started", async () => {
    seed(run([{ type: "create-task", id: "a", at: AT, title: "Never begun" }]))
    window.location.hash = "#/tasks/a"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Never begun" })
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
  })

  it("doesn't call a paused timer running", async () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "One" },
      { type: "create-task", id: "b", at: AT, title: "Other" },
      {
        type: "timer-start",
        id: "t",
        kind: "focus",
        taskId: "a",
        minutes: 10,
        now: Date.now(),
        at: AT,
      },
      { type: "timer-pause", now: Date.now() },
    ])
    seed(state)
    window.location.hash = "#/tasks/b"
    render(<WorkspaceApp />)
    expect(
      await screen.findByText(/already\s+paused on something/)
    ).toBeTruthy()
    expect(await button("Open the paused timer")).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /Open focus timer, paused at/ })
    ).toBeTruthy()
    expect(document.title).toMatch(/^Paused/)
  })

  it("describes focus history accurately", async () => {
    const start = run([
      { type: "create-task", id: "a", at: AT, title: "Work" },
      {
        type: "timer-start",
        id: "t",
        kind: "focus",
        taskId: "a",
        minutes: 10,
        now: 1_000_000,
        at: AT,
      },
      {
        type: "timer-stop",
        now: 1_000_000 + 240_000,
        at: AT,
        outcome: "continue-later",
        note: "",
      },
      {
        type: "timer-start",
        id: "u",
        kind: "focus",
        taskId: "a",
        minutes: 5,
        now: 2_000_000,
        at: AT,
      },
      { type: "timer-finish", now: 2_000_000 + 300_000 },
      { type: "report-focus", sessionId: "u", report: "stuck", at: AT },
      { type: "timer-acknowledge" },
    ])
    seed(start)
    window.location.hash = "#/focus"
    render(<WorkspaceApp />)
    expect(
      await screen.findByText(
        /Stopped after 4 min of 10 min on Work\. Will continue later/
      )
    ).toBeTruthy()
    expect(
      await screen.findByText(
        /Ran the full 5 min on Work\. You said you got stuck/
      )
    ).toBeTruthy()
  })

  it("offers setup once on a new task, not twice", async () => {
    seed(run([{ type: "create-task", id: "a", at: AT, title: "New" }]))
    window.location.hash = "#/tasks/a"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "New" })
    expect(
      await screen.findAllByRole("button", { name: "Set up my workspace" })
    ).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Help me do this" })).toBeNull()
  })

  it("has no scrolling column inside the task page", async () => {
    seed(run([{ type: "create-task", id: "a", at: AT, title: "New" }]))
    window.location.hash = "#/tasks/a"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "New" })
    expect(document.querySelector(".lg\\:overflow-y-auto")).toBeNull()
  })

  it("saves a note while typing, without needing to leave the field", async () => {
    seed(
      run([
        { type: "create-task", id: "a", at: AT, title: "New" },
        {
          type: "save-document",
          id: "a",
          at: AT,
          docId: "d",
          title: "Notes",
          body: "",
        },
      ])
    )
    window.location.hash = "#/tasks/a"
    render(<WorkspaceApp />)
    const user = userEvent.setup()
    await screen.findByRole("heading", { name: "New" })
    await user.type(screen.getByLabelText("Notes"), "typed but not blurred")
    await waitFor(
      () =>
        expect(saved().tasks[0].documents[0].body).toBe(
          "typed but not blurred"
        ),
      { timeout: 2000 }
    )
  })
})
