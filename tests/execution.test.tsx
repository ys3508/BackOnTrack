// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { SAMPLE_TASKS } from "@/lib/demo/sample-tasks"
import { buildBreakdownRequest } from "@/lib/recovery/context"
import { demoBreakdown } from "@/lib/recovery/demo-breakdown"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import { buildRecoveryRequest } from "@/lib/recovery/context"
import { workspaceReducer } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"

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
const INSTRUCTIONS =
  "Machine learning project.\n- Train a classifier on the data\n- Report the accuracy\nYou must submit a PDF."

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
  window.location.hash = "#/tasks"
  window.scrollTo = vi.fn() as typeof window.scrollTo
})

describe("definition of done", () => {
  it("goes from a new task to resuming saved work, all in one app", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ live: false, model: null })
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    const { unmount } = render(<WorkspaceApp />)

    // 1. Create a task.
    await user.type(
      await screen.findByLabelText("New task"),
      "Finish my machine learning assignment"
    )
    await user.click(screen.getByRole("button", { name: "Add" }))
    await user.click(await button(/^Finish my machine learning assignment/))

    // 2. Paste task instructions.
    await user.click(await button(/^Instructions/))
    fireEvent.change(
      await screen.findByLabelText(/Paste what you were asked/),
      {
        target: { value: INSTRUCTIONS },
      }
    )
    await user.click(await button("Save instructions"))

    // 3. Ask for a breakdown, based on those instructions.
    await user.click(await button("Break this down"))
    const proposed = await screen.findByDisplayValue(
      "Train a classifier on the data"
    )
    expect(saved().tasks[0].subtasks).toEqual([])

    // 4. Edit the proposal before accepting.
    fireEvent.change(proposed, { target: { value: "Train my classifier" } })
    await user.click(await button("Add these steps"))
    const steps = () =>
      saved().tasks[0].subtasks.map((sub: { title: string }) => sub.title)
    expect(steps()).toContain("Train my classifier")

    // 5. Open the working document.
    const editor = await getEditor()

    // 6. Generate an outline, and accept it.
    await user.click(await button("Generate an outline"))
    const outline = await screen.findByLabelText(/Suggested text/)
    expect((outline as HTMLTextAreaElement).value).toContain(
      "Report the accuracy"
    )
    await user.click(await button("Add to my document"))
    expect(editor.getHTML()).toContain("data-suggested")

    // 7. Edit and save the document.
    act(() => {
      editor.commands.insertContentAt(
        editor.state.doc.content.size,
        "<p>My own sentence</p>"
      )
    })
    await waitFor(
      () =>
        expect(saved().tasks[0].workDoc?.content).toContain("My own sentence"),
      { timeout: 2000 }
    )

    // 8. Start a short focus session, staying beside the document.
    await user.click(await button("5-minute Quick Start"))
    expect(await screen.findByRole("timer")).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: /Working document/ })
    ).toBeInTheDocument()
    expect(saved().timer.subtaskId).toBe(saved().tasks[0].subtasks[0].id)

    // 9. Complete a step, with the timer still running.
    await user.click(await button("Mark this step done"))
    expect(saved().tasks[0].subtasks[0].done).toBe(true)
    expect(saved().tasks[0].status).toBe("in-progress")

    // 10. Report being stuck, and receive a different approach.
    await user.click(await button("Stop"))
    await user.click(await button("I got stuck"))
    await user.type(
      screen.getByLabelText(/What got in the way/),
      "I don't understand what they want"
    )
    await user.click(await button("Find another way in"))
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
    await user.click(await button("Not now"))
    await user.click(await button("All tasks"))
    await user.click(await button(/^Finish my machine learning assignment/))

    // 12. See accurate progress and history.
    await screen.findByRole("heading", {
      name: "Finish my machine learning assignment",
    })
    const history = screen.getByRole("heading", {
      name: "History",
    }).parentElement!
    await user.click(within(history).getByRole("button", { name: /Show all/ }))
    for (const text of [
      /Added instructions/,
      /Suggested a breakdown/,
      /Accepted a breakdown/,
      /Started a focus session/,
      /Completed: /,
      /Stopped focus|Interrupted attempt/,
    ]) {
      expect(within(history).getAllByText(text).length).toBeGreaterThan(0)
    }
    const task = saved().tasks[0]
    expect(task.progress).toBeGreaterThan(0)
    expect(task.progress).toBeLessThan(100)
    expect(task.completedAt).toBeNull()

    // 11. Return later, and resume from the saved position.
    window.location.hash = `#/tasks/${task.id}/doc`
    unmount()
    render(<WorkspaceApp />)
    const restored = await getEditor()
    await waitFor(() => expect(restored.getText()).toContain("My own sentence"))

    // Demo Mode sent nothing anywhere.
    const posts = (
      fetchMock.mock.calls as unknown as [string, RequestInit?][]
    ).filter(([, init]) => init?.method)
    expect(posts).toEqual([])
  })
})

describe("focus inside the task", () => {
  const T0 = Date.UTC(2026, 10, 5, 12, 0, 0)
  const seed = () => {
    let state = workspaceReducer(EMPTY_WORKSPACE, {
      type: "create-task",
      id: "a",
      at: AT,
      title: "Essay",
    })
    state = workspaceReducer(state, {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "1",
      title: "Write the opening",
    })
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    vi.setSystemTime(T0)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ live: false, model: null }))
    )
    window.location.hash = "#/tasks/a"
    seed()
  })

  const finishSession = async () => {
    fireEvent.click(await button("5-minute Quick Start"))
    await screen.findByRole("timer")
    vi.setSystemTime(T0 + 5 * 60_000 + 1000)
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await screen.findByLabelText("Where should you start next time?")
  }

  it("shows the current step beside the document, without leaving the page", async () => {
    render(<WorkspaceApp />)
    fireEvent.click(await button("5-minute Quick Start"))
    expect(await screen.findByRole("timer")).toHaveTextContent("05:00")
    expect(screen.getAllByText("Write the opening").length).toBeGreaterThan(0)
    expect(window.location.hash).toBe("#/tasks/a")
    expect(document.querySelector(".ProseMirror")).toBeTruthy()
    vi.useRealTimers()
  })

  it("answers that it made progress: offers the step, but never completes anything by itself", async () => {
    render(<WorkspaceApp />)
    await finishSession()
    expect(saved().tasks[0].subtasks[0].done).toBe(false)
    fireEvent.click(await button("I started / made progress"))
    expect(saved().focusSessions[0].progressReport).toBe("yes")
    expect(saved().tasks[0].status).toBe("in-progress")
    expect(saved().tasks[0].subtasks[0].done).toBe(false)
    fireEvent.click(await button(/Mark “Write the opening” done/))
    expect(saved().tasks[0].subtasks[0].done).toBe(true)
    vi.useRealTimers()
  })

  it("answers I got stuck: flags the task, and goes to recovery", async () => {
    render(<WorkspaceApp />)
    await finishSession()
    fireEvent.click(await button("I got stuck"))
    expect(saved().tasks[0].status).toBe("needs-recovery")
    expect(saved().focusSessions[0].progressReport).toBe("stuck")
    await waitFor(() => expect(window.location.hash).toBe("#/"))
    expect(saved().recovery).toMatchObject({ taskId: "a", reason: null })
    vi.useRealTimers()
  })
})

describe("demo examples", () => {
  const TODAY = "2026-11-05"
  const load = (index: number) =>
    SAMPLE_TASKS[index]
      .build("a", AT, TODAY)
      .reduce(workspaceReducer, EMPTY_WORKSPACE)

  it("has the four required realistic examples, marked as made up", () => {
    expect(SAMPLE_TASKS.map((sample) => sample.label)).toEqual([
      "Homework assignment",
      "Job application",
      "Missed deadline",
      "A first attempt that failed",
    ])
    SAMPLE_TASKS.forEach((_, index) => {
      expect(load(index).tasks[0].description).toMatch(/Made-up example/)
    })
  })

  it("gives each one a suitable breakdown and recovery", () => {
    const breakdownOf = (index: number) => {
      const state = load(index)
      return demoBreakdown(buildBreakdownRequest(state.tasks[0], state, TODAY))
        .steps
    }
    expect(breakdownOf(0)).toContain(
      "Train a classifier on the provided dataset"
    )
    expect(breakdownOf(1)).toContain("Include a short cover letter")
    expect(breakdownOf(2)[0]).toMatch(/late-work policy/)

    const failed = load(3)
    expect(failed.tasks[0].status).toBe("needs-recovery")
    expect(failed.focusSessions[0].outcome).toBe("stuck")
    const { plan } = demoTaskRecovery(
      buildRecoveryRequest(failed.tasks[0], failed, TODAY)
    )
    expect(plan.choices).toHaveLength(3)
    expect(plan.adaptationNote).toContain("I stared at the blank page")
  })
})
