// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { EMPTY_INTAKE } from "@/lib/intake"
import { initialSession, saveSession } from "@/lib/session"

const STORAGE = "backontrack.workspace.v1"
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/tasks"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

async function addTask(
  user: ReturnType<typeof userEvent.setup>,
  title: string
) {
  await user.type(screen.getByRole("textbox", { name: "New task" }), title)
  await user.click(screen.getByRole("button", { name: "Add" }))
}

describe("workspace home", () => {
  it("works from empty with one quick-added task, needing no AI", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Tasks" })
    await addTask(user, "Finish homework")
    await button(/^Finish homework/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe("tasks", () => {
  it("edits, pauses, resumes, completes, and deletes a task", async () => {
    const user = userEvent.setup()
    window.location.hash = "#/tasks"
    render(<WorkspaceApp />)
    await addTask(user, "Pay rent")
    await user.click(await button(/^Pay rent/))

    const heading = await screen.findByRole("heading", { name: "Pay rent" })
    expect(heading).toBeInTheDocument()

    // A task that was never started has nothing to pause.
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
    await user.selectOptions(screen.getByLabelText("Status"), "in-progress")
    await user.click(await button("Pause"))
    expect(saved().tasks[0].status).toBe("paused")
    await user.click(await button("Resume"))
    expect(saved().tasks[0].status).toBe("in-progress")

    await user.type(
      screen.getByLabelText("Next action"),
      "Open the bank app{Enter}"
    )
    await waitFor(() =>
      expect(saved().tasks[0].nextAction).toBe("Open the bank app")
    )
    await user.click(await button("Done with this action"))
    await waitFor(() => expect(saved().tasks[0].nextAction).toBe(""))

    await user.selectOptions(screen.getByLabelText("Priority"), "high")
    expect(saved().tasks[0].priority).toBe("high")

    await user.click(await button("Mark complete"))
    expect(saved().tasks[0].status).toBe("completed")
    expect(screen.getByText(/Status changed to Completed/)).toBeInTheDocument()

    await user.click(await button("Delete task"))
    await user.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: "Delete",
      })
    )
    await screen.findByRole("heading", { name: "Tasks" })
    expect(saved().tasks).toEqual([])
  })

  it("asks before releasing something that looks high stakes", async () => {
    const user = userEvent.setup()
    window.location.hash = "#/tasks"
    render(<WorkspaceApp />)
    await addTask(user, "File my tax return")
    await user.click(await button(/^File my tax return/))
    await user.selectOptions(await screen.findByLabelText("Status"), "released")
    const dialog = await screen.findByRole("dialog")
    expect(saved().tasks[0].status).toBe("not-started")
    await user.click(within(dialog).getByRole("button", { name: "Release it" }))
    await waitFor(() => expect(saved().tasks[0].status).toBe("released"))
  })

  it("shows every status as a Kanban column, with a keyboard-friendly status control", async () => {
    const user = userEvent.setup()
    window.location.hash = "#/tasks"
    render(<WorkspaceApp />)
    await addTask(user, "Clean desk")
    await user.click(await button("Board"))
    for (const name of [
      "Not Started",
      "In Progress",
      "Paused",
      "Needs Recovery",
      "Completed",
      "Released",
    ]) {
      expect(
        screen.getByRole("heading", { name: new RegExp(`^${name}`) })
      ).toBeInTheDocument()
    }
    await user.selectOptions(
      screen.getByLabelText("Status of Clean desk"),
      "paused"
    )
    expect(saved().tasks[0].status).toBe("paused")
    expect(
      screen.getByRole("region", { name: "Paused, 1 tasks" })
    ).toBeInTheDocument()
  })
})

describe("persistence and data", () => {
  it("returns to saved tasks after a reload", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Tasks" })
    await addTask(user, "Come back to this")
    unmount()
    render(<WorkspaceApp />)
    await screen.findAllByText(/Come back to this/)
  })

  it("moves an earlier session into the workspace once", async () => {
    saveSession({
      ...initialSession,
      intake: { ...EMPTY_INTAKE, responsibility: "My old homework" },
    })
    const { unmount } = render(<WorkspaceApp />)
    await screen.findAllByText(/My old homework/)
    unmount()
    render(<WorkspaceApp />)
    await screen.findAllByText(/My old homework/)
    expect(saved().tasks).toHaveLength(1)
  })

  it("exports and deletes data", async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    render(<WorkspaceApp />)
    await addTask(user, "Private thing")
    await user.click(await button("Settings"))
    await user.click(await button("Export my data"))
    expect(click).toHaveBeenCalled()

    await user.click(await button("Delete all my data"))
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete everything",
      })
    )
    await screen.findByRole("heading", { name: "Today" })
    await act(async () => {})
    expect(JSON.stringify(saved())).not.toContain("Private thing")
  })
})
