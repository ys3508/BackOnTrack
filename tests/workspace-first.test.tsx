// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import { MockLanguageModelV4 } from "ai/test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { generateStepHelp, generateWorkspaceSetup } from "@/lib/ai/task-assist"
import { buildCalendarItems } from "@/lib/calendar/events"
import { planRemaining } from "@/lib/calendar/plan-remaining"
import { concreteStep } from "@/lib/recovery/concrete"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import {
  buildBreakdownRequest,
  buildRecoveryRequest,
  buildStepHelpRequest,
  buildWorkspaceSetupRequest,
} from "@/lib/recovery/context"
import { demoBreakdown } from "@/lib/recovery/demo-breakdown"
import {
  demoStepHelp,
  demoWorkspaceSetup,
  findDates,
} from "@/lib/recovery/demo-setup"
import { markAsSuggested } from "@/lib/editor/suggestion-mark"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { addDays, localToday } from "@/lib/workspace/dates"
import { EMPTY_WORKSPACE, isInterrupted } from "@/lib/workspace/schemas"
import type { PlannedSession, Workspace } from "@/lib/workspace/schemas"
import {
  progressSummary,
  recentActions,
  recommendTask,
  usefulSmallerSteps,
} from "@/lib/workspace/selectors"
import { restoreWorkspace } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = "2026-11-05"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

const INSTRUCTIONS =
  "Assignment 3\n- Train a classifier on the provided dataset\n- Report the accuracy\nYou must submit a PDF by Friday."

const mlTask = (extra: WorkspaceAction[] = []) =>
  run([
    {
      type: "create-task",
      id: "a",
      at: AT,
      title: "Finish my machine learning assignment",
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
    ...extra,
  ])

const withSteps = () =>
  mlTask([
    {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "1",
      title: "Train a classifier on the provided dataset",
    },
    {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "2",
      title: "Report the accuracy",
    },
  ])

const seed = (state: Workspace) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...state, legacyMigrated: true })
  )

async function getEditor(): Promise<Editor> {
  await waitFor(() =>
    expect(document.querySelector(".ProseMirror")).toBeTruthy()
  )
  return (
    document.querySelector(".ProseMirror") as unknown as { editor: Editor }
  ).editor
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/today"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("next steps are concrete", () => {
  it("turns the reviewer's example into the action they asked for", () => {
    const step = concreteStep("Train a classifier on the provided dataset")
    expect(step.firstAction).toBe(
      "Open the dataset and identify the target column"
    )
    expect(step.starter.kind).toBe("code")
    expect(step.starter.content).toContain("```python")
    expect(step.starter.content).toContain("[your_dataset].csv")
    expect(step.smallerSteps[0]).toBe(step.firstAction)
  })

  it.each([
    "Compare it with one baseline model",
    "Report the accuracy",
    "Submit the PDF",
    "Read the requirements",
    "Write the introduction",
    "Apply for the role",
    "Reply to the email",
    "Water the plants",
  ])("makes %s into one action that never just asks to think", (title) => {
    const step = concreteStep(title)
    expect(step.firstAction).not.toMatch(/^\s*(think|consider|reflect)/i)
    expect(step.starter.content.length).toBeGreaterThan(10)
    expect(step.smallerSteps.length).toBeGreaterThanOrEqual(2)
  })

  it("puts a smaller step in front of a big one in a breakdown", () => {
    const state = mlTask()
    const { steps } = demoBreakdown(
      buildBreakdownRequest(state.tasks[0], state, TODAY)
    )
    const big = steps.indexOf("Train a classifier on the provided dataset")
    expect(steps[big - 1]).toBe(
      "Open the dataset and identify the target column"
    )
  })
})

describe("setting up the first workspace", () => {
  it("reads deliverables, dates, and dependencies from the instructions only", () => {
    const state = mlTask()
    const result = demoWorkspaceSetup(
      buildWorkspaceSetupRequest(state.tasks[0], state, TODAY)
    )
    expect(result.deliverables).toContain(
      "Train a classifier on the provided dataset"
    )
    expect(result.datesMentioned).toEqual(["by Friday"])
    expect(result.dependencies.join(" ")).toContain("provided dataset")
    expect(result.firstAction).toBe(
      "Open the dataset and identify the target column"
    )
    expect(result.starter.kind).toBe("code")
  })

  it("invents nothing when there are no instructions", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "Fix the bike" },
    ])
    const result = demoWorkspaceSetup(
      buildWorkspaceSetupRequest(state.tasks[0], state, TODAY)
    )
    expect(result.deliverables).toEqual([])
    expect(result.datesMentioned).toEqual([])
    expect(result.unclear.length).toBeGreaterThan(0)
    expect(result.steps.length).toBeGreaterThan(0)
  })

  it("finds common date formats", () => {
    expect(findDates("Due Nov 12, 2026 or 11/12 or on Friday.")).toEqual(
      expect.arrayContaining(["Nov 12, 2026", "11/12", "on Friday"])
    )
    expect(findDates("No dates here")).toEqual([])
  })
})

describe("live checks on starting work", () => {
  const usage = {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  }
  const modelReturning = (...outputs: unknown[]) => {
    let call = 0
    return new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(outputs[Math.min(call++, outputs.length - 1)]),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      }),
    })
  }
  const starter = {
    kind: "code",
    title: "Start",
    content: "```python\nprint(1)\n```",
  }
  const help = (firstAction: string) => ({
    firstAction,
    why: "w",
    starter,
    smallerSteps: ["One", "Two"],
    note: "",
  })
  const state = withSteps()
  const stepRequest = buildStepHelpRequest(
    state.tasks[0],
    state,
    TODAY,
    "Train a classifier"
  )

  it("rejects 'Think about how to train a classifier', the case in the review", async () => {
    const model = modelReturning(
      help("Think about how to train a classifier"),
      help("Open the dataset")
    )
    const result = await generateStepHelp(model, stepRequest)
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
      "asks them to think"
    )
    expect(result.firstAction).toBe("Open the dataset")
  })

  it("uses a labeled template if the model only ever gives vague help", async () => {
    const result = await generateStepHelp(
      modelReturning(help("Consider your options")),
      stepRequest
    )
    expect(result.usedFallback).toBe(true)
    expect(result.firstAction).toBe(
      "Open the dataset and identify the target column"
    )
    expect(demoStepHelp(stepRequest).note).toMatch(/not AI/)
  })

  it("drops a date the instructions don't contain", async () => {
    const model = modelReturning({
      summary: "s",
      deliverables: ["A report"],
      datesMentioned: ["by Friday", "December 25"],
      dependencies: [],
      unclear: [],
      steps: ["Open the data"],
      firstAction: "Open the data",
      starter,
      questions: [],
      outline: [],
      firstSection: { title: "Data", content: "[name]" },
      note: "",
    })
    const result = await generateWorkspaceSetup(
      model,
      buildWorkspaceSetupRequest(state.tasks[0], state, TODAY)
    )
    expect(result.datesMentioned).toEqual(["by Friday"])
  })
})

describe("splitting a step", () => {
  const split = (subId: string, state = withSteps()) =>
    workspaceReducer(state, {
      type: "split-subtask",
      id: "a",
      at: AT,
      subId,
      steps: [
        { id: "x", title: "Small one" },
        { id: "y", title: "Small two" },
      ],
    })

  it("replaces only that step, in place", () => {
    const titles = split("1").tasks[0].subtasks.map((sub) => sub.title)
    expect(titles).toEqual(["Small one", "Small two", "Report the accuracy"])
    expect(split("1").tasks[0].history.at(-1)?.kind).toBe("accepted")
  })

  it("never replaces finished work", () => {
    const done = workspaceReducer(withSteps(), {
      type: "toggle-subtask",
      id: "a",
      at: AT,
      subId: "1",
    })
    expect(split("1", done).tasks[0].subtasks[0]).toMatchObject({
      id: "1",
      done: true,
    })
  })
})

describe("in the app", () => {
  it("sets up a new task with one click: nothing changes until accepted", async () => {
    seed(mlTask())
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await user.click(await button("Set up my workspace"))
    await screen.findByText("What has to be handed in")
    expect(
      screen.getByText(/Your deadline hasn’t been changed/)
    ).toBeInTheDocument()
    expect(saved().tasks[0].subtasks).toEqual([])
    expect(editor.getText()).toBe("")

    await user.click(await button("Start from the code"))
    expect(editor.getHTML()).toContain("<pre")
    expect(saved().tasks[0].nextAction).toBe(
      "Open the dataset and identify the target column"
    )
    expect(saved().tasks[0].deadline).toBeNull()
    // Steps wait in the editable preview.
    expect(await screen.findByLabelText("Suggested step 1")).toBeInTheDocument()
    expect(saved().tasks[0].subtasks).toEqual([])
  })

  it("makes the current step smaller with Help me do this, and can split it", async () => {
    seed(withSteps())
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await user.click(await button("Help me do this"))
    await screen.findByText("Open the dataset and identify the target column")
    expect(
      screen.getByLabelText(/Suggested, and not in your document yet/)
    ).toBeInTheDocument()
    expect(screen.getByText(/This code hasn’t been run/)).toBeInTheDocument()
    expect(editor.getText()).toBe("")

    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)
    await user.click(
      (await screen.findAllByRole("button", { name: "Copy" }))[0]
    )
    expect(write.mock.calls[0][0]).toMatch(/^import pandas/)
    expect(write.mock.calls[0][0]).not.toContain("```")

    await user.click(await button("Use this"))
    expect(editor.getText()).toContain("import pandas")
    const titles = saved().tasks[0].subtasks.map(
      (sub: { title: string }) => sub.title
    )
    expect(titles[0]).toBe("Open the dataset and identify the target column")
    expect(titles).toContain("Report the accuracy")
    expect(titles).not.toContain("Train a classifier on the provided dataset")
  })

  it("changes nothing if the help is declined", async () => {
    seed(withSteps())
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await getEditor()
    await user.click(await button("Help me do this"))
    await user.click(await button("No thanks"))
    const task = saved().tasks[0]
    expect(task.subtasks).toHaveLength(2)
    expect(task.nextAction).toBe("")
    expect(task.history.at(-1).text).toMatch(/^Declined/)
  })

  it("opens the task and starts helping from the home page", async () => {
    seed(withSteps())
    window.location.hash = "#/today"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Help me do this"))
    await screen.findByText("Open the dataset and identify the target column")
    expect(window.location.hash).toBe("#/tasks/a/help")
  })

  it("offers workspace setup from the home page for a new task", async () => {
    seed(mlTask())
    window.location.hash = "#/today"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Set up my workspace"))
    await screen.findByText("What has to be handed in")
  })

  it("opens the document with the timer when starting focus from home", async () => {
    seed(withSteps())
    window.location.hash = "#/today"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start 5 minutes"))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/a/doc"))
    expect(await screen.findByRole("timer")).toBeInTheDocument()
    expect(
      screen.getAllByText("Train a classifier on the provided dataset").length
    ).toBeGreaterThan(0)
    const editor = await getEditor()
    await waitFor(() => expect(editor.isFocused).toBe(true))
    expect(await button("Pause timer")).toBeInTheDocument()
  })

  it("does the same from the Focus page, and stays there with no task", async () => {
    seed(withSteps())
    window.location.hash = "#/focus"
    const user = userEvent.setup()
    const { unmount } = render(<WorkspaceApp />)
    await user.click(await button("5-minute Quick Start"))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/a/doc"))
    unmount()

    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/focus"
    render(<WorkspaceApp />)
    await user.click(await button("5-minute Quick Start"))
    expect(await screen.findByRole("timer")).toBeInTheDocument()
    expect(window.location.hash).toBe("#/focus")
  })

  it("adds the code block control, and keeps instructions open while working", async () => {
    seed(withSteps())
    window.location.hash = "#/tasks/a/doc"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    expect(
      screen.getByRole("region", { name: "Your instructions" })
    ).toHaveTextContent("Train a classifier")
    await user.click(await button("Code block"))
    expect(editor.isActive("codeBlock")).toBe(true)
  })

  it("shows a break on the task page, not a session on something else", async () => {
    const state = run(
      [
        {
          type: "timer-start",
          id: "s",
          kind: "focus",
          taskId: "a",
          minutes: 5,
          now: Date.now() - 400_000,
          at: AT,
        },
      ],
      withSteps()
    )
    seed(state)
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Yes"))
    await user.click(await button(/5-minute break/))
    expect(await screen.findByText("Break")).toBeInTheDocument()
    expect(
      screen.queryByText(/already running on something else/)
    ).not.toBeInTheDocument()
  })
})

describe("suggestion marks and code", () => {
  it("doesn't put marks on code blocks, which can't hold them", () => {
    const code = {
      type: "codeBlock",
      content: [{ type: "text", text: "x = 1" }],
    }
    expect(markAsSuggested(code)).toEqual(code)
    const paragraph = markAsSuggested({
      type: "paragraph",
      content: [{ type: "text", text: "Hi" }],
    })
    expect(paragraph.content?.[0].marks).toEqual([{ type: "suggestion" }])
  })
})

describe("adaptive Plan B", () => {
  const request = (
    state: Workspace,
    rejected: { nextStep: string; artifactTitle: string }[] = []
  ) => buildRecoveryRequest(state.tasks[0], state, TODAY, { rejected })

  it("gives a code starting point, and shrinks the step, when stuck on a big coding step", () => {
    const { plan } = demoTaskRecovery(request(withSteps()))
    expect(plan.nextStep.instruction).toBe(
      "Open the dataset and identify the target column"
    )
    expect(plan.artifact.kind).toBe("code")
    expect(plan.artifact.body).toContain("[your_dataset].csv")
    expect(plan.smallerSteps[0]).toBe(
      "Open the dataset and identify the target column"
    )
  })

  it("stays different, and never says to think, across repeated I'm stuck", () => {
    const seen = new Set<string>()
    const rejected: { nextStep: string; artifactTitle: string }[] = []
    for (let i = 0; i < 4; i++) {
      const { plan } = demoTaskRecovery(request(withSteps(), rejected))
      expect(seen.has(plan.nextStep.instruction)).toBe(false)
      expect(plan.nextStep.instruction).not.toMatch(
        /^\s*(think|consider|reflect)/i
      )
      seen.add(plan.nextStep.instruction)
      rejected.push({
        nextStep: plan.nextStep.instruction,
        artifactTitle: plan.artifact.title,
      })
    }
  })

  it("knows how many plans have been tried on this step, and what's been finished", () => {
    const recovery = {
      analysis: demoTaskRecovery(request(withSteps())).analysis,
      plan: demoTaskRecovery(request(withSteps())).plan,
      strategy: null,
      source: "demo" as const,
      usedFallback: false,
      exhausted: false,
      createdAt: AT,
    }
    let state = workspaceReducer(withSteps(), {
      type: "set-recovery",
      id: "a",
      recovery,
    })
    state = workspaceReducer(state, {
      type: "decline-recovery",
      id: "a",
      at: AT,
    })
    state = workspaceReducer(state, { type: "set-recovery", id: "a", recovery })
    state = workspaceReducer(state, {
      type: "decline-recovery",
      id: "a",
      at: AT,
    })
    expect(request(state).task.stuckOnStep).toBe(2)
    expect(request(state).task.attempts.join(" ")).toContain("Declined")

    const done = workspaceReducer(state, {
      type: "toggle-subtask",
      id: "a",
      at: AT,
      subId: "1",
    })
    expect(request(done).task.stuckOnStep).toBe(0)
    expect(request(done).task.completedActions.join(" ")).toContain(
      "Train a classifier"
    )
  })

  it("applies smaller steps from a recovery plan, keeping finished work", async () => {
    const state = run(
      [
        {
          type: "add-subtask",
          id: "a",
          at: AT,
          subId: "0",
          title: "Read the brief",
        },
        { type: "toggle-subtask", id: "a", at: AT, subId: "0" },
        {
          type: "add-subtask",
          id: "a",
          at: AT,
          subId: "1",
          title: "Train a classifier on the provided dataset",
        },
      ],
      mlTask()
    )
    seed(state)
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    await screen.findByRole("heading", { name: "Make this step smaller" })
    expect(screen.getByText(/This code hasn’t been run/)).toBeInTheDocument()
    await user.click(await button("Add selected to my task"))
    await waitFor(() => expect(saved().tasks[0].recovery).toBeNull())
    const subs = saved().tasks[0].subtasks
    expect(subs[0]).toMatchObject({ title: "Read the brief", done: true })
    expect(subs[1].title).toBe(
      "Open the dataset and identify the target column"
    )
    expect(subs.map((sub: { title: string }) => sub.title)).not.toContain(
      "Train a classifier on the provided dataset"
    )
  })
})

describe("code help in the editor", () => {
  it("previews a code starting point, and inserts it as a code block", async () => {
    seed(withSteps())
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await user.click(await button("Give me a code starting point"))
    expect(
      ((await screen.findByLabelText(/Suggested text/)) as HTMLTextAreaElement)
        .value
    ).toContain("import pandas")
    expect(screen.getByText(/hasn’t been run/)).toBeInTheDocument()
    expect(editor.getText()).toBe("")
    await user.click(await button("Add to my document"))
    expect(editor.getHTML()).toContain("<pre")
  })
})

describe("planning remaining work", () => {
  const base = {
    today: "2026-11-02", // A Monday.
    deadline: "2026-11-06" as string | null,
    minutesPerDay: 30,
    skipWeekends: false,
    existing: [] as PlannedSession[],
  }

  it("spreads steps over the days before the deadline", () => {
    const { sessions, unscheduled } = planRemaining({
      ...base,
      steps: ["A", "B", "C"],
    })
    expect(unscheduled).toEqual([])
    expect(
      sessions.every(
        (item) => item.date >= base.today && item.date <= "2026-11-06"
      )
    ).toBe(true)
    const perDay: Record<string, number> = {}
    sessions.forEach((item) => {
      perDay[item.date] = (perDay[item.date] ?? 0) + item.minutes
    })
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(30)
    expect(sessions.reduce((sum, item) => sum + item.minutes, 0)).toBe(75)
  })

  it("says what doesn't fit, instead of pretending", () => {
    const { unscheduled, sessions } = planRemaining({
      ...base,
      deadline: "2026-11-02",
      minutesPerDay: 30,
      steps: ["A", "B"],
    })
    expect(sessions.map((item) => item.label)).toEqual(["A"])
    expect(unscheduled).toEqual(["B"])
  })

  it("respects weekends, and work already planned", () => {
    const weekend = planRemaining({
      ...base,
      today: "2026-11-07", // A Saturday.
      deadline: "2026-11-09",
      skipWeekends: true,
      steps: ["A"],
    })
    expect(weekend.sessions[0].date).toBe("2026-11-09")

    const planned: PlannedSession = {
      id: "p",
      taskId: "a",
      date: "2026-11-02",
      time: null,
      minutes: 30,
      label: "Other",
      done: false,
    }
    const busy = planRemaining({ ...base, steps: ["A"], existing: [planned] })
    expect(busy.sessions[0].date).toBe("2026-11-03")

    const already = planRemaining({
      ...base,
      steps: ["Other", "A"],
      existing: [planned],
    })
    expect(already.sessions.map((item) => item.label)).toEqual(["A"])
  })

  it("plans ahead, from today, when a deadline has passed or doesn't exist", () => {
    const passed = planRemaining({
      ...base,
      deadline: "2026-10-01",
      steps: ["A"],
    })
    expect(passed.deadlinePassed).toBe(true)
    expect(passed.sessions[0].date).toBe(base.today)
    // Without a deadline, the plan looks two weeks ahead.
    const steps = Array.from({ length: 20 }, (_, index) => `Step ${index}`)
    const open = planRemaining({ ...base, deadline: null, steps })
    expect(open.sessions.at(-1)?.date).toBe("2026-11-15")
    expect(open.unscheduled.length).toBeGreaterThan(0)
  })

  it("adds nothing until confirmed, and never changes the deadline", async () => {
    const today = localToday()
    const deadline = addDays(today, 5)
    seed(
      run([
        { type: "create-task", id: "a", at: AT, title: "Essay", deadline },
        {
          type: "add-subtask",
          id: "a",
          at: AT,
          subId: "1",
          title: "Write the intro",
        },
        {
          type: "add-subtask",
          id: "a",
          at: AT,
          subId: "2",
          title: "Write the end",
        },
      ])
    )
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Plan remaining work"))
    const list = await screen.findByRole("list", {
      name: "Suggested work sessions",
    })
    expect(saved().planned).toEqual([])
    expect(
      screen.getByText(/Calculated from your open steps/)
    ).toBeInTheDocument()
    expect(screen.getByText(/this won’t change it/)).toBeInTheDocument()

    const boxes = within(list).getAllByRole("checkbox")
    await user.click(boxes[0])
    await user.click(
      await button(new RegExp(`^Add ${boxes.length - 1} to my calendar`))
    )
    expect(saved().planned).toHaveLength(boxes.length - 1)
    expect(saved().tasks[0].deadline).toBe(deadline)
    expect(await screen.findByText(/to your calendar/)).toBeInTheDocument()
  })

  it("is available from the task too", async () => {
    seed(withSteps())
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Plan remaining work"))
    expect(
      await screen.findByRole("list", { name: "Suggested work sessions" })
    ).toBeInTheDocument()
  })
})

describe("small details", () => {
  it("doesn't ask for a priority, and scores a task without one lowest", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "No priority" },
      {
        type: "create-task",
        id: "b",
        at: AT,
        title: "Medium",
        priority: "medium",
      },
    ])
    expect(state.tasks[0].priority).toBe("none")
    expect(recommendTask(state, TODAY)?.id).toBe("b")
  })

  it("shows No priority as the default when creating a task", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/tasks"
    render(<WorkspaceApp />)
    expect(await screen.findByLabelText("Priority (optional)")).toHaveValue(
      "none"
    )
  })

  it("keeps saved priorities, and defaults old data with none to none", () => {
    expect(
      restoreWorkspace({
        version: 2,
        tasks: [
          {
            id: "a",
            title: "T",
            status: "not-started",
            createdAt: AT,
            updatedAt: AT,
            priority: "high",
          },
          {
            id: "b",
            title: "U",
            status: "not-started",
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      }).tasks.map((task) => task.priority)
    ).toEqual(["high", "none"])
  })

  const stopAfter = (
    seconds: number,
    outcome: "continue-later" | "stuck" = "continue-later"
  ) =>
    run(
      [
        {
          type: "timer-start",
          id: "s",
          kind: "focus",
          taskId: "a",
          minutes: 5,
          now: 0,
          at: AT,
        },
        { type: "timer-stop", now: seconds * 1000, at: AT, outcome, note: "" },
      ],
      withSteps()
    )

  it("marks a 2-second session as an interrupted attempt, not focus time", () => {
    const state = stopAfter(2)
    const task = state.tasks[0]
    expect(isInterrupted(state.focusSessions[0])).toBe(true)
    expect(task.history.at(-1)?.text).toBe("Interrupted attempt (2 sec)")
    expect(recentActions(state)).toEqual([])
    const summary = progressSummary(task, state)
    expect(summary).toContain("1 interrupted attempt")
    expect(summary).not.toContain("on the timer")
    expect(
      buildCalendarItems(state, TODAY).filter(
        (item) => item.extendedProps.kind === "focused"
      )
    ).toEqual([])
  })

  it("counts a real session, including a finished one", () => {
    const state = stopAfter(120)
    expect(isInterrupted(state.focusSessions[0])).toBe(false)
    expect(progressSummary(state.tasks[0], state)).toContain(
      "2 min on the timer"
    )
    expect(state.tasks[0].history.at(-1)?.text).toContain(
      "Stopped focus after 2 min"
    )
  })

  it("labels it in the session history", async () => {
    seed(stopAfter(2))
    window.location.hash = "#/focus"
    render(<WorkspaceApp />)
    expect(
      await screen.findByText(/Interrupted attempt, not counted as focus time/)
    ).toBeInTheDocument()
  })
})

describe("what the browser check found", () => {
  const split = () =>
    workspaceReducer(withSteps(), {
      type: "split-subtask",
      id: "a",
      at: AT,
      subId: "1",
      steps: [
        { id: "n1", title: "Open the dataset and identify the target column" },
        { id: "n2", title: "Fit one simple classifier" },
      ],
    })

  it("goes smaller, not in circles, when the step is already the small version", () => {
    const { plan } = demoTaskRecovery(
      buildRecoveryRequest(split().tasks[0], split(), TODAY, { rejected: [] })
    )
    expect(plan.nextStep.instruction).toMatch(/^Find where the dataset file/)
    expect(plan.smallerSteps).not.toContain(
      "Open the dataset and identify the target column"
    )
    expect(JSON.stringify(plan.schedule)).not.toContain("undefined")
  })

  it("never offers smaller steps that repeat ones already on the list", () => {
    const task = split().tasks[0]
    expect(
      usefulSmallerSteps(task, [
        "Open the dataset and identify the target column",
        "Fit one simple classifier",
      ])
    ).toEqual([])
    expect(
      usefulSmallerSteps(task, [
        "Find the file",
        "Fit one simple classifier",
        "Read its columns",
      ])
    ).toEqual(["Find the file", "Read its columns"])
  })

  it("keeps a running timer on the work when its step is split", () => {
    const running = run(
      [
        {
          type: "timer-start",
          id: "s",
          kind: "focus",
          taskId: "a",
          subtaskId: "1",
          minutes: 5,
          now: 0,
          at: AT,
        },
      ],
      withSteps()
    )
    const after = workspaceReducer(running, {
      type: "split-subtask",
      id: "a",
      at: AT,
      subId: "1",
      steps: [{ id: "n1", title: "Smaller" }],
    })
    expect(after.timer?.subtaskId).toBe("n1")
  })
})

describe("repeated stuck, after accepting code", () => {
  it("doesn't add smaller steps twice, or suggest a sentence after a line of code", () => {
    const state = workspaceReducer(withSteps(), {
      type: "save-work-doc",
      id: "a",
      at: AT,
      content: "<pre><code>print(data.columns)</code></pre>",
      cursor: 1,
    })
    const first = demoTaskRecovery(
      buildRecoveryRequest(state.tasks[0], state, TODAY, { rejected: [] })
    ).plan
    expect(first.steps).toEqual([])
    expect(first.schedule[0].label).toBeTruthy()
    const second = demoTaskRecovery(
      buildRecoveryRequest(state.tasks[0], state, TODAY, {
        rejected: [
          {
            nextStep: first.nextStep.instruction,
            artifactTitle: first.artifact.title,
          },
        ],
      })
    ).plan
    expect(second.nextStep.instruction).not.toContain("print(data.columns)")
  })
})

describe("planning keeps steps whole", () => {
  const base = {
    today: "2026-11-02",
    deadline: "2026-11-08",
    skipWeekends: false,
    existing: [] as PlannedSession[],
  }

  it("doesn't scatter a step across days when one day can hold it", () => {
    const { sessions } = planRemaining({
      ...base,
      minutesPerDay: 30,
      steps: ["A", "B", "C"],
    })
    expect(
      sessions.map((item) => [item.date, item.minutes, item.label])
    ).toEqual([
      ["2026-11-02", 25, "A"],
      ["2026-11-03", 25, "B"],
      ["2026-11-04", 25, "C"],
    ])
  })

  it("only splits a step when the time per day is shorter than the step", () => {
    const { sessions } = planRemaining({
      ...base,
      minutesPerDay: 15,
      steps: ["A"],
    })
    expect(sessions.map((item) => item.minutes)).toEqual([15, 10])
  })
})
