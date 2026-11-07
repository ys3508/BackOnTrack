// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildCalendarItems } from "@/lib/calendar/events"
import {
  applyEventEdit,
  newBuffer,
  occurrencesBetween,
  plannedSessions,
  routinesOf,
} from "@/lib/calendar/model"
import { overviewOf } from "@/lib/calendar/overview"
import { dueReminders } from "@/lib/today/reminders"
import { hasScheduleToday, todayAgenda } from "@/lib/today/timeline"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { CalendarEvent, Workspace } from "@/lib/workspace/schemas"

type CalendarProps = {
  events: {
    id: string
    display?: string
    classNames?: string[]
    extendedProps: Record<string, unknown>
  }[]
  drop: (info: unknown) => void
  eventResize: (info: unknown) => void
}

const calendar = vi.hoisted(() => ({ props: null as unknown }))
vi.mock("@fullcalendar/react", () => ({
  default: (props: CalendarProps) => {
    calendar.props = props
    return <div>Calendar grid</div>
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

const props = () => calendar.props as CalendarProps
const STORAGE = "backontrack.workspace.v1"
const AT = "2020-01-05T12:00:00.000Z"
const TODAY = localToday()
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!) as Workspace
const buffersIn = (state: Workspace) =>
  state.events.filter((event) => event.kind === "buffer")
const seed = (state: Workspace) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({
      ...state,
      legacyMigrated: true,
      lastOpenedAt: new Date().toISOString(),
    })
  )
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)
const task = (id: string): WorkspaceAction => ({
  type: "create-task",
  id,
  at: AT,
  title: `Task ${id}`,
  deadline: null,
})
const block = (id: string, time: string, minutes = 30): WorkspaceAction => ({
  type: "add-planned",
  at: AT,
  session: {
    id,
    taskId: "a",
    date: TODAY,
    time,
    minutes,
    label: "",
    done: false,
  },
})
const addBuffer = (event: CalendarEvent): WorkspaceAction => ({
  type: "add-event",
  event,
})
const pad = (value: number) => String(value).padStart(2, "0")
/** Half an hour ago, so a block from then has been missed. */
const earlier = () => {
  const date = new Date(Date.now() - 30 * 60_000)
  return localToday(date) === TODAY
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : "00:00"
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ""
})

describe("buffers are the user's", () => {
  it("doesn't put any on a fresh day", () => {
    expect(buildCalendarItems(EMPTY_WORKSPACE, TODAY)).toEqual([])
    expect(todayAgenda(EMPTY_WORKSPACE, TODAY, Date.now()).buffers).toEqual([])
  })

  it("drops a chip into a hatched buffer of the default length, then resizes", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const chip = document.createElement("li")
    chip.setAttribute("data-kind", "buffer")
    chip.setAttribute("data-id", "buffer")
    const [y, m, d] = TODAY.split("-").map(Number)
    props().drop({
      date: new Date(y, m - 1, d, 16, 0),
      allDay: false,
      draggedEl: chip,
    })
    await waitFor(() => expect(buffersIn(saved())).toHaveLength(1))
    expect(buffersIn(saved())[0]).toMatchObject({
      start: "16:00",
      end: "16:30",
      taskId: null,
    })
    await waitFor(() =>
      expect(
        props().events.find((item) => item.extendedProps.kind === "buffer")
          ?.classNames
      ).toEqual(["bot-buffer-block"])
    )
    const { id, extendedProps } = props().events.find(
      (item) => item.extendedProps.kind === "buffer"
    )!
    expect(id).toContain(buffersIn(saved())[0].id)
    props().eventResize({
      revert: vi.fn(),
      event: {
        start: new Date(y, m - 1, d, 16, 0),
        end: new Date(y, m - 1, d, 16, 45),
        extendedProps,
      },
    })
    await waitFor(() => expect(buffersIn(saved())[0].end).toBe("16:45"))
  })

  it("follows the default length from Settings", async () => {
    seed(run([{ type: "settings", patch: { bufferMinutes: 60 } }]))
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const chip = document.createElement("li")
    chip.setAttribute("data-kind", "buffer")
    chip.setAttribute("data-id", "buffer")
    const [y, m, d] = TODAY.split("-").map(Number)
    props().drop({
      date: new Date(y, m - 1, d, 9, 0),
      allDay: false,
      draggedEl: chip,
    })
    await waitFor(() => expect(buffersIn(saved())[0]?.end).toBe("10:00"))
  })

  it("can be made in the editor, without creating a task", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: /^Add to / }))
    await user.click(await screen.findByRole("checkbox", { name: /Buffer/ }))
    expect(screen.queryByRole("combobox", { name: "Title" })).toBeNull()
    expect(screen.queryByRole("checkbox", { name: /Any time/ })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(buffersIn(saved())).toHaveLength(1))
    expect(saved().tasks).toEqual([])
  })

  it("can repeat and be moved like an event, and isn't a routine", () => {
    const weekly = {
      ...newBuffer("b", "2026-11-02", "15:00", 30),
      repeat: { days: [1] },
    }
    expect(
      occurrencesBetween(weekly, "2026-11-02", "2026-11-17").map(
        (item) => item.date
      )
    ).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"])
    expect(routinesOf({ events: [weekly] })).toEqual([])
    const [moved] = applyEventEdit(
      [weekly],
      "b",
      "2026-11-09",
      "one",
      { start: "16:00", end: "16:30" },
      "n"
    )
    expect(occurrencesBetween(moved, "2026-11-09", "2026-11-10")[0]).toMatchObject(
      { start: "16:00", adjusted: true }
    )
  })

  it("can be deleted", () => {
    const state = run([
      addBuffer(newBuffer("b", TODAY, "15:00", 30)),
      { type: "delete-event", id: "b", key: TODAY, scope: "all" },
    ])
    expect(state.events).toEqual([])
  })
})

describe("an unused buffer", () => {
  const past = addDays(TODAY, -2)
  const state = run([addBuffer(newBuffer("b", past, "09:00", 60))])
  const range = { from: past, until: TODAY }

  it("never counts as missed", () => {
    const [item] = buildCalendarItems(state, TODAY, Date.now(), range)
    expect(item.extendedProps.status).toBe("buffer")
    expect(item.classNames).toEqual(["bot-buffer-block"])
    expect(item.extendedProps.awaitingAnswer).toBeFalsy()
  })

  it("isn't planned work, in stats or anywhere that reads planned blocks", () => {
    expect(plannedSessions(state)).toEqual([])
    expect(
      overviewOf(state.activity, { from: past, until: TODAY }).plannedMinutes
    ).toBe(0)
  })

  it("doesn't make a day count as scheduled, or remind", () => {
    const today = run([addBuffer(newBuffer("b", TODAY, "23:00", 30))])
    expect(hasScheduleToday(today, TODAY, Date.now())).toBe(false)
    expect(dueReminders(today, Date.now())).toEqual([])
  })
})

describe("something inside a buffer", () => {
  it("sends the buffer behind it, without taking a column", () => {
    const state = run([
      task("a"),
      addBuffer(newBuffer("b", TODAY, "15:00", 60)),
      block("m", "15:00"),
    ])
    const items = buildCalendarItems(state, TODAY, Date.now())
    const buffer = items.find((item) => item.extendedProps.kind === "buffer")!
    expect(buffer.display).toBe("background")
    expect(buffer.editable).toBe(false)
    expect(buffer.extendedProps.occupied).toBe(true)
    const planned = items.find((item) => item.extendedProps.kind === "planned")!
    expect(planned.display).toBeUndefined()
    expect(planned.editable).toBe(true)
  })

  it("leaves the buffer movable while it's empty", () => {
    const state = run([
      task("a"),
      addBuffer(newBuffer("b", TODAY, "15:00", 60)),
      block("m", "16:00"),
    ])
    const buffer = buildCalendarItems(state, TODAY, Date.now()).find(
      (item) => item.extendedProps.kind === "buffer"
    )!
    expect(buffer.display).toBeUndefined()
    expect(buffer.editable).toBe(true)
  })
})

describe("Move to buffer", () => {
  it("puts a missed block into today's next free buffer", async () => {
    seed(
      run([
        task("a"),
        block("m", earlier(), 15),
        addBuffer(newBuffer("b", TODAY, "23:30", 30)),
      ])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "Move to buffer" }))
    await waitFor(() =>
      expect(plannedSessions(saved())[0]).toMatchObject({
        date: TODAY,
        time: "23:30",
        minutes: 15,
      })
    )
    expect(saved().tasks[0].status).toBe("not-started")
  })

  it("with no buffer, offers the next free time and moves nothing yet", async () => {
    const time = earlier()
    seed(run([task("a"), block("m", time, 15)]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "Move to buffer" }))
    expect(await screen.findByText(/Nothing has moved/)).toBeTruthy()
    expect(plannedSessions(saved())[0].time).toBe(time)
    expect(buffersIn(saved())).toEqual([])
    await user.click(screen.getByRole("button", { name: "Move it there" }))
    await waitFor(() =>
      expect(plannedSessions(saved())[0].time).not.toBe(time)
    )
    expect(buffersIn(saved())).toEqual([])
  })

  it("can make that free time a buffer, with the block inside it", async () => {
    seed(run([task("a"), block("m", earlier(), 15)]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: "Move to buffer" }))
    await user.click(
      await screen.findByRole("button", { name: "Make this a buffer" })
    )
    await waitFor(() => expect(buffersIn(saved())).toHaveLength(1))
    const [buffer] = buffersIn(saved())
    const [moved] = plannedSessions(saved())
    expect(moved.date).toBe(buffer.date)
    expect(moved.time).toBe(buffer.start)
    expect(buffer.end).toBe(moved.time && addMinutes(moved.time, 15))
  })
})

function addMinutes(clock: string, minutes: number) {
  const [hours, mins] = clock.split(":").map(Number)
  const total = (hours * 60 + mins + minutes) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}
