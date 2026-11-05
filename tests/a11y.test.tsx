// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = localToday()

const actions: WorkspaceAction[] = [
  {
    type: "create-task",
    id: "a",
    at: AT,
    title: "Biology homework",
    deadline: addDays(TODAY, -2),
  },
  {
    type: "create-task",
    id: "b",
    at: AT,
    title: "Apply for jobs",
    deadline: addDays(TODAY, 3),
    priority: "high",
  },
  {
    type: "add-subtask",
    id: "a",
    at: AT,
    subId: "1",
    title: "Read the prompt",
  },
  {
    type: "save-document",
    id: "a",
    at: AT,
    docId: "d",
    title: "Notes",
    body: "Some notes",
  },
  {
    type: "add-planned",
    at: AT,
    session: {
      id: "p",
      taskId: "a",
      date: TODAY,
      time: null,
      minutes: 25,
      label: "",
      done: false,
    },
  },
  { type: "set-status", id: "a", at: AT, status: "needs-recovery" },
]

/**
 * Checks structure: names, labels, roles, ARIA, and landmarks. jsdom has no
 * layout, so color contrast is measured separately, in a real browser.
 */
async function violations() {
  const result = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false } },
  })
  return result.violations.map(
    (item) => `${item.id}: ${item.nodes[0]?.html.slice(0, 120)}`
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({
      ...actions.reduce(workspaceReducer, EMPTY_WORKSPACE),
      legacyMigrated: true,
    })
  )
})

describe("automated accessibility scan", () => {
  it.each([
    ["workspace home", "#/", /Your one next thing/],
    ["tasks list", "#/tasks", /Tasks/],
    ["task detail", "#/tasks/a", /Biology homework/],
    ["calendar", "#/calendar", /Calendar/],
    ["focus", "#/focus", /Focus/],
    ["recovery chooser", "#/recover", /Which task/],
    ["recovery start", "#/recover/a", /find a way back/],
    ["settings", "#/settings", /Settings/],
    ["guided check-in", "#/guided", /weighing on you/],
  ])("finds no violations on %s", async (_name, hash, heading) => {
    window.location.hash = hash
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { level: 1, name: heading })
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(await violations()).toEqual([])
  })

  it("finds no violations on the Kanban board", async () => {
    window.location.hash = "#/tasks"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "Board" }))
    expect(await violations()).toEqual([])
  })

  it("finds no violations with a running timer", async () => {
    window.location.hash = "#/focus"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(
      await screen.findByRole("button", { name: "5-minute Quick Start" })
    )
    await screen.findByRole("timer")
    expect(await violations()).toEqual([])
  })

  it("finds no violations on a plan preview with its reasoning open", async () => {
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(
      await screen.findByRole("button", { name: "Get a recovery plan" })
    )
    await user.click(await screen.findByRole("button", { name: /See why/ }))
    expect(await violations()).toEqual([])
  })

  it("moves focus to the heading on each new view", async () => {
    window.location.hash = "#/tasks"
    render(<WorkspaceApp />)
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Tasks",
    })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})
