// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import axe from "axe-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { demoWorkspaceSetup } from "@/lib/recovery/demo-setup"
import { buildWorkspaceSetupRequest } from "@/lib/recovery/context"
import { entryPoints, preparedDocument } from "@/lib/recovery/prepared"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { isAway, returnSummary } from "@/lib/workspace/returning"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { exportWorkspace, parseImport } from "@/lib/workspace/storage"

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
const TODAY = localToday()
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY).toISOString()
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

/** A paper with real progress, an overdue deadline, and other overdue tasks. */
const inProgress = () =>
  run([
    {
      type: "create-task",
      id: "a",
      at: AT,
      title: "Research paper",
      deadline: addDays(TODAY, -3),
    },
    { type: "add-subtask", id: "a", at: AT, subId: "1", title: "Pick a topic" },
    {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "2",
      title: "Write the introduction",
    },
    { type: "toggle-subtask", id: "a", at: AT, subId: "1" },
    {
      type: "save-work-doc",
      id: "a",
      at: AT,
      content: "<p>Sleep affects memory.</p>",
      cursor: 1,
    },
    {
      type: "create-task",
      id: "b",
      at: AT,
      title: "Old overdue chore",
      deadline: addDays(TODAY, -20),
    },
    {
      type: "create-task",
      id: "c",
      at: AT,
      title: "Another overdue chore",
      deadline: addDays(TODAY, -30),
    },
  ])

const seed = (state: Workspace, lastOpenedAt: string | null) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...state, legacyMigrated: true, lastOpenedAt })
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
  window.location.hash = "#/"
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("deciding someone has been away", () => {
  it("needs a few days since the app was last opened", () => {
    const now = Date.now()
    expect(isAway(null, now)).toBe(false)
    expect(isAway(daysAgo(1), now)).toBe(false)
    expect(isAway(new Date(now - 3 * DAY).toISOString(), now)).toBe(true)
    expect(isAway("not a date", now)).toBe(false)
  })

  it("keeps the last opened time through a backup, and accepts old data", () => {
    const state = { ...inProgress(), lastOpenedAt: AT }
    expect(parseImport(exportWorkspace(state))?.lastOpenedAt).toBe(AT)
    // JSON leaves out undefined, which is how a backup from before this looks.
    const old = { ...state, lastOpenedAt: undefined } as unknown as Workspace
    expect(parseImport(exportWorkspace(old))?.lastOpenedAt).toBeNull()
  })
})

describe("what a returning person sees", () => {
  it("uses only what was recorded", () => {
    const summary = returnSummary(inProgress(), TODAY)!
    expect(summary.task.id).toBe("a")
    expect(summary).toMatchObject({
      done: 1,
      total: 2,
      lastFinished: "Pick a topic",
      nextStep: "Write the introduction",
      documentWords: 3,
      documentEndsWith: "Sleep affects memory.",
      deadlineWasMissed: true,
      neverStarted: false,
    })
  })

  it("mentions a deadline that's about to matter, and not old ones", () => {
    expect(returnSummary(inProgress(), TODAY)!.alsoDue).toBeNull()
    const state = run(
      [
        {
          type: "create-task",
          id: "d",
          at: AT,
          title: "Pay the bill",
          deadline: addDays(TODAY, 1),
        },
      ],
      inProgress()
    )
    expect(returnSummary(state, TODAY)!.alsoDue?.title).toBe("Pay the bill")
  })

  it("stays out of the way of a running timer, or with nothing to return to", () => {
    expect(returnSummary(EMPTY_WORKSPACE, TODAY)).toBeNull()
    const running = run(
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
      ],
      inProgress()
    )
    expect(returnSummary(running, TODAY)).toBeNull()
  })
})

describe("coming back in the app", () => {
  it("shows one way back in, with no backlog and no time-away figure", async () => {
    seed(inProgress(), daysAgo(14))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", {
      level: 1,
      name: "Pick up where you left off",
    })
    expect(
      screen.getByText(/You don’t need to catch up on everything/)
    ).toBeInTheDocument()
    expect(screen.getByText("Write the introduction")).toBeInTheDocument()
    expect(screen.getByText(/It stops at: “Sleep affects memory/)).toBeTruthy()
    // It's honest about this task's deadline, without changing it.
    expect(screen.getByText(/That hasn’t been changed/)).toBeInTheDocument()
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, -3))

    const page = document.querySelector("main")!.textContent!
    expect(page).not.toMatch(/overdue|chore|\b14\b|weeks?|days? ago|streak/i)
    expect(screen.queryByRole("button", { name: /stuck/i })).toBeNull()
    expect(screen.getByText(/built-in suggestion/)).toBeInTheDocument()
  })

  it("Continue working opens the document, and home is normal afterwards", async () => {
    seed(inProgress(), daysAgo(14))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Continue working"))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/a/doc"))
    expect((await getEditor()).getText()).toContain("Sleep affects memory.")

    await user.click(await button("Workspace"))
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Pick up where you left off" })
      ).toBeNull()
    )
  })

  it("can choose a different task", async () => {
    seed(inProgress(), daysAgo(14))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/Or choose a different task/))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"))
    expect(await screen.findByText("Old overdue chore")).toBeInTheDocument()
  })

  it("offers to prepare a start when nothing was ever started", async () => {
    seed(
      run([{ type: "create-task", id: "a", at: AT, title: "My paper" }]),
      daysAgo(14)
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByText(/nothing to redo/)
    await user.click(await button("Prepare a place to start"))
    await screen.findByRole("group", { name: "Where do you want to begin?" })
  })

  it("isn't shown on first use, or after a short gap", async () => {
    seed(inProgress(), null)
    const first = render(<WorkspaceApp />)
    await screen.findByRole("heading", { level: 1 })
    expect(screen.queryByText("Continue working")).toBeNull()
    await waitFor(() => expect(saved().lastOpenedAt).toBeTruthy())
    first.unmount()

    seed(inProgress(), daysAgo(1))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { level: 1 })
    expect(screen.queryByText("Continue working")).toBeNull()
  })

  it("has no accessibility violations", async () => {
    seed(inProgress(), daysAgo(14))
    render(<WorkspaceApp />)
    await button("Continue working")
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const { violations } = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(violations.map((item) => item.id)).toEqual([])
  })
})

describe("Zero-Start: the work is prepared before the user begins", () => {
  const setup = (title: string, instructions = "") => {
    let state = run([{ type: "create-task", id: "a", at: AT, title }])
    if (instructions) {
      state = workspaceReducer(state, {
        type: "set-instructions",
        id: "a",
        at: AT,
        instructions: {
          text: instructions,
          sourceName: "",
          kind: "paste",
          truncated: false,
          addedAt: AT,
        },
      })
    }
    return {
      state,
      result: demoWorkspaceSetup(
        buildWorkspaceSetupRequest(state.tasks[0], state, TODAY)
      ),
    }
  }

  it("prepares requirements, questions, an outline, and a first section", () => {
    const { result } = setup(
      "I haven't started my research paper",
      "- Argue one position\n- Cite three sources"
    )
    const doc = preparedDocument(result)
    expect(doc).toContain("- [ ] Argue one position")
    expect(doc).toContain("## Questions to answer")
    expect(doc).toContain("## Outline")
    expect(doc).toContain("## Introduction")
    expect(doc).toContain("[topic]")
  })

  it("doesn't pretend to have done research, or invent requirements", () => {
    const { result } = setup("I haven't started my research paper")
    const doc = preparedDocument(result)
    expect(result.deliverables).toEqual([])
    expect(doc).toContain("[What has to be handed in?")
    expect(doc).not.toMatch(/\(\w+,? (19|20)\d\d\)|et al\.|studies show/i)
  })

  it("starts with the prepared document, not an unrelated step", () => {
    const { result } = setup("I haven't started my research paper")
    expect(result.firstAction).toBe(
      "Fill in the first [bracket] under “Introduction”"
    )
  })

  it("offers several ways in, each saying where it leads", () => {
    const { result } = setup("Write my essay")
    expect(entryPoints(result).map((item) => item.label)).toEqual([
      "Edit the first section",
      "Answer a question",
      "Fill in the outline",
    ])
    const code = setup("Train a classifier on the dataset").result
    expect(entryPoints(code)[0].label).toBe("Start from the code")
    expect(preparedDocument(code)).toContain("```python")
  })

  it("writes nothing until an entry is chosen, then starts there", async () => {
    const { state } = setup("Write my essay", "- Argue one position")
    seed(state, null)
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await user.click(await button("Set up my workspace"))
    await screen.findByRole("group", { name: "Where do you want to begin?" })
    expect(editor.getText()).toBe("")
    expect(
      screen.getByText(/not research or finished work/)
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull()

    await user.click(await button("Answer a question"))
    expect(editor.getHTML()).toContain("<h2")
    const { $from } = editor.state.selection
    expect(
      editor.state.doc.resolve($from.before(1)).nodeBefore?.textContent
    ).toBe("Questions to answer")
    // Typing replaces the first placeholder, so there's nothing to delete first.
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to)).toBe("[your answer]")
    expect(editor.state.selection.$from.parent.isTextblock).toBe(true)
    // What they type over it is theirs, and isn't marked as suggested.
    editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, "Mine", () => editor.state.tr)
    )
    expect(editor.getHTML()).toMatch(/<\/span>Mine/)
    expect(saved().tasks[0].nextAction).toBe(
      "Answer: What question is this answering?"
    )
    expect(saved().tasks[0].deadline).toBeNull()
    expect(saved().tasks[0].subtasks).toEqual([])
    expect(await screen.findByLabelText("Suggested step 1")).toBeInTheDocument()
  })

  it("keeps edits made to the prepared document", async () => {
    const { state } = setup("Write my essay")
    seed(state, null)
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await user.click(await button("Set up my workspace"))
    const draft = await screen.findByLabelText(/Your prepared document/)
    await user.clear(draft)
    await user.type(draft, "My own plan")
    await user.click(await button("Edit the first section"))
    expect(editor.getText()).toBe("My own plan")
  })
})
