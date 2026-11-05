// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildCalendarItems, droppedSlot } from "@/lib/calendar/events"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"

type CalendarProps = {
  events: {
    id: string
    title: string
    start: string
    allDay: boolean
    extendedProps: Record<string, unknown>
  }[]
  eventClick: (info: unknown) => void
  eventDrop: (info: unknown) => void
  dateClick: (info: unknown) => void
  initialView: string
  headerToolbar: { right: string }
}

/** FullCalendar needs real layout, so tests call the same callbacks it would. */
const calendar = vi.hoisted(() => ({ props: null as unknown }))
vi.mock("@fullcalendar/react", () => ({
  default: (props: CalendarProps) => {
    calendar.props = props
    return (
      <ul aria-label="Mock calendar">
        {props.events.map((event) => (
          <li key={event.id}>{event.title}</li>
        ))}
      </ul>
    )
  },
}))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const props = () => calendar.props as CalendarProps
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = localToday()
const STORAGE = "backontrack.workspace.v1"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)

const run = (actions: WorkspaceAction[]) =>
  actions.reduce(workspaceReducer, EMPTY_WORKSPACE)

const seeded = run([
  {
    type: "create-task",
    id: "a",
    at: AT,
    title: "Essay",
    deadline: addDays(TODAY, 3),
  },
  {
    type: "add-planned",
    at: AT,
    session: {
      id: "p",
      taskId: "a",
      date: addDays(TODAY, 1),
      time: "09:30",
      minutes: 25,
      label: "",
      done: false,
    },
  },
])

function drop(kind: string, refId: string, date: string) {
  const [y, m, d] = date.split("-").map(Number)
  const revert = vi.fn()
  props().eventDrop({
    revert,
    event: {
      start: new Date(y, m - 1, d, 0, 0),
      allDay: true,
      extendedProps: { kind, refId, taskId: "a" },
    },
  })
  return revert
}

describe("calendar items", () => {
  it("keeps deadlines, planned work, and focus visibly separate", () => {
    const items = buildCalendarItems(
      {
        ...seeded,
        focusSessions: [
          {
            id: "f",
            taskId: "a",
            taskTitle: "Essay",
            plannedMinutes: 5,
            actualSeconds: 300,
            startedAt: AT,
            endedAt: AT,
            outcome: "completed",
            note: "",
          },
        ],
      },
      TODAY
    )
    const byKind = (kind: string) =>
      items.find((item) => item.extendedProps.kind === kind)!
    expect(byKind("deadline")).toMatchObject({
      title: "Due: Essay",
      start: addDays(TODAY, 3),
      allDay: true,
      classNames: ["bot-deadline"],
    })
    expect(byKind("planned")).toMatchObject({
      title: "Work: Essay (25 min)",
      start: `${addDays(TODAY, 1)}T09:30`,
      end: `${addDays(TODAY, 1)}T09:55`,
      allDay: false,
      classNames: ["bot-planned"],
    })
    expect(byKind("focused").editable).toBe(false)
  })

  it("marks a passed deadline, and a finished task's deadline can't be dragged", () => {
    const passed = run([
      {
        type: "create-task",
        id: "a",
        at: AT,
        title: "Old",
        deadline: addDays(TODAY, -2),
      },
    ])
    expect(buildCalendarItems(passed, TODAY)[0].classNames).toContain(
      "bot-deadline-passed"
    )
    const done = workspaceReducer(passed, {
      type: "set-status",
      id: "a",
      at: AT,
      status: "completed",
    })
    const [item] = buildCalendarItems(done, TODAY)
    expect(item.classNames).toContain("bot-deadline-done")
    expect(item.editable).toBe(false)
  })

  it("reads a dropped slot as a local date, without a time zone shift", () => {
    expect(droppedSlot(new Date(2026, 2, 1, 0, 0), true)).toEqual({
      date: "2026-03-01",
      time: null,
    })
    expect(droppedSlot(new Date(2026, 2, 1, 23, 30), false)).toEqual({
      date: "2026-03-01",
      time: "23:30",
    })
  })

  it("handles a planned session that runs past midnight", () => {
    const late = run([
      { type: "create-task", id: "a", at: AT, title: "Late", deadline: null },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "p",
          taskId: "a",
          date: "2026-03-01",
          time: "23:50",
          minutes: 25,
          label: "",
          done: false,
        },
      },
    ])
    expect(buildCalendarItems(late, TODAY)[0].end).toBe("2026-03-02T00:15")
  })
})

describe("calendar screen", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    window.scrollTo = vi.fn() as typeof window.scrollTo
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ live: false, model: null }))
    )
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...seeded, legacyMigrated: true })
    )
  })

  it("offers month and week views, and shows items", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(props().initialView).toBe("dayGridMonth")
    expect(props().headerToolbar.right).toContain("timeGridWeek")
    expect(screen.getByText("Due: Essay")).toBeInTheDocument()
    expect(screen.getByText("Work: Essay (25 min)")).toBeInTheDocument()
  })

  it("opens the task when an item is clicked", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    props().eventClick({ event: { extendedProps: { taskId: "a" } } })
    await screen.findByRole("heading", { name: "Essay" })
  })

  it("moves planned work without touching the deadline", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 5)
    const revert = drop("planned", "p", date)
    expect(revert).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(saved().planned[0].date).toBe(date))
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })

  it("never silently moves a deadline when it's dragged", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 9)
    const revert = drop("deadline", "a", date)
    expect(revert).toHaveBeenCalled()
    const dialog = await screen.findByRole("dialog")
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))

    await user.click(
      within(dialog).getByRole("button", { name: "Keep the deadline" })
    )
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })

  it("changes a deadline only after confirming, keeping the original", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 9)
    drop("deadline", "a", date)
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /Change it to/,
      })
    )
    expect(saved().tasks[0].deadline).toBe(date)
    expect(saved().tasks[0].originalDeadline).toBe(addDays(TODAY, 3))
  })

  it("can plan work on the dragged day instead of moving the deadline", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    drop("deadline", "a", addDays(TODAY, 2))
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /instead/,
      })
    )
    expect(saved().planned).toHaveLength(2)
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })

  it("creates a task with a date, and schedules a focus session, for a clicked day", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 4)
    props().dateClick({ dateStr: date })
    await screen.findByLabelText("New task")
    await user.type(screen.getByLabelText("New task"), "Dentist form")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(saved().tasks.at(-1)).toMatchObject({
      title: "Dentist form",
      deadline: date,
    })

    await user.click(
      screen.getByRole("button", { name: "Plan a work session" })
    )
    expect(saved().planned.at(-1).date).toBe(date)
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })

  it("replans a passed deadline without changing it, unless asked", async () => {
    const past = addDays(TODAY, -4)
    const state = run([
      {
        type: "create-task",
        id: "a",
        at: AT,
        title: "Old essay",
        deadline: past,
      },
    ])
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "Replan" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Tomorrow" }))
    await user.click(within(dialog).getByRole("button", { name: "Plan it" }))
    expect(saved().planned[0].date).toBe(addDays(TODAY, 1))
    expect(saved().tasks[0].deadline).toBe(past)
  })

  it("replans with a deadline change only when the box is ticked", async () => {
    const past = addDays(TODAY, -4)
    const state = run([
      {
        type: "create-task",
        id: "a",
        at: AT,
        title: "Old essay",
        deadline: past,
      },
    ])
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "Replan" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /deadline itself has changed/,
      })
    )
    await user.click(within(dialog).getByRole("button", { name: "Plan it" }))
    expect(saved().tasks[0].deadline).toBe(TODAY)
    expect(saved().tasks[0].originalDeadline).toBe(past)
  })

  it("moves planned work from the keyboard-friendly date field on a task", async () => {
    window.location.hash = "#/tasks/a"
    render(<WorkspaceApp />)
    const input = await screen.findByLabelText(/Move this work session/)
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.change(input, { target: { value: addDays(TODAY, 6) } })
    expect(saved().planned[0].date).toBe(addDays(TODAY, 6))
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })
})
