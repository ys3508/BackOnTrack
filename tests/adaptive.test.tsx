// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildRecoveryRequest, taskFacts } from "@/lib/recovery/context"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import { TaskRecoveryRequestSchema } from "@/lib/schemas"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { progressSummary, recentActions } from "@/lib/workspace/selectors"

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
const TODAY = "2026-11-05"
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })

const INSTRUCTIONS =
  "Machine learning project.\n- Train a classifier\n- Report the accuracy\nYou must submit a PDF."

const assignment = (extra: WorkspaceAction[] = []) =>
  run([
    {
      type: "create-task",
      id: "a",
      at: AT,
      title: "Machine learning assignment",
      deadline: "2026-11-15",
    },
    {
      type: "set-instructions",
      id: "a",
      at: AT,
      instructions: {
        text: INSTRUCTIONS,
        sourceName: "",
        kind: "paste",
        truncated: false,
        addedAt: AT,
      },
    },
    {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "1",
      title: "Read the requirements",
    },
    {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "2",
      title: "Write the introduction",
    },
    { type: "toggle-subtask", id: "a", at: AT, subId: "1" },
    ...extra,
  ])

const request = (state: Workspace, options = {}) =>
  buildRecoveryRequest(state.tasks[0], state, TODAY, options)

describe("adaptive recovery uses real progress", () => {
  it("sends completed work, the current step, the document, and time left", () => {
    const state = assignment([
      {
        type: "save-work-doc",
        id: "a",
        at: AT,
        content: "<h2>Intro</h2><p>My first line</p>",
        cursor: 1,
      },
    ])
    const built = request(state, { obstacle: "Blank page" })
    expect(TaskRecoveryRequestSchema.safeParse(built).success).toBe(true)
    expect(built.task.currentStep).toBe("Write the introduction")
    expect(built.task.completedActions).toEqual([
      "Completed: Read the requirements",
    ])
    expect(built.task.document).toContain("My first line")
    expect(built.task.document).not.toContain("<p>")
    expect(built.task.instructions).toContain("Train a classifier")
    expect(taskFacts(built, TODAY).known.join(" ")).toContain("10 days away")
    expect(taskFacts(built, TODAY).known.join(" ")).toContain(
      "Write the introduction"
    )
  })

  it("offers three openings to pick from when stuck on writing", () => {
    const { plan } = demoTaskRecovery(request(assignment()))
    expect(plan.choices).toHaveLength(3)
    expect(plan.choices[0]).toContain("Train a classifier")
    expect(plan.nextStep.instruction).not.toMatch(/try writing one sentence/i)
    expect(plan.nextStep.instruction).toMatch(/Choose one of these openings/)
  })

  it("turns instructions into a checklist when they don't understand what's wanted", () => {
    const { plan } = demoTaskRecovery(
      request(assignment(), {
        obstacle: "I don't understand what the professor wants",
      })
    )
    expect(plan.artifact.kind).toBe("checklist")
    expect(plan.artifact.body).toContain("- [ ] Train a classifier")
    expect(plan.artifact.body).toContain("- [ ] Report the accuracy")
    expect(plan.artifact.body).toContain("What I'd ask about")
    expect(plan.nextStep.why).toMatch(/simple text rules/)
  })

  it("reuses what's in the document", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "Clean up the notes" },
      {
        type: "save-work-doc",
        id: "a",
        at: AT,
        content: "<p>The last thing I wrote</p>",
        cursor: 1,
      },
    ])
    const { plan } = demoTaskRecovery(request(state))
    expect(plan.nextStep.instruction).toContain("The last thing I wrote")
  })

  it("gives a meaningfully different plan each time it's rejected", () => {
    const seen = new Set<string>()
    const rejected: { nextStep: string; artifactTitle: string }[] = []
    for (let i = 0; i < 4; i++) {
      const { plan } = demoTaskRecovery(request(assignment(), { rejected }))
      expect(seen.has(plan.nextStep.instruction)).toBe(false)
      seen.add(plan.nextStep.instruction)
      rejected.push({
        nextStep: plan.nextStep.instruction,
        artifactTitle: plan.artifact.title,
      })
    }
  })
})

describe("activity history is honest", () => {
  const kinds = (state: Workspace) =>
    Object.fromEntries(
      state.tasks[0].history.map((event) => [event.text, event.kind])
    )

  it("separates suggested, accepted, attempted, and completed", () => {
    const state = assignment([
      {
        type: "set-recovery",
        id: "a",
        obstacle: "Stuck",
        recovery: {
          analysis: demoTaskRecovery(request(assignment())).analysis,
          plan: {
            ...demoTaskRecovery(request(assignment())).plan,
            nextStep: {
              instruction: "Do X",
              why: "",
              minutes: 5,
              approach: "decide",
            },
          },
          strategy: null,
          source: "demo",
          usedFallback: false,
          exhausted: false,
          createdAt: AT,
        },
      },
      { type: "report-stuck", id: "a", at: AT, text: "Too big" },
      {
        type: "timer-start",
        id: "s",
        kind: "focus",
        taskId: "a",
        minutes: 5,
        now: 0,
        at: AT,
      },
      { type: "timer-finish", now: 300_000 },
    ])
    const found = kinds(state)
    expect(found["Completed: Read the requirements"]).toBe("completed")
    expect(found["Suggested a recovery plan (Demo Mode template): Do X"]).toBe(
      "suggested"
    )
    expect(found["Reported being stuck"]).toBe("attempted")
    expect(found["Too big"]).toBe("attempted")
    expect(found["Started a focus session (5 min)"]).toBe("attempted")
    expect(found["Focus session finished (5 min)"]).toBe("attempted")
  })

  it("never counts a suggestion or timer as completed work", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "T" },
      {
        type: "timer-start",
        id: "s",
        kind: "focus",
        taskId: "a",
        minutes: 5,
        now: 0,
        at: AT,
      },
      { type: "timer-finish", now: 300_000 },
      {
        type: "set-breakdown",
        id: "a",
        at: AT,
        breakdown: {
          steps: ["Step"],
          note: "",
          ambiguities: [],
          source: "demo",
          usedFallback: false,
          createdAt: AT,
        },
      },
    ])
    expect(recentActions(state)).toEqual([])
    expect(state.tasks[0].status).toBe("in-progress")
    expect(state.tasks[0].progress).toBe(0)
    expect(progressSummary(state.tasks[0], state)).toContain("on the timer")
  })

  it("uses the real time of each event, including a timer's actual end", () => {
    const t0 = Date.UTC(2026, 10, 5, 9, 0, 0)
    const state = run([
      {
        type: "create-task",
        id: "a",
        at: new Date(t0).toISOString(),
        title: "T",
      },
      {
        type: "timer-start",
        id: "s",
        kind: "focus",
        taskId: "a",
        minutes: 5,
        now: t0,
        at: new Date(t0).toISOString(),
      },
      // Noticed three hours later, for example after reopening the page.
      { type: "timer-finish", now: t0 + 3 * 3600_000 },
    ])
    const finished = state.tasks[0].history.at(-1)!
    expect(finished.at).toBe(new Date(t0 + 5 * 60_000).toISOString())
  })

  it("tracks recovery attempts and what happened to them", () => {
    const pending = demoTaskRecovery(request(assignment()))
    const recovery = {
      analysis: pending.analysis,
      plan: pending.plan,
      strategy: null,
      source: "demo" as const,
      usedFallback: false,
      exhausted: false,
      createdAt: AT,
    }
    let state = assignment([
      { type: "set-recovery", id: "a", recovery, obstacle: "Blank page" },
    ])
    expect(state.tasks[0].recoveryAttempts[0]).toMatchObject({
      obstacle: "Blank page",
      subtaskId: "2",
      outcome: "suggested",
    })
    state = workspaceReducer(state, {
      type: "decline-recovery",
      id: "a",
      at: AT,
    })
    expect(state.tasks[0].recoveryAttempts[0].outcome).toBe("declined")
    state = workspaceReducer(state, { type: "set-recovery", id: "a", recovery })
    state = workspaceReducer(state, {
      type: "apply-recovery",
      id: "a",
      at: AT,
      nextAction: null,
      document: null,
      steps: [],
      schedule: [],
      release: false,
    })
    expect(
      state.tasks[0].recoveryAttempts.map((attempt) => attempt.outcome)
    ).toEqual(["declined", "accepted"])
    expect(state.tasks[0].subtasks[0]).toMatchObject({
      title: "Read the requirements",
      done: true,
    })
  })

  it("escapes text added to the document", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "T" },
      {
        type: "append-to-doc",
        id: "a",
        at: AT,
        text: "<img src=x onerror=alert(1)>",
        label: "Draft",
      },
    ])
    expect(state.tasks[0].workDoc?.content).toContain("&lt;img")
    expect(state.tasks[0].workDoc?.content).toContain("data-suggested")
  })
})

describe("in the app", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.scrollTo = vi.fn() as typeof window.scrollTo
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ live: false, model: null }))
    )
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...assignment(), legacyMigrated: true })
    )
  })

  it("inserts a chosen opening into the document, marked as suggested", async () => {
    window.location.hash = `#/recover/a`
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    const heading = await screen.findByRole("heading", {
      name: "Pick one to put in your document",
    })
    const choice = within(heading.parentElement!).getAllByRole("button")[0]
    const text = choice.textContent!
    await user.click(choice)
    await waitFor(() =>
      expect(saved().tasks[0].workDoc?.content).toContain("data-suggested")
    )
    const task = saved().tasks[0]
    expect(task.workDoc.content).toContain(text.slice(0, 30))
    expect(task.recovery).toBeNull()
    expect(task.recoveryAttempts[0].outcome).toBe("accepted")
    expect(JSON.stringify(task.history)).toContain("Reported being stuck")
    await waitFor(() =>
      expect(document.querySelector(".ProseMirror")?.textContent).toContain(
        text.slice(0, 30)
      )
    )
    expect(document.querySelector(".ProseMirror [data-suggested]")).toBeTruthy()
  })

  it("labels each history entry by what really happened", async () => {
    window.location.hash = "#/tasks/a"
    render(<WorkspaceApp />)
    const history = (await screen.findByRole("heading", { name: "History" }))
      .parentElement!
    expect(within(history).getByText("Done")).toBeInTheDocument()
    expect(
      within(history).getByText("Completed: Read the requirements")
    ).toBeInTheDocument()
  })

  it("resumes without repeating a Reality Check", async () => {
    window.location.hash = "#/plan"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Continue where you left off" })
    expect(
      screen.getByText(
        /You completed 1 of 2 steps for Machine learning assignment/
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Write the introduction")).toBeInTheDocument()
    expect(screen.queryByText("Known facts")).not.toBeInTheDocument()
    await user.click(await button("Open my document"))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/a/doc"))
  })
})
