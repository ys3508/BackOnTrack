// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import { MockLanguageModelV4 } from "ai/test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { generateStepHelp, generateWorkspaceSetup } from "@/lib/ai/task-assist"
import { concreteStep } from "@/lib/recovery/concrete"
import {
  buildBreakdownRequest,
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
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"

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
  window.location.hash = ""
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

    await user.click(await button("Use this"))
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
    window.location.hash = "#/"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Help me do this"))
    await screen.findByText("Open the dataset and identify the target column")
    expect(window.location.hash).toBe("#/tasks/a/help")
  })

  it("offers workspace setup from the home page for a new task", async () => {
    seed(mlTask())
    window.location.hash = "#/"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Set up my workspace"))
    await screen.findByText("What has to be handed in")
  })

  it("opens the document with the timer when starting focus from home", async () => {
    seed(withSteps())
    window.location.hash = "#/"
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
