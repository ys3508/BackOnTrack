// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildCalendarItems, droppedSlot } from "@/lib/calendar/events"
import {
  PALETTE,
  buildRoutineRule,
  focusMinutesByDay,
  heatLevel,
  parseRoutineRule,
  rangeStats,
  timesThisWeek,
  trayItems,
  weekStart,
} from "@/lib/calendar/derived"
import { restoreWorkspace } from "@/lib/workspace/storage"
import type { Workspace } from "@/lib/workspace/schemas"
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
  datesSet: (info: unknown) => void
  drop: (info: unknown) => void
  eventResize: (info: unknown) => void
  eventClassNames: (info: unknown) => string[]
  dayCellClassNames: (info: unknown) => string[]
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
vi.mock("@fullcalendar/interaction", () => ({
  default: {},
  Draggable: class {
    destroy() {}
  },
}))
vi.mock("@fullcalendar/multimonth", () => ({ default: {} }))
vi.mock("@fullcalendar/rrule", () => ({ default: {} }))

const props = () => calendar.props as CalendarProps
const local = (date: string, hour = 0, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d, hour, minute)
}
const showView = (type: string, from = TODAY, until = addDays(TODAY, 1)) =>
  act(() =>
    props().datesSet({
      start: local(from),
      end: local(until),
      view: { type },
    })
  )
const clickSlot = (dateStr: string, allDay = false) =>
  act(() =>
    props().dateClick({
      dateStr,
      allDay,
      jsEvent: { clientX: 10, clientY: 10 },
    })
  )
const clickBlock = (extendedProps: Record<string, unknown>, title = "Block") =>
  act(() =>
    props().eventClick({
      event: { title, start: local(TODAY, 9), extendedProps },
      el: document.body,
      jsEvent: { preventDefault() {} },
    })
  )
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = localToday()
const STORAGE = "backontrack.workspace.v1"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)

const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

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
            subtaskId: null,
            progressReport: null,
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

const withFocus = () =>
  run([
    { type: "create-task", id: "a", at: AT, title: "Essay" },
    {
      type: "timer-start",
      id: "f",
      kind: "focus",
      taskId: "a",
      minutes: 30,
      now: local(TODAY, 9).getTime(),
      at: local(TODAY, 9).toISOString(),
    },
    { type: "timer-finish", now: local(TODAY, 9, 30).getTime() },
    { type: "timer-acknowledge" },
  ])

describe("derived numbers", () => {
  it("all come from sessions, and leave out interrupted attempts", () => {
    const state = run(
      [
        {
          type: "timer-start",
          id: "g",
          kind: "focus",
          taskId: "a",
          minutes: 10,
          now: local(TODAY, 11).getTime(),
          at: local(TODAY, 11).toISOString(),
        },
        {
          type: "timer-stop",
          now: local(TODAY, 11).getTime() + 20_000,
          at: local(TODAY, 11).toISOString(),
          outcome: "continue-later",
          note: "",
        },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "p",
            taskId: "a",
            date: TODAY,
            time: "15:00",
            minutes: 40,
            label: "",
            done: false,
          },
        },
        {
          type: "set-status",
          id: "a",
          at: local(TODAY, 12).toISOString(),
          status: "completed",
        },
      ],
      withFocus()
    )
    const stats = rangeStats(state, TODAY, addDays(TODAY, 1))
    expect(stats.focusMinutes).toBe(30)
    expect(stats.plannedMinutes).toBe(40)
    expect(stats.tasksCompleted).toBe(1)
    expect(stats.actual.map((item) => item.id)).toEqual(["f"])
    expect(
      rangeStats(state, addDays(TODAY, 1), addDays(TODAY, 2)).focusMinutes
    ).toBe(0)
  })

  it("buckets minutes for the heatmap", () => {
    expect([0, 10, 25, 26, 60, 61, 120, 121].map(heatLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4,
    ])
    expect(focusMinutesByDay(withFocus()).get(TODAY)).toBe(30)
  })
})

describe("the Not started yet tray", () => {
  const task = (id: string, deadline: string | null) =>
    ({ type: "create-task", id, at: AT, title: id, deadline }) as const
  const session = (id: string, taskId: string, date: string, done = false) =>
    ({
      type: "add-planned",
      at: AT,
      session: {
        id,
        taskId,
        date,
        time: "09:00",
        minutes: 25,
        label: "",
        done,
      },
    }) as const

  it("picks up past deadlines and missed sessions, counting the days", () => {
    const state = run([
      task("late", addDays(TODAY, -3)),
      task("missed", null),
      session("m", "missed", addDays(TODAY, -5)),
    ])
    expect(
      trayItems(state, TODAY).map((item) => [item.task.id, item.putOffDays])
    ).toEqual([
      ["late", 3],
      ["missed", 5],
    ])
  })

  it("leaves out what's scheduled, paused, finished, undated, or due later", () => {
    const state = run([
      task("scheduled", addDays(TODAY, -3)),
      session("s", "scheduled", TODAY),
      task("paused", addDays(TODAY, -3)),
      { type: "set-status", id: "paused", at: AT, status: "paused" },
      task("finished", addDays(TODAY, -3)),
      { type: "set-status", id: "finished", at: AT, status: "completed" },
      task("undated", null),
      task("later", addDays(TODAY, 3)),
    ])
    expect(trayItems(state, TODAY)).toEqual([])
  })

  it("schedules a dragged task without moving its deadline, and it leaves the tray", async () => {
    const past = addDays(TODAY, -2)
    window.localStorage.clear()
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...run([{ ...task("late", past), title: "Late one" }]),
        legacyMigrated: true,
      })
    )
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    expect(await screen.findByText("put off 2 days")).toBeTruthy()
    const draggedEl = document.querySelector('[data-kind="task"]')
    expect(draggedEl).toHaveAttribute("data-id", "late")
    act(() =>
      props().drop({ draggedEl, date: local(TODAY, 16), allDay: false })
    )
    expect(saved().planned[0]).toMatchObject({
      taskId: "late",
      date: TODAY,
      time: "16:00",
      minutes: 25,
    })
    expect(saved().tasks[0].deadline).toBe(past)
    await waitFor(() => expect(screen.queryByText("put off 2 days")).toBeNull())
  })

  it("draws a missed session as a faint outline, and never uses a red class", () => {
    const state = run([
      task("t", null),
      session("old", "t", addDays(TODAY, -1)),
      session("soon", "t", addDays(TODAY, 1)),
    ])
    const classes = (id: string) =>
      buildCalendarItems(state, TODAY).find((item) => item.id === id)!
        .classNames
    expect(classes("planned:old")).toContain("bot-missed")
    expect(classes("planned:soon")).not.toContain("bot-missed")
  })
})

describe("routines", () => {
  const routine = {
    id: "r",
    name: "Gym",
    emoji: "🏋",
    color: PALETTE[1],
    duration: 60,
    rrule: buildRoutineRule(["FR", "MO", "WE"], "07:00", "2026-11-02"),
    exdates: [],
    doneDates: [],
    createdAt: AT,
  }

  it("builds and reads back a rule in local time", () => {
    expect(routine.rrule).toBe(
      "DTSTART:20261102T070000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"
    )
    expect(parseRoutineRule(routine.rrule)).toEqual({
      days: ["MO", "WE", "FR"],
      time: "07:00",
      startDate: "2026-11-02",
    })
  })

  it("counts this week only, and survives saving and reloading", () => {
    const monday = weekStart(TODAY)
    const state = run([
      { type: "add-routine", routine },
      { type: "toggle-routine-done", routineId: "r", date: addDays(monday, 1) },
      {
        type: "toggle-routine-done",
        routineId: "r",
        date: addDays(monday, -6),
      },
      {
        type: "place-routine",
        placement: {
          id: "x",
          routineId: "r",
          date: addDays(monday, 2),
          time: "07:00",
          done: true,
        },
      },
    ])
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(state)))
    expect(restored.routines).toHaveLength(1)
    expect(restored.routinePlacements).toHaveLength(1)
    expect(timesThisWeek(restored, restored.routines[0], TODAY)).toBe(2)
  })

  it("moves one occurrence and leaves the rest", () => {
    const state = run([
      { type: "add-routine", routine },
      { type: "toggle-routine-done", routineId: "r", date: "2026-11-09" },
      {
        type: "move-routine-occurrence",
        routineId: "r",
        fromDate: "2026-11-09",
        placement: {
          id: "x",
          routineId: "r",
          date: "2026-11-10",
          time: "18:00",
          done: true,
        },
      },
    ])
    expect(state.routines[0].exdates).toEqual(["2026-11-09"])
    expect(state.routines[0].doneDates).toEqual([])
    expect(state.routines[0].rrule).toBe(routine.rrule)
    expect(state.routinePlacements[0]).toMatchObject({
      date: "2026-11-10",
      done: true,
    })
  })

  it("loads older data, which has no routines", () => {
    const raw = JSON.parse(JSON.stringify(EMPTY_WORKSPACE))
    delete raw.routines
    delete raw.routinePlacements
    const restored = restoreWorkspace({ ...raw, version: 2 })
    expect(restored.routines).toEqual([])
    expect(restored.routinePlacements).toEqual([])
  })

  it("creates one from the sidebar, and it reaches the calendar", async () => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "New routine" }))
    await user.type(screen.getByLabelText("Name"), "Gym")
    for (const day of ["Mon", "Wed", "Fri"]) {
      await user.click(screen.getByRole("button", { name: day }))
    }
    await user.click(screen.getByRole("button", { name: "Add routine" }))
    const [saved0] = saved().routines
    expect(saved0.name).toBe("Gym")
    expect(saved0.rrule).toMatch(/BYDAY=MO,WE,FR/)
    expect(saved0.duration).toBe(60)
    await waitFor(() =>
      expect(
        props().events.some((event) => event.id === "routine:" + saved0.id)
      ).toBe(true)
    )
    expect(document.body.textContent).not.toMatch(/streak/i)
  })

  it("fills in when done from the popover, and shows at most a weekly count", async () => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...run([{ type: "add-routine", routine }]),
        legacyMigrated: true,
      })
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "routine", refId: "r", taskId: null }, "Gym")
    await user.click(await screen.findByRole("button", { name: "Done" }))
    expect(saved().routines[0].doneDates).toEqual([TODAY])
    expect(await screen.findByText("this week: 1 time")).toBeTruthy()
    expect(
      props().eventClassNames({
        event: {
          start: local(TODAY, 7),
          end: local(TODAY, 8),
          extendedProps: { kind: "routine", refId: "r" },
        },
      })
    ).toEqual(["bot-routine-done"])
  })

  it("adds one to the chosen day without dragging", async () => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...run([{ type: "add-routine", routine }]),
        legacyMigrated: true,
      })
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: /^Add Gym to/ }))
    expect(saved().routinePlacements[0]).toMatchObject({
      routineId: "r",
      date: TODAY,
      time: "07:00",
    })
  })
})

describe("mini dashboard", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...withFocus(), legacyMigrated: true })
    )
  })

  it("shows the day's numbers and one segment per session", async () => {
    render(<WorkspaceApp />)
    const panel = await screen.findByRole("region", {
      name: "This day at a glance",
    })
    expect(within(panel).getByText("Focus time").nextSibling).toHaveTextContent(
      "30 min"
    )
    const segments = within(screen.getByTestId("day-strip")).getAllByRole("img")
    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveAccessibleName(/^Essay, 30 min, 9:00.*AM to 9:30/)
  })

  it("shows seven bars in the week view, and no dashboard in month", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const from = weekStart(TODAY)
    showView("timeGridWeek", from, addDays(from, 7))
    await screen.findByRole("region", { name: "This week at a glance" })
    expect(screen.getAllByTestId("week-bar")).toHaveLength(7)
    showView("dayGridMonth")
    expect(screen.queryByRole("region", { name: /at a glance/ })).toBeNull()
    expect(screen.queryByText("Not started yet")).toBeNull()
    expect(screen.getByText("My routines")).toBeTruthy()
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

  it("offers day, week, month, and year, starting on day, and shows items", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(props().initialView).toBe("timeGridDay")
    for (const view of [
      "timeGridDay",
      "timeGridWeek",
      "dayGridMonth",
      "multiMonthYear",
    ]) {
      expect(props().headerToolbar.right).toContain(view)
    }
    expect(screen.getByText("Due: Essay")).toBeInTheDocument()
    expect(screen.getByText("Work: Essay (25 min)")).toBeInTheDocument()
  })

  it("opens a popover on a block, with Open going to the task", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Work: Essay")
    const popover = await screen.findByRole("dialog", { name: "Work: Essay" })
    for (const name of ["Start focus", "Done", "Change time", "Open"]) {
      expect(within(popover).getByRole("button", { name })).toBeTruthy()
    }
    await user.click(within(popover).getByRole("button", { name: "Open" }))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/a"))
  })

  it("marks a planned session done from the popover, leaving the task open", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Work: Essay")
    await user.click(await screen.findByRole("button", { name: "Done" }))
    expect(saved().planned[0].done).toBe(true)
    expect(saved().tasks[0].status).toBe("not-started")
  })

  it("changes time and length from the popover", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Work: Essay")
    await user.click(await screen.findByRole("button", { name: "Change time" }))
    const time = screen.getByLabelText("Time")
    await user.clear(time)
    await user.type(time, "14:15")
    const minutes = screen.getByLabelText("Minutes")
    await user.clear(minutes)
    await user.type(minutes, "50")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(saved().planned[0]).toMatchObject({ time: "14:15", minutes: 50 })
  })

  it("starts focus for the session's own length", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Work: Essay")
    await user.click(await screen.findByRole("button", { name: "Start focus" }))
    expect(saved().timer).toMatchObject({ taskId: "a", plannedSeconds: 1500 })
  })

  it("resizes a planned session by its bottom edge", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 1)
    act(() =>
      props().eventResize({
        revert: vi.fn(),
        event: {
          start: local(date, 9, 30),
          end: local(date, 10, 30),
          extendedProps: { kind: "planned", refId: "p" },
        },
      })
    )
    expect(saved().planned[0].minutes).toBe(60)
    expect(saved().planned[0].time).toBe("09:30")
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

  it("creates a task due on a clicked month day, typing inline", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    showView("dayGridMonth")
    const date = addDays(TODAY, 4)
    clickSlot(date, true)
    await user.type(
      await screen.findByRole("textbox", { name: /^New task due/ }),
      "Dentist form{Enter}"
    )
    expect(saved().tasks.at(-1)).toMatchObject({
      title: "Dentist form",
      deadline: date,
    })
    expect(saved().planned).toHaveLength(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("creates a 25-minute session on a clicked slot", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    await user.type(
      await screen.findByRole("combobox", { name: /^25 minutes on/ }),
      "Call the bank{Enter}"
    )
    const task = saved().tasks.at(-1)
    expect(task.title).toBe("Call the bank")
    expect(task.deadline).toBeNull()
    expect(saved().planned.at(-1)).toMatchObject({
      taskId: task.id,
      date: TODAY,
      time: "14:30",
      minutes: 25,
    })
  })

  it("sets time aside for an open task when its title is typed, without a duplicate", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    await user.type(
      await screen.findByRole("combobox", { name: /^25 minutes on/ }),
      "essay{Enter}"
    )
    expect(saved().tasks).toHaveLength(1)
    expect(saved().planned.at(-1).taskId).toBe("a")
  })

  it("cancels inline creation with Escape", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    await user.type(
      await screen.findByRole("combobox", { name: /^25 minutes on/ }),
      "Nope{Escape}"
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(saved().tasks).toHaveLength(1)
  })

  it("no longer has the forms under the calendar", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(screen.queryByText(/Add a task due this day/)).toBeNull()
    expect(screen.queryByText(/^Plan work on/)).toBeNull()
  })

  it("highlights the chosen day, and only that day", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const other = addDays(TODAY, 2)
    showView("dayGridMonth")
    expect(props().dayCellClassNames({ date: local(TODAY) })).toEqual([
      "bot-selected-day",
    ])
    clickSlot(other, true)
    expect(props().dayCellClassNames({ date: local(TODAY) })).toEqual([])
    expect(props().dayCellClassNames({ date: local(other) })).toEqual([
      "bot-selected-day",
    ])
  })

  it("shows only the heatmap in the year view", async () => {
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...withFocus(), legacyMigrated: true })
    )
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    showView(
      "multiMonthYear",
      `${TODAY.slice(0, 4)}-01-01`,
      `${Number(TODAY.slice(0, 4)) + 1}-01-01`
    )
    expect(props().events).toEqual([])
    expect(props().dayCellClassNames({ date: local(TODAY) })).toEqual([
      "bot-heat-2",
    ])
    expect(screen.queryByText("Not started yet")).toBeNull()
    expect(screen.queryByText("My routines")).toBeNull()
    expect(screen.queryByRole("region", { name: /at a glance/ })).toBeNull()
    // Clicking a day never creates anything from the year.
    expect(screen.queryByRole("dialog")).toBeNull()
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
    await user.click(
      await screen.findByRole("button", { name: "Schedule Old essay" })
    )
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
    await user.click(
      await screen.findByRole("button", { name: "Schedule Old essay" })
    )
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
