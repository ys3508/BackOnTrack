// @vitest-environment jsdom
import { readFileSync } from "node:fs"

import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { weekStart } from "@/lib/calendar/derived"
import {
  EVENT_SWATCHES,
  applyEventDelete,
  applyEventEdit,
  colorOf,
  nextFreeQuarter,
  occurrencesBetween,
  plannedSessions,
  routinesOf,
} from "@/lib/calendar/model"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE, WORKSPACE_VERSION } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import {
  PRE_EVENTS_BACKUP_KEY,
  loadWorkspace,
  restoreWorkspace,
  saveWorkspace,
} from "@/lib/workspace/storage"
import { eventOf } from "./event-fixtures"

type CalendarProps = {
  events: {
    id: string
    title: string
    start: string
    end?: string
    allDay?: boolean
    classNames?: string[]
    extendedProps: Record<string, unknown>
  }[]
  dateClick: (info: unknown) => void
  datesSet: (info: unknown) => void
  eventDrop: (info: unknown) => void
  eventResize: (info: unknown) => void
  eventContent?: (info: unknown) => React.ReactNode
}

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

const props = () => calendar.props as CalendarProps
const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = localToday()
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)
const local = (date: string, hour = 0, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d, hour, minute)
}
const dates = (
  event: ReturnType<typeof eventOf>,
  from: string,
  until: string
) => occurrencesBetween(event, from, until).map((item) => item.date)

// 2026-11-02 is a Monday.
const MWF = { days: [1, 3, 5] }

describe("which days an event falls on", () => {
  const event = eventOf({ date: "2026-11-02", repeat: MWF })

  it("follows its weekdays, from its first day on", () => {
    expect(dates(event, "2026-10-26", "2026-11-09")).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
    ])
  })

  it("stops after until", () => {
    const ended = { ...event, repeat: { ...MWF, until: "2026-11-04" } }
    expect(dates(ended, "2026-11-01", "2026-12-01")).toEqual([
      "2026-11-02",
      "2026-11-04",
    ])
  })

  it("stops after a count", () => {
    const counted = { ...event, repeat: { ...MWF, count: 4 } }
    expect(dates(counted, "2026-11-01", "2026-12-01")).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
      "2026-11-09",
    ])
    // Asking only about later days doesn't restart the count.
    expect(dates(counted, "2026-11-10", "2026-12-01")).toEqual([])
  })

  it("shows one moved in from a date outside the range, where it landed", () => {
    const moved = {
      ...event,
      overrides: {
        "2026-11-02": { date: "2026-11-20", start: "18:00", end: "18:30" },
      },
    }
    const [found] = occurrencesBetween(moved, "2026-11-20", "2026-11-21")
    expect(found).toMatchObject({
      key: "2026-11-02",
      date: "2026-11-20",
      start: "18:00",
      adjusted: true,
    })
    expect(dates(moved, "2026-11-02", "2026-11-03")).toEqual([])
  })

  it("leaves out a cancelled one", () => {
    const cancelled = {
      ...event,
      overrides: { "2026-11-04": { cancelled: true } },
    }
    expect(dates(cancelled, "2026-11-02", "2026-11-07")).toEqual([
      "2026-11-02",
      "2026-11-06",
    ])
  })

  it("puts a one-off on its own date only", () => {
    const once = eventOf({ date: "2026-11-03", repeat: null })
    expect(dates(once, "2026-11-01", "2026-12-01")).toEqual(["2026-11-03"])
    expect(dates(once, "2026-11-04", "2026-12-01")).toEqual([])
  })

  it("knows how long something past midnight lasts", () => {
    const late = eventOf({ date: "2026-11-02", start: "23:30", minutes: 60 })
    expect(late.end).toBe("00:30")
    const [found] = occurrencesBetween(late, "2026-11-02", "2026-11-03")
    expect(found.minutes).toBe(60)
  })
})

describe("editing a repeating event", () => {
  const event = eventOf({ date: "2026-11-02", repeat: MWF })
  const edit = (
    scope: "one" | "following" | "all",
    key: string,
    patch: Parameters<typeof applyEventEdit>[4],
    events = [event]
  ) => applyEventEdit(events, "r", key, scope, patch, "new")

  it("This one only changes just that day", () => {
    const [after, ...rest] = edit("one", "2026-11-04", {
      start: "08:00",
      end: "08:30",
    })
    expect(rest).toEqual([])
    expect(after.start).toBe("07:00")
    expect(after.overrides).toEqual({
      "2026-11-04": { start: "08:00", end: "08:30" },
    })
  })

  it("This one only can move it to another day, and keeps its title apart", () => {
    const [after] = edit("one", "2026-11-04", {
      date: "2026-11-05",
      title: "Short walk",
    })
    const [found] = occurrencesBetween(after, "2026-11-05", "2026-11-06")
    expect(found).toMatchObject({ key: "2026-11-04", title: "Short walk" })
    expect(after.title).toBe("Walk")
  })

  it("This and following splits it, with the past untouched", () => {
    const withHistory = {
      ...event,
      outcomes: { "2026-11-02": "full", "2026-11-09": "minimum" } as const,
      overrides: {
        "2026-11-04": { cancelled: true },
        "2026-11-11": { start: "12:00" },
      },
    }
    const [earlier, later] = edit(
      "following",
      "2026-11-09",
      { start: "18:00", end: "18:30" },
      [withHistory]
    )
    expect(earlier).toMatchObject({
      id: "r",
      seriesId: "r",
      start: "07:00",
      repeat: { days: [1, 3, 5], until: "2026-11-08" },
      outcomes: { "2026-11-02": "full" },
      overrides: { "2026-11-04": { cancelled: true } },
    })
    expect(later).toMatchObject({
      id: "new",
      seriesId: "r",
      date: "2026-11-09",
      start: "18:00",
      outcomes: { "2026-11-09": "minimum" },
      overrides: { "2026-11-11": { start: "12:00" } },
    })
    expect(later.repeat?.until).toBeUndefined()
  })

  it("This and following keeps the same total when it's limited by a count", () => {
    const counted = { ...event, repeat: { ...MWF, count: 6 } }
    const [earlier, later] = edit(
      "following",
      "2026-11-09",
      { start: "18:00", end: "18:30" },
      [counted]
    )
    expect(earlier.repeat).toEqual({ days: [1, 3, 5], until: "2026-11-08" })
    expect(later.repeat).toEqual({ days: [1, 3, 5], count: 3 })
    const all = [
      ...dates(earlier, "2026-11-01", "2027-01-01"),
      ...dates(later, "2026-11-01", "2027-01-01"),
    ]
    expect(all).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
      "2026-11-09",
      "2026-11-11",
      "2026-11-13",
    ])
  })

  it("This and following from the very first one leaves no empty earlier part", () => {
    const after = edit("following", "2026-11-02", {
      start: "18:00",
      end: "18:30",
    })
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: "r", seriesId: null, start: "18:00" })
  })

  it("This and following moved by a day carries its days, overrides, and outcomes", () => {
    const withHistory = {
      ...event,
      outcomes: { "2026-11-11": "skipped" } as const,
      overrides: { "2026-11-13": { date: "2026-11-14" } },
    }
    const [, later] = edit("following", "2026-11-09", { date: "2026-11-10" }, [
      withHistory,
    ])
    expect(later.date).toBe("2026-11-10")
    expect(later.repeat?.days).toEqual([2, 4, 6])
    expect(later.outcomes).toEqual({ "2026-11-12": "skipped" })
    expect(later.overrides).toEqual({
      "2026-11-14": { date: "2026-11-15" },
    })
  })

  it("All changes the base and leaves other days' own changes alone", () => {
    const adjusted = {
      ...event,
      overrides: { "2026-11-04": { start: "12:00", end: "12:30" } },
    }
    const [after] = edit("all", "2026-11-06", { start: "18:00", end: "18:45" }, [
      adjusted,
    ])
    expect(after).toMatchObject({ start: "18:00", end: "18:45" })
    expect(after.overrides["2026-11-04"].start).toBe("12:00")
  })

  it("All moved by a day shifts the whole series with what's stored on it", () => {
    const withHistory = {
      ...event,
      outcomes: { "2026-11-04": "full" } as const,
      overrides: { "2026-11-06": { start: "09:00" } },
    }
    const [after] = edit("all", "2026-11-09", { date: "2026-11-10" }, [
      withHistory,
    ])
    expect(after.date).toBe("2026-11-03")
    expect(after.repeat?.days).toEqual([2, 4, 6])
    expect(after.outcomes).toEqual({ "2026-11-05": "full" })
    expect(after.overrides).toEqual({ "2026-11-07": { start: "09:00" } })
  })

  it("All reaches every part of a series that was split earlier", () => {
    const parts = edit("following", "2026-11-09", {
      start: "18:00",
      end: "18:30",
    })
    const after = applyEventEdit(
      parts,
      "new",
      "2026-11-09",
      "all",
      { color: "#c23a86", title: "Run" },
      "unused"
    )
    expect(after.map((item) => [item.title, item.color])).toEqual([
      ["Run", "#c23a86"],
      ["Run", "#c23a86"],
    ])
    expect(routinesOf({ events: after })).toHaveLength(1)
    expect(routinesOf({ events: after })[0].current.id).toBe("new")
  })

  it("no longer repeating leaves only that occurrence", () => {
    const after = edit("all", "2026-11-09", { repeat: null })
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ date: "2026-11-09", repeat: null })
  })

  it("a one-off just changes, and its outcome goes with it", () => {
    const once = eventOf({
      date: "2026-11-03",
      repeat: null,
      outcomes: { "2026-11-03": "minimum" },
    })
    const [after] = edit("one", "2026-11-03", { date: "2026-11-05" }, [once])
    expect(after.date).toBe("2026-11-05")
    expect(after.outcomes).toEqual({ "2026-11-05": "minimum" })
    expect(after.overrides).toEqual({})
  })

  it("leaves everything alone for an id it doesn't know", () => {
    const events = [event]
    expect(applyEventEdit(events, "nope", "x", "all", {}, "y")).toBe(events)
  })
})

describe("deleting a repeating event", () => {
  const event = eventOf({
    date: "2026-11-02",
    repeat: MWF,
    outcomes: { "2026-11-02": "full", "2026-11-09": "full" },
  })

  it("This one only cancels that day", () => {
    const [after] = applyEventDelete([event], "r", "2026-11-04", "one")
    expect(after.overrides["2026-11-04"].cancelled).toBe(true)
    expect(dates(after, "2026-11-02", "2026-11-07")).toEqual([
      "2026-11-02",
      "2026-11-06",
    ])
  })

  it("This and following ends it the day before, keeping the past", () => {
    const [after] = applyEventDelete([event], "r", "2026-11-09", "following")
    expect(after.repeat).toEqual({ days: [1, 3, 5], until: "2026-11-08" })
    expect(after.outcomes).toEqual({ "2026-11-02": "full" })
  })

  it("This and following from the first one removes it", () => {
    expect(applyEventDelete([event], "r", "2026-11-02", "following")).toEqual([])
  })

  it("All removes every part of the series and nothing else", () => {
    const other = eventOf({ id: "other", date: "2026-11-02" })
    const parts = applyEventEdit(
      [event, other],
      "r",
      "2026-11-09",
      "following",
      { start: "18:00", end: "18:30" },
      "new"
    )
    expect(parts).toHaveLength(3)
    expect(applyEventDelete(parts, "new", "2026-11-09", "all")).toEqual([other])
  })

  it("removes a one-off whatever the scope", () => {
    const once = eventOf({ date: "2026-11-03", repeat: null })
    expect(applyEventDelete([once], "r", "2026-11-03", "one")).toEqual([])
  })
})

describe("finding the next free quarter hour", () => {
  const date = "2026-11-02"
  const at = (start: string, minutes: number, fields = {}) =>
    eventOf({ id: start, date, start, minutes, repeat: null, ...fields })

  it("rounds up to a quarter hour, never down", () => {
    const empty = { events: [] }
    expect(nextFreeQuarter(empty, date, "15:01", 30)).toBe("15:15")
    expect(nextFreeQuarter(empty, date, "15:15", 30)).toBe("15:15")
    expect(nextFreeQuarter(empty, date, "15:46", 30)).toBe("16:00")
  })

  it("skips what's already there, and needs room for the whole length", () => {
    const events = [at("09:00", 60), at("10:30", 30)]
    expect(nextFreeQuarter({ events }, date, "09:00", 30)).toBe("10:00")
    expect(nextFreeQuarter({ events }, date, "09:00", 45)).toBe("11:00")
  })

  it("doesn't count flexible events or buffers as busy", () => {
    const events = [
      at("09:00", 60, { flexible: true }),
      at("09:00", 60, { id: "b", kind: "buffer" }),
    ]
    expect(nextFreeQuarter({ events }, date, "09:00", 30)).toBe("09:00")
  })

  it("stays inside the day when nothing fits", () => {
    expect(nextFreeQuarter({ events: [] }, date, "23:50", 30)).toBe("23:45")
  })
})

describe("colours", () => {
  it("uses what was picked, then the task's, then the default", () => {
    const tasks = [{ id: "t", focusTheme: "mint-garden" as const }]
    expect(colorOf({ color: "#123456", taskId: "t" }, tasks)).toBe("#123456")
    expect(colorOf({ color: null, taskId: "t" }, tasks)).toBe("#3F6B12")
    expect(colorOf({ color: null, taskId: null }, tasks)).toBe(
      EVENT_SWATCHES[0].value
    )
  })
})

describe("migrating saved data", () => {
  const task = {
    id: "t",
    title: "Essay",
    description: "",
    status: "not-started",
    priority: "none",
    deadline: null,
    originalDeadline: null,
    progress: 0,
    nextAction: "",
    subtasks: [],
    documents: [],
    history: [],
    estimateMinutes: null,
    createdAt: AT,
    updatedAt: AT,
    completedAt: null,
    recovery: null,
    rejectedPlans: [],
  }
  const planned = (fields: Record<string, unknown>) => ({
    taskId: "t",
    date: "2026-11-10",
    time: "09:00",
    minutes: 25,
    label: "",
    done: false,
    outcome: null,
    window: null,
    ...fields,
  })
  const routine = (fields: Record<string, unknown>) => ({
    id: "r",
    name: "Gym",
    color: "#4a7d1e",
    emoji: "🏋️",
    rrule: "DTSTART:20261002T180000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
    duration: 45,
    exdates: [],
    doneDates: [],
    kind: "fixed",
    minimumVersion: "shoes on",
    minimumDates: [],
    skippedDates: [],
    priorRules: [],
    createdAt: AT,
    ...fields,
  })
  const v2 = (fields: Record<string, unknown>) => ({
    version: 2,
    tasks: [task],
    focusSessions: [],
    planned: [],
    routines: [],
    routinePlacements: [],
    legacyMigrated: true,
    ...fields,
  })
  const placement = (fields: Record<string, unknown>) => ({
    routineId: "r",
    time: "10:00",
    done: false,
    minutes: null,
    adjusted: false,
    result: null,
    ...fields,
  })

  it("keeps every planned block, with its id and answer", () => {
    const restored = restoreWorkspace(
      v2({
        planned: [
          planned({ id: "open", label: "Outline" }),
          planned({ id: "done", done: true }),
          planned({ id: "did", done: true, outcome: "did" }),
          planned({ id: "didnt", outcome: "didnt" }),
          planned({ id: "morning", time: null, window: "morning" }),
        ],
      })
    )
    expect(restored.version).toBe(WORKSPACE_VERSION)
    const views = plannedSessions(restored)
    expect(views.map((item) => item.id)).toEqual([
      "open",
      "done",
      "did",
      "didnt",
      "morning",
    ])
    const view = (id: string) => views.find((item) => item.id === id)!
    expect(view("open")).toMatchObject({
      time: "09:00",
      minutes: 25,
      label: "Outline",
      done: false,
      outcome: null,
    })
    expect(view("done")).toMatchObject({ done: true, outcome: null })
    expect(view("did")).toMatchObject({ done: true, outcome: "did" })
    expect(view("didnt")).toMatchObject({ done: false, outcome: "didnt" })
    expect(view("morning")).toMatchObject({
      time: null,
      window: "morning",
      minutes: 25,
    })
    expect(restored.events[0].title).toBe("Essay")
    expect(restored.unmigrated).toEqual([])
  })

  it("turns a routine whose rule changed into parts of one series", () => {
    const restored = restoreWorkspace(
      v2({
        routines: [
          routine({
            priorRules: [
              {
                rrule:
                  "DTSTART:20260105T070000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261001T235959",
                duration: 30,
              },
            ],
            doneDates: ["2026-01-05", "2026-11-09"],
            minimumDates: ["2026-11-11"],
            skippedDates: ["2026-11-13"],
          }),
        ],
      })
    )
    const [live, prior] = restored.events
    expect(live).toMatchObject({
      id: "r",
      title: "Gym",
      emoji: "🏋️",
      color: "#4a7d1e",
      minimum: "shoes on",
      seriesId: "r",
      date: "2026-10-02",
      start: "18:00",
      end: "18:45",
      repeat: { days: [1, 3, 5] },
      outcomes: {
        "2026-11-09": "full",
        "2026-11-11": "minimum",
        "2026-11-13": "skipped",
      },
    })
    expect(prior).toMatchObject({
      seriesId: "r",
      date: "2026-01-05",
      start: "07:00",
      end: "07:30",
      repeat: { days: [1, 3], until: "2026-10-01" },
      outcomes: { "2026-01-05": "full" },
    })
    expect(routinesOf(restored)).toHaveLength(1)
  })

  it("pairs moved occurrences with the days they left, and keeps what's left over", () => {
    const restored = restoreWorkspace(
      v2({
        routines: [
          routine({
            exdates: ["2026-11-02", "2026-11-04", "2026-11-06"],
          }),
        ],
        routinePlacements: [
          placement({
            id: "same-day",
            date: "2026-11-02",
            time: "20:00",
            adjusted: true,
            result: "minimum",
          }),
          placement({
            id: "other-day",
            date: "2026-11-05",
            time: "09:00",
            adjusted: true,
          }),
          placement({
            id: "extra",
            date: "2026-11-07",
            time: "10:00",
            done: true,
          }),
        ],
      })
    )
    const [event, extra] = restored.events
    expect(event.overrides).toEqual({
      "2026-11-02": { start: "20:00", end: "20:45" },
      "2026-11-04": { date: "2026-11-05", start: "09:00", end: "09:45" },
      "2026-11-06": { cancelled: true },
    })
    expect(event.outcomes).toEqual({ "2026-11-02": "minimum" })
    expect(dates(event, "2026-11-02", "2026-11-07")).toEqual([
      "2026-11-02",
      "2026-11-05",
    ])
    expect(extra).toMatchObject({
      id: "extra",
      seriesId: "r",
      date: "2026-11-07",
      start: "10:00",
      end: "10:45",
      repeat: null,
      outcomes: { "2026-11-07": "full" },
    })
    expect(restored.events).toHaveLength(2)
  })

  it("carries a flexible routine over as any time that day", () => {
    const [event] = restoreWorkspace(
      v2({
        routines: [
          routine({
            kind: "flexible",
            rrule: "DTSTART:20261102T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO",
            duration: 20,
          }),
        ],
      })
    ).events
    expect(event).toMatchObject({
      flexible: true,
      start: "00:00",
      end: "00:20",
    })
  })

  it("keeps anything it can't read, rather than dropping it", () => {
    const restored = restoreWorkspace(
      v2({
        planned: [{ nope: true }],
        routines: [{ id: "x" }, routine({ id: "bad", rrule: "garbage" })],
        routinePlacements: [
          { nope: true },
          placement({ id: "orphan", routineId: "gone", date: "2026-11-02" }),
        ],
      })
    )
    expect(restored.events).toEqual([])
    expect(restored.unmigrated.map((item) => item.source).sort()).toEqual([
      "planned",
      "routinePlacements",
      "routinePlacements",
      "routines",
      "routines",
    ])
    // They're still there after saving and loading again.
    const again = restoreWorkspace(JSON.parse(JSON.stringify(restored)))
    expect(again.unmigrated).toEqual(restored.unmigrated)
  })

  it("keeps an event that can't be read too", () => {
    const restored = restoreWorkspace({
      version: WORKSPACE_VERSION,
      events: [{ nope: true }],
    })
    expect(restored.events).toEqual([])
    expect(restored.unmigrated).toEqual([
      { source: "events", record: { nope: true } },
    ])
  })

  it("changes nothing on the next load", () => {
    const first = restoreWorkspace(
      v2({
        planned: [planned({ id: "a", done: true })],
        routines: [routine({ exdates: ["2026-11-02"] })],
        routinePlacements: [
          placement({ id: "x", date: "2026-11-07" }),
          placement({ id: "y", date: "2026-11-02", adjusted: true }),
        ],
      })
    )
    const second = restoreWorkspace(JSON.parse(JSON.stringify(first)))
    expect(second).toEqual(first)
  })

  describe("the backup", () => {
    beforeEach(() => window.localStorage.clear())

    it("copies the old data first, and only once", () => {
      const raw = JSON.stringify(v2({ routines: [routine({})] }))
      window.localStorage.setItem(STORAGE, raw)
      const loaded = loadWorkspace()
      expect(loaded.events).toHaveLength(1)
      expect(window.localStorage.getItem(PRE_EVENTS_BACKUP_KEY)).toBe(raw)
      saveWorkspace(loaded)
      expect(saved().version).toBe(WORKSPACE_VERSION)
      expect(loadWorkspace().events).toEqual(loaded.events)
      expect(window.localStorage.getItem(PRE_EVENTS_BACKUP_KEY)).toBe(raw)
    })

    it("isn't written for data that's already current", () => {
      saveWorkspace(EMPTY_WORKSPACE)
      loadWorkspace()
      expect(window.localStorage.getItem(PRE_EVENTS_BACKUP_KEY)).toBeNull()
    })

    it("keeps the oldest copy if the data is downgraded and loaded again", () => {
      window.localStorage.setItem(PRE_EVENTS_BACKUP_KEY, "first")
      window.localStorage.setItem(STORAGE, JSON.stringify(v2({})))
      loadWorkspace()
      expect(window.localStorage.getItem(PRE_EVENTS_BACKUP_KEY)).toBe("first")
    })
  })
})

describe("on the calendar", () => {
  const nextMonday = addDays(weekStart(TODAY), 8)
  const showView = (type: string, from: string, until: string) =>
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
  const seed = (state: Workspace) =>
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...state,
        legacyMigrated: true,
        lastOpenedAt: new Date().toISOString(),
      })
    )
  const findItem = (id: string) =>
    props().events.find((event) => event.id === id)
  const cardColor = () =>
    document
      .querySelector<HTMLElement>("[data-routine-card]")
      ?.style.getPropertyValue("--event-color")

  beforeEach(() => {
    window.localStorage.clear()
    window.location.hash = "#/calendar"
    window.scrollTo = vi.fn() as typeof window.scrollTo
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ live: false, model: null }))
    )
  })

  it("opens the editor where it can be seen, and saves a block in the chosen colour", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const date = addDays(TODAY, 1)
    clickSlot(`${date}T10:00:00`)
    const dialog = await screen.findByRole("dialog", { name: "New event" })
    // .bot-card's position used to beat this, and put it below the whole page.
    expect(dialog).toHaveClass("bot-card", "fixed")
    expect(readFileSync("app/globals.css", "utf8")).toMatch(
      /\.bot-card\.fixed\s*\{\s*position: fixed;/
    )
    const title = screen.getByRole("combobox", { name: "Title" })
    await waitFor(() => expect(title).toHaveFocus())
    await user.type(title, "Read ch.3")
    await user.click(screen.getByRole("button", { name: "45" }))
    expect(screen.getByTestId("event-end")).toHaveTextContent("Ends 10:45 AM")
    await user.click(screen.getByRole("button", { name: "Blue" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    const [event] = saved().events
    expect(event).toMatchObject({
      title: "Read ch.3",
      date,
      start: "10:00",
      end: "10:45",
      color: "#0b4fb3",
      repeat: null,
    })
    await waitFor(() =>
      expect(findItem(`planned:${event.id}`)).toMatchObject({
        start: `${date}T10:00`,
        end: `${date}T10:45`,
        classNames: ["bot-planned"],
        extendedProps: { color: "#0b4fb3", status: "planned" },
      })
    )
    expect(findItem("pending")).toBeUndefined()
  })

  it("cancels on Escape, leaving nothing behind", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${addDays(TODAY, 1)}T10:00:00`)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Nope{Escape}"
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(findItem("pending")).toBeUndefined()
    expect(saved().events).toEqual([])
    expect(saved().tasks).toEqual([])
  })

  it("shows a repeating event on every day, on the Routines page, and in the sidebar", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    clickSlot(`${nextMonday}T07:00:00`)
    await user.type(
      await screen.findByRole("combobox", { name: "Title" }),
      "Gym"
    )
    await user.click(screen.getByRole("button", { name: "30" }))
    await user.selectOptions(screen.getByLabelText("Repeat"), "weekdays")
    await user.type(
      screen.getByLabelText("Minimum version (optional)"),
      "shoes on"
    )
    await user.click(screen.getByRole("button", { name: "Green" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    const [event] = saved().events
    expect(event).toMatchObject({
      title: "Gym",
      taskId: null,
      minimum: "shoes on",
      color: "#4a7d1e",
      repeat: { days: [1, 2, 3, 4, 5] },
    })
    expect(saved().tasks).toEqual([])

    showView("timeGridWeek", addDays(nextMonday, -1), addDays(nextMonday, 6))
    await waitFor(() => {
      const shown = props().events.filter((item) =>
        item.id.startsWith(`routine:${event.id}:`)
      )
      expect(shown).toHaveLength(5)
      for (const item of shown) {
        expect(item.extendedProps.color).toBe("#4a7d1e")
        expect(item.classNames).toEqual(["bot-planned"])
      }
    })

    const sidebar = await screen.findByRole("region", { name: "My routines" })
    expect(sidebar).toHaveTextContent("Gym")
    expect(sidebar).toHaveTextContent("Weekdays")
    expect(cardColor()).toBe("#4a7d1e")

    await user.click(screen.getByRole("button", { name: "Routines" }))
    await waitFor(() => expect(window.location.hash).toBe("#/routines"))
    expect(
      await screen.findByRole("region", { name: "My routines" })
    ).toHaveTextContent("Minimum: shoes on")
    expect(cardColor()).toBe("#4a7d1e")
  })

  describe("dragging an occurrence of something repeating", () => {
    const weekday = eventOf({
      title: "Gym",
      date: nextMonday,
      repeat: { days: [1, 2, 3, 4, 5] },
    })
    const wednesday = addDays(nextMonday, 2)
    const open = async () => {
      seed(run([{ type: "add-event", event: weekday }]))
      render(<WorkspaceApp />)
      await screen.findByRole("heading", { name: "Calendar" })
      showView("timeGridWeek", addDays(nextMonday, -1), addDays(nextMonday, 6))
    }
    const dropAt = (hour: number) => {
      const revert = vi.fn()
      act(() =>
        props().eventDrop({
          revert,
          event: {
            title: "Gym",
            start: local(wednesday, hour),
            allDay: false,
            extendedProps: { kind: "routine", refId: "r", key: wednesday },
          },
        })
      )
      return revert
    }

    it("asks first, and This one only moves just that day and marks it", async () => {
      await open()
      const user = userEvent.setup()
      const revert = dropAt(8)
      expect(revert).toHaveBeenCalled()
      // Nothing has changed until they answer.
      expect(saved().events[0].overrides).toEqual({})
      await user.click(
        await screen.findByRole("button", { name: "This one only" })
      )
      expect(saved().events).toHaveLength(1)
      expect(saved().events[0].start).toBe("07:00")
      expect(saved().events[0].overrides).toEqual({
        [wednesday]: { start: "08:00", end: "08:30" },
      })
      await waitFor(() =>
        expect(findItem(`routine:r:${wednesday}`)).toMatchObject({
          start: `${wednesday}T08:00`,
          extendedProps: { adjusted: true },
        })
      )
      expect(findItem(`routine:r:${nextMonday}`)).toMatchObject({
        start: `${nextMonday}T07:00`,
        extendedProps: { adjusted: false },
      })
      expect(
        screen.getByTestId(`event-routine:r:${wednesday}`)
      ).toHaveTextContent("adjusted")
      expect(
        screen.getByTestId(`event-routine:r:${nextMonday}`)
      ).not.toHaveTextContent("adjusted")
    })

    it("This and following splits from that day", async () => {
      await open()
      const user = userEvent.setup()
      dropAt(8)
      await user.click(
        await screen.findByRole("button", { name: "This and following" })
      )
      const [earlier, later] = saved().events
      expect(earlier.repeat.until).toBe(addDays(wednesday, -1))
      expect(later).toMatchObject({ date: wednesday, start: "08:00" })
    })

    it("All moves every one", async () => {
      await open()
      const user = userEvent.setup()
      dropAt(8)
      await user.click(await screen.findByRole("button", { name: "All" }))
      expect(saved().events).toHaveLength(1)
      expect(saved().events[0]).toMatchObject({
        start: "08:00",
        end: "08:30",
        overrides: {},
      })
    })

    it("cancelling changes nothing", async () => {
      await open()
      const user = userEvent.setup()
      dropAt(8)
      await user.click(await screen.findByRole("button", { name: "Cancel" }))
      expect(saved().events[0]).toMatchObject({ start: "07:00", overrides: {} })
    })

    it("resizing asks too", async () => {
      await open()
      const user = userEvent.setup()
      const revert = vi.fn()
      act(() =>
        props().eventResize({
          revert,
          event: {
            title: "Gym",
            start: local(wednesday, 7),
            end: local(wednesday, 7, 45),
            extendedProps: { kind: "routine", refId: "r", key: wednesday },
          },
        })
      )
      expect(revert).toHaveBeenCalled()
      await user.click(
        await screen.findByRole("button", { name: "This one only" })
      )
      expect(saved().events[0].overrides).toEqual({
        [wednesday]: { end: "07:45" },
      })
    })
  })

  it("changes a colour everywhere at once, without a reload", async () => {
    seed(run([{ type: "add-event", event: eventOf({ title: "Gym" }) }]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(cardColor()).toBe("#4a7d1e")

    await user.click(screen.getByRole("button", { name: "Edit Gym" }))
    await user.click(await screen.findByRole("button", { name: "Rose" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(saved().events[0].color).toBe("#c23a86")
    await waitFor(() => expect(cardColor()).toBe("#c23a86"))
    expect(findItem(`routine:r:${TODAY}`)?.extendedProps.color).toBe("#c23a86")

    await user.click(screen.getByRole("button", { name: "Routines" }))
    await screen.findByRole("heading", { name: "Routines" })
    await waitFor(() => expect(cardColor()).toBe("#c23a86"))

    await user.click(screen.getByRole("button", { name: "Today" }))
    await waitFor(() => {
      const block = document.querySelector<HTMLElement>(
        '.bot-tl-block[data-block-id="r"]'
      )
      expect(block?.style.getPropertyValue("--event-color")).toBe("#c23a86")
    })
  })

  it("opens the Add button's editor at the next free quarter hour", async () => {
    const tomorrow = addDays(TODAY, 1)
    seed(
      run([
        { type: "create-task", id: "a", at: AT, title: "A" },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "p",
            taskId: "a",
            date: tomorrow,
            time: "09:00",
            minutes: 60,
            label: "",
            done: false,
          },
        },
      ])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    showView("timeGridDay", tomorrow, addDays(tomorrow, 1))
    await user.click(await screen.findByRole("button", { name: /^Add to/ }))
    expect(screen.getByLabelText("Date")).toHaveValue(tomorrow)
    expect(screen.getByLabelText("Start")).toHaveValue("10:00")
  })

  it("opens at a quarter hour for today too, whatever the time is", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await screen.findByRole("button", { name: /^Add to/ }))
    const start = screen.getByLabelText("Start") as HTMLInputElement
    expect(Number(start.value.slice(3)) % 15).toBe(0)
  })

  it("loads data from before this change, and loses nothing on reload", async () => {
    const before = {
      version: 2,
      legacyMigrated: true,
      lastOpenedAt: new Date().toISOString(),
      tasks: [],
      focusSessions: [],
      planned: [],
      routinePlacements: [],
      routines: [
        {
          id: "r",
          name: "Morning walk",
          color: "#4a7d1e",
          emoji: "🚶",
          rrule:
            "DTSTART:20200101T070000\nRRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA",
          duration: 30,
          createdAt: AT,
        },
      ],
    }
    const raw = JSON.stringify(before)
    window.localStorage.setItem(STORAGE, raw)
    render(<WorkspaceApp />)
    const sidebar = await screen.findByRole("region", { name: "My routines" })
    expect(sidebar).toHaveTextContent("Morning walk")
    expect(findItem(`routine:r:${TODAY}`)).toBeTruthy()
    expect(window.localStorage.getItem(PRE_EVENTS_BACKUP_KEY)).toBe(raw)
    await waitFor(() => expect(saved().version).toBe(WORKSPACE_VERSION))

    cleanup()
    render(<WorkspaceApp />)
    expect(
      await screen.findByRole("region", { name: "My routines" })
    ).toHaveTextContent("Morning walk")
    expect(saved().events).toHaveLength(1)
    expect(window.localStorage.getItem(PRE_EVENTS_BACKUP_KEY)).toBe(raw)
  })
})
