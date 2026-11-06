// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MockLanguageModelV4 } from "ai/test"
import axe from "axe-core"
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
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const savedCase = () => saved().tasks[0].recoveryCase
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const nextAction = () => screen.findByTestId("next-action")

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
  window.location.hash = "#/"
  // Demo Mode: no live key.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

async function intake(user: ReturnType<typeof userEvent.setup>, text: string) {
  render(<WorkspaceApp />)
  await user.type(
    await screen.findByLabelText("What you’ve been putting off"),
    text
  )
  await user.click(await button("Help me get back on track"))
}

async function chooseBlocker(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp
) {
  await user.click(await button(label))
}

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

describe("Test A: a simple errand", () => {
  it("stays light, and is easy to finish", async () => {
    const user = userEvent.setup()
    await intake(user, "Buy lunch")
    expect(
      await screen.findByRole("heading", { name: "Quick ones" })
    ).toBeTruthy()
    expect(
      screen.queryByText("What’s making this difficult right now?")
    ).toBeNull()
    expect(screen.queryByText("Reality Gap")).toBeNull()
    expect(saved().tasks[0].recoveryCase).toBeNull()
    expect(saved().tasks[0].quick).toBe(true)

    await user.click(await button("Done: Buy lunch"))
    await waitFor(() => expect(saved().tasks[0].status).toBe("completed"))
    expect(await screen.findByText(/Done: Buy lunch/)).toBeTruthy()
  })

  it("can turn out to be harder, without making a duplicate", async () => {
    const user = userEvent.setup()
    await intake(user, "Buy lunch")
    await user.click(await button(/harder than it looks: Buy lunch/i))
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
    expect(saved().tasks).toHaveLength(1)
    expect(savedCase().originalInput).toBe("Buy lunch")
  })
})

describe("Test B: unclear starting point", () => {
  it("shows one step, and can make it smaller", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    const option = await button(/I don’t know where to start\./)
    expect(option).toHaveTextContent("Closest to what you wrote")
    // The suggestion waits for the user's choice.
    expect(savedCase().blocker).toBeNull()
    await user.click(option)

    const first = await nextAction()
    expect(first).toHaveTextContent("Choose one small area")
    // Later steps are held back, not listed.
    expect(screen.queryByText(/Put away five things/)).toBeNull()
    expect(screen.queryByText("Reality Gap")).toBeNull()
    await button("Start with this")

    await user.click(await button("Make it smaller"))
    await waitFor(async () =>
      expect((await nextAction()).textContent).not.toContain(
        "Choose one small area"
      )
    )
    expect(savedCase().tried).toContain(
      "Choose one small area, such as your desk or kitchen counter."
    )

    // Another step only when asked for, or after finishing this one.
    await user.click(await button("I did it"))
    await waitFor(() => expect(savedCase().completed).toHaveLength(1))
  })

  it("reveals the following step only when asked", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await nextAction()
    expect(screen.queryByText(/After this:/)).toBeNull()
    await user.click(await button("What comes after this?"))
    expect(await screen.findByText(/After this:/)).toBeTruthy()
  })
})

describe("Test C: starting difficulty", () => {
  it("gives a micro-action and an optional timer, without any planning", async () => {
    const user = userEvent.setup()
    await intake(user, "I need to exercise, but I can't get myself to start.")
    await chooseBlocker(user, /I know what to do, but I can’t start\./)
    expect(await nextAction()).toHaveTextContent("Put on your workout shoes.")
    expect(screen.queryByText("Reality Check")).toBeNull()
    expect(screen.queryByText("Reality Gap")).toBeNull()

    // The timer uses the chosen length, and finishing it completes nothing.
    await user.click(await button("2 minutes"))
    await waitFor(() => expect(saved().timer.plannedSeconds).toBe(120))
    expect(savedCase().completed).toHaveLength(0)
    expect(await screen.findByRole("timer")).toHaveAccessibleName(/0[12]:\d\d/)
  })

  it("uses the five-minute length as well", async () => {
    const user = userEvent.setup()
    await intake(user, "I need to exercise, but I can't get myself to start.")
    await chooseBlocker(user, /I know what to do, but I can’t start\./)
    await user.click(await button("5 minutes"))
    await waitFor(() => expect(saved().timer.plannedSeconds).toBe(300))
  })

  it("doesn't finish the step when the timer runs out", async () => {
    const state = run([
      {
        type: "start-case",
        id: "a",
        at: AT,
        input: "I need to exercise",
        title: "Exercise",
        suggestedBlocker: null,
      },
      { type: "case-set-blocker", id: "a", at: AT, blocker: "cant-start" },
      {
        type: "case-apply-plan",
        id: "a",
        at: AT,
        plan: {
          action: { text: "Put on shoes", why: "" },
          queue: [],
          alternatives: [],
          missingDetail: "",
          note: "",
          source: "demo",
        },
      },
      {
        type: "timer-start",
        id: "t",
        kind: "focus",
        taskId: "a",
        minutes: 2,
        now: Date.now() - 200_000,
        at: AT,
      },
    ])
    seed(state)
    window.location.hash = "#/case/a"
    render(<WorkspaceApp />)
    const user = userEvent.setup()
    await screen.findByText(/stays open until you say otherwise/)
    expect(savedCase().completed).toHaveLength(0)
    expect(savedCase().current.text).toBe("Put on shoes")
    await user.click(await button("I made a start"))
    await waitFor(() => expect(saved().finishedSessionId).toBeNull())
    expect(savedCase().completed).toHaveLength(0)
    expect(saved().focusSessions[0].progressReport).toBe("a-little")
  })

  it("asks for the thing when none was named, then gets specific", async () => {
    const user = userEvent.setup()
    await intake(user, "I know what to do, but I can't start.")
    await chooseBlocker(user, /I know what to do, but I can’t start\./)
    await user.type(
      await screen.findByLabelText(/what is the thing/i),
      "go to the gym"
    )
    await user.click(await button("Use this"))
    await waitFor(() => expect(saved().tasks[0].title).toBe("Go to the gym"))
    expect(await nextAction()).toHaveTextContent("Put on your workout shoes.")
  })
})

describe("Test D: fear of consequences", () => {
  it("separates facts from fears, and offers one next action", async () => {
    const user = userEvent.setup()
    await intake(
      user,
      "I missed my assignment and I'm afraid my professor will fail me."
    )
    await chooseBlocker(user, /I’m worried about what might happen\./)
    await screen.findByRole("heading", { name: "Reality Gap" })
    expect(screen.getByLabelText("What I know, item 1")).toHaveValue(
      "I missed my assignment"
    )
    expect(screen.getByLabelText("What I’m worried about, item 1")).toHaveValue(
      "My professor might fail me"
    )
    expect(
      (
        screen.getByLabelText(
          "What I don’t know yet, item 1"
        ) as HTMLTextAreaElement
      ).value
    ).toMatch(/whether late submissions/i)
    expect(await nextAction()).toHaveTextContent(/course policy/i)
    expect(screen.getAllByTestId("next-action")).toHaveLength(1)

    // Every section can be corrected, and it's saved right away.
    const known = screen.getByLabelText("What I know, item 1")
    await user.clear(known)
    await user.type(known, "It was due Monday")
    await waitFor(() =>
      expect(savedCase().realityGap.known).toEqual(["It was due Monday"])
    )

    // Another option can become the next step.
    await user.click(
      (
        await screen.findAllByRole("button", { name: "Make this my next step" })
      )[0]
    )
    expect(await nextAction()).toHaveTextContent(/contact the professor/i)

    // An editable draft, which BackOnTrack never sends.
    await user.click(await button("See the message draft"))
    const draft = (await screen.findByLabelText(
      "A message you could send"
    )) as HTMLTextAreaElement
    expect(draft.value).toContain("[")
    expect(screen.getByText(/doesn’t send anything/)).toBeTruthy()
  })
})

describe("Test E: a plan that failed", () => {
  it("asks first, makes the user choose, then gives one action", async () => {
    const user = userEvent.setup()
    await intake(
      user,
      "I was supposed to finish my project yesterday, but I didn't."
    )
    await chooseBlocker(user, /I’m already behind, or my plan didn’t work\./)
    await screen.findByRole("heading", { name: "Reality Check" })
    expect(screen.getByLabelText("What was supposed to happen?")).toHaveValue(
      "Finish my project"
    )
    // Nothing is chosen for them.
    expect(screen.queryByTestId("next-action")).toBeNull()
    expect(savedCase().path).toBeNull()

    await user.click(await button("No"))
    expect(await screen.findByText(/Finish may not be possible/)).toBeTruthy()

    await user.click(await button(/^Reduce/))
    expect(await nextAction()).toHaveTextContent(/smallest version/i)
    expect(savedCase().path).toBe("reduce")
    expect(savedCase().realityCheck.opportunity).toBe("no")

    // The rest of the plan can be edited.
    await user.click(await screen.findByText("The rest of this plan"))
    const step = screen.getByLabelText("Later steps, item 1")
    await user.clear(step)
    await user.type(step, "Send the small version")
    await waitFor(() =>
      expect(savedCase().queue[0]).toBe("Send the small version")
    )
  })

  it("explains the uncertainty before Release on a consequential responsibility", async () => {
    const user = userEvent.setup()
    await intake(user, "I was supposed to pay my taxes, but I didn't.")
    await chooseBlocker(user, /I’m already behind, or my plan didn’t work\./)
    await user.click(await button(/^Release/))
    expect(savedCase().path).toBeNull()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /doesn’t know the actual rules/
    )
    await user.click(await button(/I understand/))
    await waitFor(() => expect(savedCase().path).toBe("release"))
    // First it finds out what stopping means. It doesn't stop.
    expect(await nextAction()).toHaveTextContent(
      /what would happen if you stop/i
    )
    expect(saved().tasks[0].status).not.toBe("released")
  })

  it("lets go of something minor only when the user confirms", async () => {
    const user = userEvent.setup()
    await intake(user, "I was supposed to organize the photos, but I didn't.")
    await chooseBlocker(user, /I’m already behind, or my plan didn’t work\./)
    await user.click(await button(/^Release/))
    expect(await nextAction()).toHaveTextContent(/why you’re letting go/i)
    await user.click(await button("I did it"))
    await nextAction()
    await user.click(await button("I did it"))
    await waitFor(() => expect(saved().tasks[0].status).not.toBe("released"))
    await user.click(await button("Release this"))
    await waitFor(() => expect(saved().tasks[0].status).toBe("released"))
  })
})

describe("Test F: stuck after starting", () => {
  it("asks what happened, adapts, keeps the work, and doesn't repeat", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    const first = (await nextAction()).textContent!
    await user.click(await button("Start with this"))
    await user.click(await button("I did it"))
    await waitFor(() => expect(savedCase().completed).toHaveLength(1))
    const second = (await nextAction()).textContent!

    await user.click(await button("I’m stuck"))
    await screen.findByRole("heading", { name: "What happened?" })
    await user.click(await button("The step feels too big."))

    await waitFor(async () =>
      expect((await nextAction()).textContent).not.toBe(second)
    )
    expect(
      await screen.findByText(/too big, so this one is smaller/)
    ).toBeTruthy()
    const third = (await nextAction()).textContent!
    expect([first, second]).not.toContain(third)
    expect(savedCase().completed[0].text).toBe(first)
    expect(savedCase().lastFeedback.reason).toBe("too-big")
  })

  it("keeps the rest of the plan after swapping one step", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await nextAction()
    const later = savedCase().queue
    expect(later.length).toBeGreaterThan(1)

    await user.click(await button("I’m stuck"))
    await user.click(await button("The step feels too big."))
    await waitFor(() => expect(savedCase().tried).toHaveLength(1))
    expect(savedCase().queue).toEqual(later)

    await user.click(await button("Try another approach"))
    await waitFor(() => expect(savedCase().tried).toHaveLength(2))
    expect(savedCase().queue).toEqual(later)

    // Finishing the smaller step leads on, rather than to a dead end.
    await user.click(await button("I did it"))
    await waitFor(() => expect(savedCase().completed).toHaveLength(1))
    expect(await nextAction()).toHaveTextContent(later[0])
  })

  it("opens Reality Gap when worry is what's in the way", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await user.click(await button("I’m stuck"))
    await user.click(await button("I’m worried about the outcome."))
    await screen.findByRole("heading", { name: "Reality Gap" })
    expect(savedCase().blocker).toBe("dont-know-start")
  })

  it("finds what's missing when the user doesn't know how", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await user.click(await button("I’m stuck"))
    await user.click(await button("I don’t know how to do it."))
    await user.type(
      await screen.findByLabelText(/Which part/),
      "recycling rules"
    )
    await user.click(await button("Find another way"))
    expect(await nextAction()).toHaveTextContent("recycling rules")
  })

  it("offers a pause when energy is low, and respects it", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await user.click(await button("I’m stuck"))
    await user.click(await button("I don’t have enough time or energy."))
    await screen.findByText(/You can also pause on purpose/)
    await user.click(await button("Pause this on purpose"))
    await waitFor(() => expect(saved().tasks[0].status).toBe("paused"))
    await screen.findByRole("heading", { name: "This is paused." })
    await user.click(await button("Pick it back up"))
    await waitFor(() => expect(saved().tasks[0].status).toBe("in-progress"))
  })

  it("goes back to the three paths when the plan won't work", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await user.click(await button("I’m stuck"))
    await user.click(await button("This plan won’t work anymore."))
    await screen.findByRole("heading", {
      name: "How do you want to handle this?",
    })
    expect(screen.queryByTestId("next-action")).toBeNull()
  })

  it("gets different suggestions from Try another approach, then admits its limit", async () => {
    const user = userEvent.setup()
    await intake(user, "Sort the shed")
    await chooseBlocker(user, /I know what to do, but I can’t start\./)
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const text = (await nextAction()).textContent!
      seen.add(text)
      await user.click(await button("Try another approach"))
      await act(async () => {})
      if (screen.queryByLabelText(/out of built-in/i)) break
    }
    expect(seen.size).toBeGreaterThan(2)
    expect(await screen.findByLabelText(/out of built-in/i)).toBeTruthy()
    expect(await nextAction()).toBeTruthy()
  })
})

describe("Test G: returning after days away", () => {
  const away = () => {
    const state = run([
      {
        type: "start-case",
        id: "a",
        at: AT,
        input: "My room is a mess",
        title: "My room is a mess",
        suggestedBlocker: null,
      },
      { type: "case-set-blocker", id: "a", at: AT, blocker: "dont-know-start" },
      {
        type: "case-apply-plan",
        id: "a",
        at: AT,
        plan: {
          action: { text: "Clear the desk", why: "" },
          queue: ["Wipe the desk"],
          alternatives: [],
          missingDetail: "",
          note: "",
          source: "demo",
        },
      },
      { type: "case-complete-action", id: "a", at: AT },
      {
        type: "create-task",
        id: "b",
        at: AT,
        title: "Overdue",
        deadline: "2020-01-01",
      },
    ])
    const longAgo = new Date(Date.now() - 6 * 86_400_000).toISOString()
    return {
      ...state,
      lastOpenedAt: longAgo,
      tasks: state.tasks.map((task) =>
        task.recoveryCase
          ? {
              ...task,
              recoveryCase: {
                ...task.recoveryCase,
                lastActivity: { at: longAgo, text: "Finished: Clear the desk" },
              },
            }
          : task
      ),
    }
  }

  it("asks neutrally, and shows no overdue dashboard", async () => {
    seed(away())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    expect(
      await screen.findByText(
        /Last time, you were working on My room is a mess\. Would you like to continue, make the next step smaller, or reconsider the plan\?/
      )
    ).toBeTruthy()
    expect(screen.queryByText(/overdue/i)).toBeNull()
    expect(screen.queryByText("Could use a look")).toBeNull()

    await user.click(await button("Continue"))
    expect(await nextAction()).toHaveTextContent("Wipe the desk")
    expect(savedCase().completed[0].text).toBe("Clear the desk")
    expect(savedCase().blocker).toBe("dont-know-start")
    // Having answered once, they aren't asked again on the way in.
    expect(screen.queryByText(/Last time, you were working on/)).toBeNull()
    // No intake to repeat.
    expect(
      screen.queryByText("What’s making this difficult right now?")
    ).toBeNull()
  })

  it("makes the step smaller from the prompt", async () => {
    seed(away())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Make the next step smaller"))
    await waitFor(async () =>
      expect((await nextAction()).textContent).not.toContain("Wipe the desk")
    )
    expect(savedCase().completed).toHaveLength(1)

    // A reload doesn't make it smaller a second time.
    const smaller = savedCase().current.text
    expect(window.location.hash).toBe("#/case/a")
    cleanupAndRender(window.location.hash)
    expect(await nextAction()).toHaveTextContent(smaller)
    expect(savedCase().current.text).toBe(smaller)
  })

  it("asks when opening a case left for days, and only once", async () => {
    const left = away()
    seed({ ...left, lastOpenedAt: new Date().toISOString() })
    window.location.hash = "#/case/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByText(/Last time, you were working on/)
    await user.click(await button("Continue"))
    await waitFor(() =>
      expect(screen.queryByText(/Last time, you were working on/)).toBeNull()
    )
    expect(savedCase().completed).toHaveLength(1)
  })

  it("reopens the three paths from the prompt", async () => {
    seed(away())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Reconsider the plan"))
    await screen.findByRole("heading", {
      name: "How do you want to handle this?",
    })
    expect(await nextAction()).toHaveTextContent("Wipe the desk")
  })

  it("keeps everything through a reload", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await user.click(await button("I did it"))
    await waitFor(() => expect(savedCase().completed).toHaveLength(1))
    const next = (await nextAction()).textContent
    const hash = window.location.hash

    cleanupAndRender(hash)
    expect((await nextAction()).textContent).toBe(next)
    await screen.findByText(/I don’t know where to start\./)

    await user.click(await screen.findByRole("button", { name: "Tasks" }))
    expect(await screen.findByText(/My room is a mess/)).toBeTruthy()
    await user.click(await screen.findByRole("button", { name: "Workspace" }))
    const resume = await button("Resume My room is a mess")
    expect(await screen.findByText(next!)).toBeTruthy()
    await user.click(resume)
    expect((await nextAction()).textContent).toBe(next)
  })

  it("keeps an intake that was never sent", async () => {
    const user = userEvent.setup()
    const first = render(<WorkspaceApp />)
    await user.type(
      await screen.findByLabelText("What you’ve been putting off"),
      "half a thought"
    )
    first.unmount()
    render(<WorkspaceApp />)
    expect(
      await screen.findByLabelText("What you’ve been putting off")
    ).toHaveValue("half a thought")
  })

  it("keeps notes through leaving and returning", async () => {
    const state = run([
      {
        type: "start-case",
        id: "a",
        at: AT,
        input: "x y z",
        title: "Notes case",
        suggestedBlocker: null,
      },
      { type: "case-set-blocker", id: "a", at: AT, blocker: "cant-start" },
      {
        type: "save-work-doc",
        id: "a",
        at: AT,
        content: "<p>my rough draft</p>",
        cursor: 0,
      },
    ])
    seed(state)
    window.location.hash = "#/case/a"
    render(<WorkspaceApp />)
    expect(await screen.findByText("my rough draft")).toBeTruthy()
  })
})

const cleanupAndRender = (hash: string) => {
  document.body.innerHTML = ""
  window.location.hash = hash
  render(<WorkspaceApp />)
}

describe("Test H: the user corrects the system", () => {
  it("changes the tools and keeps the work, with no second case", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await nextAction()
    await user.click(await button("I did it"))
    await waitFor(() => expect(savedCase().completed).toHaveLength(1))
    const finished = savedCase().completed[0].text

    await user.click(await button(/Open notes and drafts/))
    const doc = await screen.findByRole("textbox", {
      name: /Working document/,
    })
    await user.click(doc)
    await user.keyboard("a note to keep")
    await waitFor(() =>
      expect(saved().tasks[0].workDoc?.content).toContain("a note to keep")
    )

    await user.click(await button("Change this"))
    expect(await screen.findByText(/Only the tools change/)).toBeTruthy()
    await user.click(await button(/I’m worried about what might happen\./))
    await screen.findByRole("heading", { name: "Reality Gap" })

    expect(saved().tasks).toHaveLength(1)
    expect(savedCase().blocker).toBe("worried")
    expect(savedCase().completed[0].text).toBe(finished)
    expect(saved().tasks[0].workDoc.content).toContain("a note to keep")
    expect(screen.queryByText("Reality Check")).toBeNull()

    // And back: what was drafted is still there.
    const known = screen.getByLabelText("What I know, item 1")
    await user.clear(known)
    await user.type(known, "edited by me")
    await user.click(await button("Change this"))
    await user.click(await button(/I’m already behind/))
    await screen.findByRole("heading", { name: "Reality Check" })
    expect(screen.queryByRole("heading", { name: "Reality Gap" })).toBeNull()
    await user.click(await button("Change this"))
    await user.click(await button(/I’m worried about what might happen\./))
    expect(await screen.findByLabelText("What I know, item 1")).toHaveValue(
      "edited by me"
    )
  })

  it("lets the user rewrite the suggested step in their own words", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    await nextAction()
    await user.click(await button("Change this step"))
    const input = await screen.findByRole("textbox", { name: "Your next step" })
    await user.clear(input)
    await user.type(input, "Open the window")
    await user.click(await button("Save this step"))
    expect(await nextAction()).toHaveTextContent("Open the window")
    expect(savedCase().current.origin).toBe("user")
    expect(saved().tasks[0].nextAction).toBe("Open the window")
  })
})

describe("definition of done", () => {
  it("goes from intake to an adapted plan and back, with nothing lost", async () => {
    const user = userEvent.setup()
    // 1. Enter it. 2. Correct the blocker.
    await intake(user, "I keep avoiding my tax forms")
    await user.click(await button(/I don’t know where to start\./))
    await user.click(await button("Change this"))
    await user.click(await button(/I’m worried about what might happen\./))
    // 3 and 4. The right tools, and Reality Gap.
    await screen.findByRole("heading", { name: "Reality Gap" })
    // 5. One next action. 6. Work on it here.
    await nextAction()
    await user.click(await button("Start with this"))
    await user.click(await button(/Open notes and drafts/))
    await user.click(
      await screen.findByRole("textbox", { name: /Working document/ })
    )
    await user.keyboard("the form is in the blue folder")
    await waitFor(() =>
      expect(saved().tasks[0].workDoc?.content).toContain("blue folder")
    )
    const before = (await nextAction()).textContent
    // 7. It didn't work. 8. An adapted Plan B.
    await user.click(await button("I’m stuck"))
    await user.click(await button("The step feels too big."))
    await waitFor(async () =>
      expect((await nextAction()).textContent).not.toBe(before)
    )
    // 9. Leave and return.
    const hash = window.location.hash
    const after = (await nextAction()).textContent
    cleanupAndRender(hash)
    expect((await nextAction()).textContent).toBe(after)
    expect(await screen.findByText(/blue folder/)).toBeTruthy()
    expect(saved().tasks).toHaveLength(1)
  })
})

describe("safety", () => {
  it("interrupts intake with support, and creates no case", async () => {
    const user = userEvent.setup()
    await intake(user, "I can't do this anymore, I want to kill myself")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("988")
    expect(saved().tasks).toHaveLength(0)
    expect(
      screen.queryByText("What’s making this difficult right now?")
    ).toBeNull()
    // It keeps the words rather than discarding them, and offers a way back.
    await user.click(within(alert).getByRole("button", { name: "Go back" }))
    expect(
      await screen.findByLabelText("What you’ve been putting off")
    ).toHaveValue("I can't do this anymore, I want to kill myself")
  })

  it("interrupts when the words appear in a Plan B answer", async () => {
    const user = userEvent.setup()
    await intake(user, "Sort the shed")
    await chooseBlocker(user, /I know what to do, but I can’t start\./)
    await user.click(await button("I’m stuck"))
    await user.click(await button("Something else."))
    await user.type(
      await screen.findByLabelText(/What happened/),
      "I want to die"
    )
    await user.click(await button("Find another way"))
    expect(await screen.findByRole("alert")).toHaveTextContent("988")
  })

  it("has no medical language in its choices", async () => {
    const user = userEvent.setup()
    await intake(user, "My room is a mess.")
    await screen.findByText("What’s making this difficult right now?")
    expect(document.body.textContent).not.toMatch(
      /ADHD|depress|anxiety|diagnos|disorder/i
    )
    expect(document.body.textContent).not.toMatch(/streak|points|badge/i)
    void user
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

  it("falls back in the app when the server fails, and says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json({ error: { message: "no" } }, { status: 502 })
          : Response.json({ live: true, model: "test" })
      )
    )
    const user = userEvent.setup()
    await intake(user, "My room is a mess. I don't know where to begin.")
    await chooseBlocker(user, /I don’t know where to start\./)
    expect(await nextAction()).toHaveTextContent("Choose one small area")
    expect(await screen.findByText(/Live AI couldn’t answer/)).toBeTruthy()
    expect(await screen.findByText("Built-in suggestion, not AI")).toBeTruthy()
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

  it("doesn't promise a different length while a timer is going", async () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "One", deadline: null },
      {
        type: "timer-start",
        id: "t",
        kind: "focus",
        taskId: "a",
        minutes: 10,
        now: Date.now(),
        at: AT,
      },
    ])
    seed(state)
    window.location.hash = "#/today"
    render(<WorkspaceApp />)
    expect(await button("Open the running 10-minute timer")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /^Start 5 minutes/ })
    ).toBeNull()
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

describe("accessibility", () => {
  const scan = async () => {
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations.map((item) => item.id)).toEqual([])
  }

  it("has no violations on home with cases", async () => {
    seed(
      run([
        {
          type: "start-case",
          id: "a",
          at: AT,
          input: "x y z",
          title: "Case",
          suggestedBlocker: null,
        },
        { type: "add-quick-task", id: "b", at: AT, title: "Buy lunch" },
      ])
    )
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Case" })
    await scan()
  })

  it.each([
    ["choosing", null],
    ["breakdown", "dont-know-start"],
    ["micro-action", "cant-start"],
    ["Reality Gap", "worried"],
    ["three paths", "behind"],
  ] as const)(
    "has no violations on the workspace: %s",
    async (_name, blocker) => {
      const user = userEvent.setup()
      await intake(user, "I missed my assignment and I'm afraid")
      await screen.findByText("What’s making this difficult right now?")
      if (blocker) {
        await user.click(
          await button(
            {
              "dont-know-start": /I don’t know where to start\./,
              "cant-start": /I know what to do, but I can’t start\./,
              worried: /I’m worried about what might happen\./,
              behind: /I’m already behind/,
            }[blocker]
          )
        )
        await screen.findByText("Open notes and drafts")
      }
      await scan()
    }
  )
})
