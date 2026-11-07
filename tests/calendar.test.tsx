// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildCalendarItems, droppedSlot } from "@/lib/calendar/events"
import {
  focusMinutesByDay,
  heatLevel,
  formatTimeRange,
  hourRange,
  placePopover,
  rangeStats,
  routineWeek,
  trayItems,
  weekStart,
} from "@/lib/calendar/derived"
import { occurrencesBetween, plannedSessions } from "@/lib/calendar/model"
import { restoreWorkspace } from "@/lib/workspace/storage"
import { eventOf } from "./event-fixtures"
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
    end?: string
    classNames?: string[]
    allDay: boolean
    extendedProps: Record<string, unknown>
  }[]
  eventClick: (info: unknown) => void
  eventDrop: (info: unknown) => void
  dateClick: (info: unknown) => void
  datesSet: (info: unknown) => void
  drop: (info: unknown) => void
  eventResize: (info: unknown) => void
  eventContent?: (info: unknown) => React.ReactNode
  select: (info: unknown) => void
  selectable: boolean
  snapDuration: string
  slotMinTime: string
  slotMaxTime: string
  nowIndicator: boolean
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
          <li key={event.id} data-testid={`event-${event.id}`}>
            {props.eventContent?.({
              view: { type: "timeGridDay" },
              event: {
                ...event,
                start: new Date(event.start),
                end: event.end ? new Date(event.end) : null,
              },
            }) ?? event.title}
          </li>
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
      jsEvent: { preventDefault() {}, target: document.body },
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
            plannedId: null,
            reported: false,
            endOutcome: null,
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
      title: "Essay",
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

  it("formats a range the way blocks do", () => {
    const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m)
    expect(formatTimeRange(at(15, 15), at(15, 40))).toBe("3:15 – 3:40 PM")
    expect(formatTimeRange(at(11, 45), at(12, 45))).toBe("11:45 AM – 12:45 PM")
  })

  it("shares one hour range, stretched so nothing is hidden", () => {
    const noon = new Date(2026, 0, 1, 12)
    const far = "2026-01-01"
    expect(hourRange(EMPTY_WORKSPACE, far, "2026-01-02", noon)).toEqual({
      first: 6,
      last: 23,
    })
    const early = run([
      { type: "create-task", id: "t", at: AT, title: "T" },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "e",
          taskId: "t",
          date: far,
          time: "04:30",
          minutes: 25,
          label: "",
          done: false,
        },
      },
    ])
    expect(hourRange(early, far, "2026-01-02", noon).first).toBe(4)
    // Only what's on screen counts.
    expect(hourRange(early, "2026-02-01", "2026-02-02", noon).first).toBe(6)
  })

  it("puts a popover beside its block, never over a Day view title", () => {
    const size = { width: 288, height: 300 }
    const viewport = { width: 1000, height: 700 }
    // A narrow Week column: beside it.
    expect(
      placePopover(
        { left: 300, right: 400, top: 100, bottom: 130 },
        size,
        viewport
      )
    ).toEqual({ left: 408, top: 100 })
    // Near the right edge: on the left instead.
    expect(
      placePopover(
        { left: 800, right: 900, top: 100, bottom: 130 },
        size,
        viewport
      )
    ).toEqual({ left: 504, top: 100 })
    // A full-width Day block: its right end, leaving the title at the left clear.
    const wide = placePopover(
      { left: 100, right: 950, top: 100, bottom: 130 },
      size,
      viewport
    )
    expect(wide.left).toBe(654)
    // Near the bottom: pulled up to stay on screen.
    expect(
      placePopover(
        { left: 300, right: 400, top: 680, bottom: 700 },
        size,
        viewport
      ).top
    ).toBe(392)
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
    expect(plannedSessions(saved())[0]).toMatchObject({
      taskId: "late",
      date: TODAY,
      time: "16:00",
      minutes: 30,
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
  // Monday, Wednesday, and Friday from a known Monday.
  const routine = eventOf({
    id: "r",
    title: "Gym",
    emoji: "🏋",
    minutes: 60,
    date: "2026-11-02",
    repeat: { days: [1, 3, 5] },
  })
  // Every day, so that it falls on whatever day the tests run.
  const daily = eventOf({ id: "r", title: "Gym", emoji: "🏋", minutes: 60 })
  const seedRoutine = () => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...run([{ type: "add-event", event: daily }]),
        legacyMigrated: true,
      })
    )
  }

  it("falls only on its days, in local time", () => {
    const found = occurrencesBetween(routine, "2026-11-01", "2026-11-09")
    expect(found.map((item) => [item.date, item.start, item.end])).toEqual([
      ["2026-11-02", "07:00", "08:00"],
      ["2026-11-04", "07:00", "08:00"],
      ["2026-11-06", "07:00", "08:00"],
    ])
  })

  it("counts this week only, and survives saving and reloading", () => {
    const sunday = weekStart(TODAY)
    const state = run([
      { type: "add-event", event: daily },
      {
        type: "occurrence-outcome",
        id: "r",
        key: addDays(sunday, 1),
        outcome: "full",
      },
      {
        type: "occurrence-outcome",
        id: "r",
        key: addDays(sunday, -6),
        outcome: "full",
      },
      {
        type: "add-event",
        event: eventOf({
          id: "x",
          title: "Gym",
          seriesId: "r",
          date: addDays(sunday, 2),
          repeat: null,
          outcomes: { [addDays(sunday, 2)]: "full" },
        }),
      },
    ])
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(state)))
    expect(restored.events).toHaveLength(2)
    expect(routineWeek(restored, restored.events[0], TODAY).full).toBe(2)
  })

  it("applies This and following from one date, and leaves earlier weeks alone", () => {
    const state = run([
      { type: "add-event", event: routine },
      {
        type: "occurrence-outcome",
        id: "r",
        key: "2026-11-04",
        outcome: "full",
      },
      {
        type: "edit-event",
        id: "r",
        key: "2026-11-09",
        scope: "following",
        patch: { start: "18:00", end: "18:45" },
        newId: "r2",
      },
    ])
    const [earlier, later] = state.events
    expect(later).toMatchObject({
      id: "r2",
      seriesId: "r",
      date: "2026-11-09",
      start: "18:00",
      end: "18:45",
      repeat: { days: [1, 3, 5] },
    })
    expect(earlier).toMatchObject({
      id: "r",
      seriesId: "r",
      start: "07:00",
      end: "08:00",
      repeat: { days: [1, 3, 5], until: "2026-11-08" },
      outcomes: { "2026-11-04": "full" },
    })
    const raw = JSON.parse(JSON.stringify(state))
    expect(restoreWorkspace(raw).events).toHaveLength(2)
  })

  it("saves This one only as an adjusted occurrence, from the popover", async () => {
    seedRoutine()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "routine", refId: "r", taskId: null, key: TODAY }, "Gym")
    await user.click(await screen.findByRole("button", { name: "Edit" }))
    await user.click(await screen.findByRole("button", { name: "45" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await user.click(
      await screen.findByRole("button", { name: "This one only" })
    )
    expect(saved().events[0].end).toBe("08:00")
    expect(saved().events[0].overrides[TODAY]).toEqual({ end: "07:45" })
    expect(
      await screen.findByTestId(`event-routine:r:${TODAY}`)
    ).toHaveTextContent("adjusted")
  })

  it("saves All from the popover, without an adjusted marker", async () => {
    seedRoutine()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "routine", refId: "r", taskId: null, key: TODAY }, "Gym")
    await user.click(await screen.findByRole("button", { name: "Edit" }))
    await user.click(await screen.findByRole("button", { name: "90" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await user.click(await screen.findByRole("button", { name: "All" }))
    expect(saved().events).toHaveLength(1)
    expect(saved().events[0]).toMatchObject({ end: "08:30", overrides: {} })
    expect(
      await screen.findByTestId(`event-routine:r:${TODAY}`)
    ).not.toHaveTextContent("adjusted")
  })

  it("moves one occurrence and leaves the rest", () => {
    const state = run([
      { type: "add-event", event: routine },
      {
        type: "occurrence-outcome",
        id: "r",
        key: "2026-11-09",
        outcome: "full",
      },
      {
        type: "edit-event",
        id: "r",
        key: "2026-11-09",
        scope: "one",
        patch: { date: "2026-11-10", start: "18:00", end: "19:00" },
        newId: "unused",
      },
    ])
    const [event] = state.events
    expect(event.repeat).toEqual(routine.repeat)
    expect(event.start).toBe("07:00")
    const found = occurrencesBetween(event, "2026-11-09", "2026-11-12")
    expect(
      found.map((item) => [item.date, item.start, item.outcome, item.adjusted])
    ).toEqual([
      ["2026-11-10", "18:00", "full", true],
      ["2026-11-11", "07:00", null, false],
    ])
  })

  it("loads older data, which has no routines", () => {
    const raw = JSON.parse(JSON.stringify(EMPTY_WORKSPACE))
    delete raw.events
    const restored = restoreWorkspace({ ...raw, version: 2 })
    expect(restored.events).toEqual([])
  })

  it("creates one from the sidebar, and it reaches the calendar", async () => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "New routine" }))
    await user.type(screen.getByLabelText("Title"), "Gym")
    await user.selectOptions(screen.getByLabelText("Repeat"), "custom")
    // Today's weekday starts selected, so this sets exactly the three.
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      const chip = screen.getByRole("button", { name: day })
      const wanted = ["Mon", "Wed", "Fri"].includes(day)
      if ((chip.getAttribute("aria-pressed") === "true") !== wanted) {
        await user.click(chip)
      }
    }
    await user.click(screen.getByRole("button", { name: "60" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    const [saved0] = saved().events
    expect(saved0.title).toBe("Gym")
    expect([...saved0.repeat.days].sort()).toEqual([1, 3, 5])
    expect(saved0).toMatchObject({ start: "07:00", end: "08:00" })
    const nextWeek = addDays(weekStart(TODAY), 7)
    showView("timeGridWeek", nextWeek, addDays(nextWeek, 7))
    await waitFor(() =>
      expect(
        props().events.filter((event) =>
          event.id.startsWith(`routine:${saved0.id}:`)
        )
      ).toHaveLength(3)
    )
    expect(document.body.textContent).not.toMatch(/streak/i)
  })

  it("fills in when done from the popover, and shows at most a weekly count", async () => {
    seedRoutine()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "routine", refId: "r", taskId: null, key: TODAY }, "Gym")
    await user.click(await screen.findByRole("button", { name: "● Full" }))
    expect(saved().events[0].outcomes).toEqual({ [TODAY]: "full" })
    expect(await screen.findByText("this week: ● 1 time")).toBeTruthy()
    expect(
      props().events.find((event) => event.id === `routine:r:${TODAY}`)!
        .classNames
    ).toEqual(["bot-done"])
  })

  it("has no Add link on a card, and dragging one in adds an extra that still counts", async () => {
    seedRoutine()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(screen.queryByRole("button", { name: /^Add Gym to/ })).toBeNull()
    const tomorrow = addDays(TODAY, 1)
    act(() =>
      props().drop({
        draggedEl: document.querySelector('[data-kind="routine"]'),
        date: local(tomorrow, 16),
        allDay: false,
      })
    )
    expect(saved().events[1]).toMatchObject({
      title: "Gym",
      seriesId: "r",
      date: tomorrow,
      start: "16:00",
      end: "17:00",
      repeat: null,
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
    expect(segments[0]).toHaveAccessibleName(
      "Focus: Essay, 30 min, 9:00 – 9:30 AM"
    )
    expect(segments[0]).toHaveAttribute("data-kind", "actual")
  })

  it("draws planned time as dashed and focus as solid, on the calendar's hours", async () => {
    const state = run(
      [
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "p",
            taskId: "a",
            date: TODAY,
            time: "15:00",
            minutes: 45,
            label: "",
            done: false,
          },
        },
      ],
      withFocus()
    )
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
    render(<WorkspaceApp />)
    const strip = await screen.findByTestId("day-strip")
    const kinds = within(strip)
      .getAllByRole("img")
      .map((item) => item.getAttribute("data-kind"))
    expect(kinds.sort()).toEqual(["actual", "planned"])
    const planned = within(strip)
      .getAllByRole("img")
      .find((item) => item.getAttribute("data-kind") === "planned")!
    expect(planned.className).toContain("border-dashed")
    const hours = hourRange(saved(), TODAY, addDays(TODAY, 1))
    expect(props().slotMinTime).toBe(
      `${String(hours.first).padStart(2, "0")}:00:00`
    )
    expect(props().slotMaxTime).toBe(
      `${String(hours.last).padStart(2, "0")}:00:00`
    )
  })

  it("names statuses in the legend, not kinds of thing", async () => {
    render(<WorkspaceApp />)
    const key = await screen.findByRole("list", { name: "Calendar key" })
    expect(within(key).getByText("Minimum")).toBeTruthy()
    expect(within(key).queryByText("Routine")).toBeNull()
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
    const block = screen.getByTestId("event-planned:p")
    expect(block).toHaveTextContent("Essay")
    expect(block.textContent).not.toMatch(/Work:|\(25 min\)/)
  })

  it("opens a popover on a block, with Open going to the task", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Essay")
    const popover = await screen.findByRole("dialog", { name: "Essay" })
    for (const name of ["Start focus", "Done", "Edit", "Open"]) {
      expect(within(popover).getByRole("button", { name })).toBeTruthy()
    }
    await user.click(within(popover).getByRole("button", { name: "Open" }))
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/a"))
  })

  it("marks a planned session done from the popover, leaving the task open", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Essay")
    await user.click(await screen.findByRole("button", { name: "Done" }))
    expect(plannedSessions(saved())[0].done).toBe(true)
    expect(saved().tasks[0].status).toBe("not-started")
  })

  it("changes time and length from the popover", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Essay")
    await user.click(await screen.findByRole("button", { name: "Edit" }))
    const time = screen.getByLabelText("Start")
    await user.clear(time)
    await user.type(time, "14:15")
    await user.click(screen.getByRole("button", { name: "Custom" }))
    const minutes = screen.getByLabelText("Minutes")
    await user.clear(minutes)
    await user.type(minutes, "50")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(plannedSessions(saved())[0]).toMatchObject({ time: "14:15", minutes: 50 })
  })

  it("starts focus for the session's own length", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickBlock({ kind: "planned", refId: "p", taskId: "a" }, "Essay")
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
    expect(plannedSessions(saved())[0].minutes).toBe(60)
    expect(plannedSessions(saved())[0].time).toBe("09:30")
  })

  it("moves planned work without touching the deadline", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 5)
    const revert = drop("planned", "p", date)
    expect(revert).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(plannedSessions(saved())[0].date).toBe(date))
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
    expect(plannedSessions(saved())).toHaveLength(2)
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })

  it("opens the same editor from a clicked month day, at a free hour", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    showView("dayGridMonth")
    const date = addDays(TODAY, 4)
    clickSlot(date, true)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Dentist form{Enter}"
    )
    const task = saved().tasks.at(-1)
    expect(task).toMatchObject({ title: "Dentist form", deadline: null })
    expect(plannedSessions(saved()).at(-1)).toMatchObject({
      taskId: task.id,
      date,
      time: "09:00",
      minutes: 30,
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("creates a 30-minute session on a clicked slot", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Call the bank{Enter}"
    )
    const task = saved().tasks.at(-1)
    expect(task.title).toBe("Call the bank")
    expect(task.deadline).toBeNull()
    expect(plannedSessions(saved()).at(-1)).toMatchObject({
      taskId: task.id,
      date: TODAY,
      time: "14:30",
      minutes: 30,
    })
  })

  it("sets time aside for an open task when its title is typed, without a duplicate", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "essay{Enter}"
    )
    expect(saved().tasks).toHaveLength(1)
    expect(plannedSessions(saved()).at(-1)!.taskId).toBe("a")
  })

  it("cancels inline creation with Escape", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Nope{Escape}"
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(saved().tasks).toHaveLength(1)
  })

  it("has no panels below the calendar", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(screen.queryByText(/Add a task due this day/)).toBeNull()
    expect(screen.queryByText(/^Plan work on/)).toBeNull()
    expect(screen.queryByText("Plan the rest of a task")).toBeNull()
    expect(screen.queryByText("Planned work")).toBeNull()
    expect(screen.queryByLabelText("Choose a day")).toBeNull()
  })

  it("drags out a block of any length, and remembers it", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(props().selectable).toBe(true)
    expect(props().snapDuration).toBe("00:15:00")
    expect(props().nowIndicator).toBe(true)
    act(() =>
      props().select({ start: local(TODAY, 14), end: local(TODAY, 15, 15) })
    )
    expect(await screen.findByTestId("event-end")).toHaveTextContent(
      "Ends 3:15 PM"
    )
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Long one{Enter}"
    )
    expect(plannedSessions(saved()).at(-1)).toMatchObject({ time: "14:00", minutes: 75 })
    expect(saved().settings.lastSessionMinutes).toBe(75)
  })

  it("uses the last length on a single click", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...seeded,
        legacyMigrated: true,
        settings: { ...seeded.settings, lastSessionMinutes: 60 },
      })
    )
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:30:00`)
    expect(await screen.findByTestId("event-end")).toHaveTextContent(
      "Ends 3:30 PM"
    )
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Quick{Enter}"
    )
    expect(plannedSessions(saved()).at(-1)!.minutes).toBe(60)
  })

  it("shows the end time as a duration chip is chosen, and previews the block", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:00:00`)
    await user.click(await screen.findByRole("button", { name: "90" }))
    expect(screen.getByTestId("event-end")).toHaveTextContent("Ends 3:30 PM")
    expect(screen.getByTestId("event-pending")).toBeTruthy()
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Chosen{Enter}"
    )
    expect(saved().settings.lastSessionMinutes).toBe(90)
    expect(screen.queryByTestId("event-pending")).toBeNull()
  })

  it("uses the last length, then the task's estimate, from the Add button", async () => {
    const user = userEvent.setup()
    const state = run(
      [
        {
          type: "create-task",
          id: "e",
          at: AT,
          title: "Estimated",
          estimateMinutes: 60,
        },
      ],
      seeded
    )
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: /^Add to/ }))
    const box = await screen.findByRole("combobox", {
      name: "Title",
    })
    await user.type(box, "estim")
    await user.click(screen.getByRole("option", { name: "Estimated" }))
    expect(screen.getByRole("button", { name: "60" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("needs only a title and Enter to plan a block", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:00:00`)
    const box = await screen.findByRole("combobox", {
      name: "Title",
    })
    // Link and notes are there when wanted, not in the way.
    expect(screen.queryByLabelText("Notes")).toBeNull()
    await user.type(box, "Report{Enter}")
    expect(saved().tasks.at(-1).title).toBe("Report")
    expect(plannedSessions(saved()).at(-1)).toMatchObject({
      date: TODAY,
      time: "14:00",
    })
    expect(screen.queryByRole("dialog", { name: "New event" })).toBeNull()
  })

  it("keeps a link and notes under More", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:00:00`)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Report"
    )
    await user.click(screen.getByRole("button", { name: "More" }))
    await user.type(screen.getByLabelText("Link"), "example.com")
    await user.type(screen.getByLabelText("Notes"), "Open the template")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(saved().events.at(-1)).toMatchObject({
      title: "Report",
      link: "example.com",
      notes: "Open the template",
    })
  })

  it("puts the cursor in the field as soon as the popover appears", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:00:00`)
    const box = await screen.findByRole("combobox", {
      name: "Title",
    })
    await waitFor(() => expect(box).toHaveFocus())
  })

  it("searches tasks in the combobox, or offers to create one", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${TODAY}T14:00:00`)
    const box = await screen.findByRole("combobox", {
      name: "Title",
    })
    await user.type(box, "ess")
    expect(screen.getByRole("option", { name: "Essay" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Create “ess”" })).toBeTruthy()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(box).toHaveValue("Essay")
    expect(screen.queryByRole("listbox")).toBeNull()
    await user.keyboard("{Enter}")
    expect(saved().tasks).toHaveLength(1)
    expect(plannedSessions(saved()).at(-1)).toMatchObject({ taskId: "a", time: "14:00" })
  })

  it("uses one time format, matching the blocks", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(screen.getByTestId("event-planned:p")).toHaveTextContent(
      "9:30 – 9:55 AM"
    )
  })

  describe("when a planned block's time has gone by", () => {
    const past = addDays(TODAY, -1)
    const ended = run([
      { type: "create-task", id: "t", at: AT, title: "Bank call" },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "e",
          taskId: "t",
          date: past,
          time: "09:00",
          minutes: 30,
          label: "",
          done: false,
        },
      },
    ])
    const seedEnded = () =>
      window.localStorage.setItem(
        STORAGE,
        JSON.stringify({ ...ended, legacyMigrated: true })
      )

    it("asks how long Did it took, starting from the planned length", async () => {
      seedEnded()
      const user = userEvent.setup()
      render(<WorkspaceApp />)
      await user.click(
        await screen.findByRole("button", { name: "Did it: Bank call" })
      )
      // Nothing is saved until they answer.
      expect(saved().focusSessions).toEqual([])
      const dialog = await screen.findByRole("dialog", {
        name: "Did it: Bank call",
      })
      expect(
        within(dialog).getByRole("button", { name: /^Save 30/ })
      ).toBeTruthy()
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
      expect(saved().focusSessions).toEqual([])
      expect(screen.queryByRole("dialog")).toBeNull()

      await user.click(
        await screen.findByRole("button", { name: "Did it: Bank call" })
      )
      const again = await screen.findByRole("dialog", {
        name: "Did it: Bank call",
      })
      await user.click(within(again).getByRole("button", { name: "45" }))
      await user.click(within(again).getByRole("button", { name: /^Save/ }))
      expect(saved().focusSessions[0]).toMatchObject({
        reported: true,
        actualSeconds: 2700,
      })
    })

    it("turns Did it into focus time, and stops asking", async () => {
      seedEnded()
      const user = userEvent.setup()
      render(<WorkspaceApp />)
      await user.click(
        await screen.findByRole("button", { name: "Did it: Bank call" })
      )
      await user.click(await screen.findByRole("button", { name: /^Save/ }))
      const [record] = saved().focusSessions
      expect(record).toMatchObject({
        taskId: "t",
        plannedId: "e",
        reported: true,
        actualSeconds: 1800,
        outcome: "completed",
      })
      expect(plannedSessions(saved())[0]).toMatchObject({ outcome: "did", done: true })
      expect(screen.queryByTestId("event-planned:e")).toBeNull()
      expect(screen.getByTestId(`event-focused:${record.id}`)).toBeTruthy()
      expect(trayItems(saved(), TODAY)).toEqual([])
      expect(saved().tasks[0].status).toBe("in-progress")
    })

    it("can take back a Did it", async () => {
      seedEnded()
      const user = userEvent.setup()
      render(<WorkspaceApp />)
      await user.click(
        await screen.findByRole("button", { name: "Did it: Bank call" })
      )
      await user.click(await screen.findByRole("button", { name: /^Save/ }))
      const { id } = saved().focusSessions[0]
      clickBlock({ kind: "focused", refId: id, taskId: "t" }, "Bank call")
      await user.click(
        await screen.findByRole("button", { name: "I didn’t actually do this" })
      )
      expect(saved().focusSessions).toEqual([])
      expect(plannedSessions(saved())[0]).toMatchObject({ outcome: null, done: false })
    })

    it("sends the task to Not started yet on Didn't, with no focus time", async () => {
      seedEnded()
      const user = userEvent.setup()
      render(<WorkspaceApp />)
      await user.click(
        await screen.findByRole("button", { name: "Didn’t: Bank call" })
      )
      expect(saved().focusSessions).toEqual([])
      expect(plannedSessions(saved())[0].outcome).toBe("didnt")
      expect(await screen.findByText("put off 1 day")).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: "Did it: Bank call" })
      ).toBeNull()
    })

    it("sends a task planned earlier today to the tray straight away", () => {
      const state = run([
        { type: "create-task", id: "t", at: AT, title: "Today" },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "e",
            taskId: "t",
            date: TODAY,
            time: "00:00",
            minutes: 15,
            label: "",
            done: false,
          },
        },
      ])
      expect(trayItems(state, TODAY)).toEqual([])
      const answered = run(
        [
          {
            type: "planned-outcome",
            at: AT,
            id: "e",
            outcome: "didnt",
            sessionId: "x",
          },
        ],
        state
      )
      expect(trayItems(answered, TODAY)[0].putOffDays).toBe(0)
    })

    it("doesn't ask about a session that a timer carried out", () => {
      const state = run(
        [
          {
            type: "timer-start",
            id: "f",
            kind: "focus",
            taskId: "t",
            plannedId: "e",
            minutes: 30,
            now: 1000,
            at: AT,
          },
          { type: "timer-finish", now: 1000 + 1_800_000 },
        ],
        ended
      )
      expect(plannedSessions(state)[0]).toMatchObject({ outcome: "did", done: true })
      expect(state.focusSessions[0].reported).toBe(false)
      expect(
        buildCalendarItems(state, TODAY).some((i) => i.id === "planned:e")
      ).toBe(false)
    })

    it("still asks after an interrupted timer", () => {
      const state = run(
        [
          {
            type: "timer-start",
            id: "f",
            kind: "focus",
            taskId: "t",
            plannedId: "e",
            minutes: 30,
            now: 1000,
            at: AT,
          },
          {
            type: "timer-stop",
            now: 1000 + 10_000,
            at: AT,
            outcome: "continue-later",
            note: "",
          },
        ],
        ended
      )
      expect(plannedSessions(state)[0].outcome).toBeNull()
    })
  })

  it("starts a timer of the block's length from ▶, and stays on the calendar", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(
      await screen.findByRole("button", {
        name: "Start a 25-minute timer for Essay",
      })
    )
    expect(saved().timer).toMatchObject({
      taskId: "a",
      plannedId: "p",
      plannedSeconds: 1500,
    })
    expect(window.location.hash).toBe("#/calendar")
    expect(
      screen.queryByRole("button", { name: /Start a 25-minute timer/ })
    ).toBeNull()
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
    expect(plannedSessions(saved())[0].date).toBe(addDays(TODAY, 1))
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
    expect(plannedSessions(saved())[0].date).toBe(addDays(TODAY, 6))
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 3))
  })
})
