// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { seedActivity } from "@/lib/calendar/activity"
import { newBuffer } from "@/lib/calendar/model"
import {
  focusByDay,
  median,
  overviewOf,
  plannedByDay,
  previousPeriod,
  trackingSince,
} from "@/lib/calendar/overview"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { restoreWorkspace } from "@/lib/workspace/storage"
import { eventOf } from "./event-fixtures"

const calendar = vi.hoisted(() => ({ props: null as unknown }))
vi.mock("@fullcalendar/react", () => ({
  default: (props: unknown) => {
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

const props = () =>
  calendar.props as { datesSet: (info: unknown) => void }
const STORAGE = "backontrack.workspace.v1"
const TODAY = localToday()
const today = { from: TODAY, until: addDays(TODAY, 1) }
const local = (hour: number, minute = 0) => {
  const [y, m, d] = TODAY.split("-").map(Number)
  return new Date(y, m - 1, d, hour, minute)
}
const iso = (hour: number, minute = 0) => local(hour, minute).toISOString()
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)
const seed = (state: Workspace) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({
      ...state,
      legacyMigrated: true,
      lastOpenedAt: new Date().toISOString(),
    })
  )
const task = (id: string): WorkspaceAction => ({
  type: "create-task",
  id,
  at: iso(8),
  title: id,
})
const block = (id: string, taskId: string, time: string, minutes = 30) =>
  ({
    type: "add-planned",
    at: iso(8),
    session: {
      id,
      taskId,
      date: TODAY,
      time,
      minutes,
      label: "",
      done: false,
    },
  }) as WorkspaceAction
const focus = (
  id: string,
  taskId: string,
  hour: number,
  minute: number,
  minutes: number,
  plannedId?: string
): WorkspaceAction[] => [
  {
    type: "timer-start",
    id,
    kind: "focus",
    taskId,
    plannedId,
    minutes,
    now: local(hour, minute).getTime(),
    at: iso(hour, minute),
  },
  {
    type: "timer-finish",
    now: local(hour, minute).getTime() + minutes * 60_000,
  },
  { type: "timer-acknowledge" },
]

/** Test 8: a 25-minute focus, 12 minutes after a block's planned start. */
const lateStart = () =>
  run([task("a"), block("p", "a", "10:00", 25), ...focus("f", "a", 10, 12, 25, "p")])

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/calendar"
})

describe("the log", () => {
  it("records each kind of thing with its real times", () => {
    const state = run([
      task("a"),
      block("p", "a", "10:00"),
      {
        type: "timer-start",
        id: "f",
        kind: "focus",
        taskId: "a",
        plannedId: "p",
        minutes: 25,
        now: local(10, 5).getTime(),
        at: iso(10, 5),
      },
      { type: "timer-pause", now: local(10, 10).getTime() },
      { type: "timer-resume", now: local(10, 12).getTime() },
      { type: "timer-finish", now: local(10, 40).getTime() },
      { type: "set-status", id: "a", at: iso(11), status: "completed" },
    ])
    expect(state.activity.map((entry) => entry.type)).toEqual([
      "task_created",
      "block_planned",
      "focus_started",
      "task_first_started",
      "focus_paused",
      "focus_resumed",
      "occurrence_outcome",
      "focus_ended",
      "task_completed",
    ])
    expect(state.activity[2]).toMatchObject({
      at: iso(10, 5),
      plannedAt: iso(10),
    })
  })

  it("only ever adds, even when something is undone or removed", () => {
    const before = run([task("a"), block("p", "a", "10:00")])
    const after = run(
      [
        { type: "remove-planned", at: iso(9), id: "p" },
        { type: "delete-task", id: "a", at: iso(9) } as WorkspaceAction,
      ],
      before
    )
    expect(after.activity.slice(0, before.activity.length)).toEqual(
      before.activity
    )
    expect(after.activity.at(-1)?.type).toBe("block_removed")
  })

  it("logs an outcome, and a later change wins without rewriting it", () => {
    const state = run([
      {
        type: "add-event",
        event: eventOf({
          id: "r",
          title: "Gym",
          date: TODAY,
          repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
        }),
      },
      { type: "occurrence-outcome", id: "r", key: TODAY, outcome: "full" },
      { type: "occurrence-outcome", id: "r", key: TODAY, outcome: "minimum" },
    ])
    expect(
      state.activity.filter((entry) => entry.type === "occurrence_outcome")
    ).toHaveLength(2)
    expect(overviewOf(state.activity, today).routines).toEqual([
      { series: "r", title: "Gym", full: 0, minimum: 1, skipped: 0 },
    ])
  })

  it("logs a stuck reason, moving into a buffer, and a missed deadline", () => {
    const state = run([
      {
        type: "create-task",
        id: "a",
        at: iso(8),
        title: "a",
        deadline: addDays(TODAY, -1),
      },
      { type: "mark-opened", at: iso(9) },
      { type: "mark-opened", at: iso(10) },
      block("p", "a", "09:00"),
      { type: "add-event", event: newBuffer("b", TODAY, "15:00", 30) },
      { type: "move-planned", at: iso(9), id: "p", date: TODAY, time: "15:00" },
      { type: "enter-recovery", at: iso(9), taskId: "a", source: "avoidance" },
      { type: "recovery-reason", reason: "worried" },
    ])
    const types = state.activity.map((entry) => entry.type)
    expect(types.filter((type) => type === "deadline_missed")).toHaveLength(1)
    expect(types).toContain("moved_to_buffer")
    const stats = overviewOf(state.activity, today)
    expect(stats.buffers).toEqual({ used: 1, created: 1 })
    expect(stats.stuck).toHaveLength(1)
  })

  it("starts from what's on record when the log doesn't exist yet", () => {
    const saved: Partial<Workspace> = { ...lateStart() }
    delete saved.activity
    const restored = restoreWorkspace(saved)
    expect(focusByDay(restored.activity).get(TODAY)).toBe(25)
    // A start delay was never recorded for it, so none is made up.
    expect(overviewOf(restored.activity, today).startDelay).toBeNull()
    expect(trackingSince(restored.activity)).toBe(TODAY)
    expect(seedActivity({ events: [], tasks: [], focusSessions: [] })).toEqual([])
  })

  it("keeps a damaged entry apart, rather than losing it", () => {
    const restored = restoreWorkspace({
      version: 3,
      activity: [{ nope: true }, { at: iso(9), type: "task_created", taskId: "a" }],
    })
    expect(restored.activity).toHaveLength(1)
    expect(restored.unmigrated).toEqual([
      { source: "activity", record: { nope: true } },
    ])
  })
})

describe("the numbers", () => {
  it("Test 8: 25 minutes of focus and a 12-minute start delay", () => {
    const stats = overviewOf(lateStart().activity, today)
    expect(stats.focusMinutes).toBe(25)
    expect(stats.startDelay).toEqual({ median: 12, within10: 0, count: 1 })
    expect(stats.doneMinutes).toBe(25)
    expect(stats.plannedMinutes).toBe(25)
  })

  it("Test 9: shown twice and restarted once is 50%", () => {
    const state = run([
      task("a"),
      task("b"),
      { type: "enter-recovery", at: iso(9), taskId: "a", source: "avoidance" },
      { type: "exit-recovery" },
      { type: "enter-recovery", at: iso(10), taskId: "b", source: "avoidance" },
      {
        type: "timer-start",
        id: "f",
        kind: "focus",
        taskId: "b",
        restart: true,
        minutes: 5,
        now: local(10, 5).getTime(),
        at: iso(10, 5),
      },
    ])
    const stats = overviewOf(state.activity, today)
    expect(stats.recovery).toEqual({ shown: 2, acted: 1 })
    expect(stats.comebacks).toBe(1)
  })

  it("takes the median, with an even count in the middle", () => {
    expect(median([])).toBeNull()
    expect(median([9, 1, 5])).toBe(5)
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })

  it("only counts a block's first start as its delay", () => {
    const state = run(
      [...focus("g", "a", 11, 0, 25, "p")],
      lateStart()
    )
    expect(overviewOf(state.activity, today).startDelay?.count).toBe(1)
  })

  it("leaves buffers out of planned time", () => {
    const state = run([
      { type: "add-event", event: newBuffer("b", TODAY, "15:00", 30) },
    ])
    expect(overviewOf(state.activity, today).plannedMinutes).toBe(0)
  })

  it("expands a routine across the days it falls on", () => {
    const from = "2026-11-09"
    const state = run([
      {
        type: "add-event",
        event: eventOf({
          id: "r",
          date: from,
          start: "07:00",
          end: "07:30",
          repeat: { days: [1, 2, 3, 4, 5] },
        }),
      },
    ])
    expect(
      plannedByDay(state.activity, { from, until: addDays(from, 7) }).size
    ).toBe(5)
  })

  it("keeps what was planned before a block was removed, but not after", () => {
    const yesterday = addDays(TODAY, -1)
    const state = run([
      {
        type: "add-event",
        event: eventOf({
          id: "r",
          date: yesterday,
          start: "07:00",
          end: "07:30",
          repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
        }),
      },
      { type: "delete-event", id: "r", key: TODAY, scope: "all" },
    ])
    const days = plannedByDay(state.activity, {
      from: yesterday,
      until: addDays(TODAY, 2),
    })
    expect([...days.keys()]).toEqual([yesterday])
  })

  it("compares with the period just before, of the same length", () => {
    const week = { from: "2026-11-08", until: "2026-11-15" }
    expect(previousPeriod("week", week)).toEqual({
      from: "2026-11-01",
      until: "2026-11-08",
    })
    expect(
      previousPeriod("month", { from: "2026-01-01", until: "2026-02-01" })
    ).toEqual({ from: "2025-12-01", until: "2026-01-01" })
    expect(
      previousPeriod("year", { from: "2026-01-01", until: "2027-01-01" })
    ).toEqual({ from: "2025-01-01", until: "2026-01-01" })
  })
})

describe("the strip", () => {
  const show = (type: string, from: string, until: string) =>
    props().datesSet({
      start: new Date(`${from}T00:00:00`),
      end: new Date(`${until}T00:00:00`),
      view: { type },
    })

  it("Test 8: shows both figures for the day, and the Week bars update", async () => {
    seed(lateStart())
    render(<WorkspaceApp />)
    const panel = await screen.findByRole("region", { name: "Overview" })
    expect(within(panel).getByText("Focus time").nextSibling).toHaveTextContent(
      "25 min"
    )
    expect(
      within(panel).getByText("Start delay").nextSibling
    ).toHaveTextContent("12 min")
    expect(screen.queryByTestId("week-bar")).toBeNull()
    const sunday = addDays(TODAY, -new Date(`${TODAY}T12:00:00`).getDay())
    show("timeGridWeek", sunday, addDays(sunday, 7))
    await waitFor(() => expect(screen.getAllByTestId("week-bar")).toHaveLength(7))
    const bar = screen
      .getAllByTestId("week-bar")
      .find((item) => /25 min focus/.test(item.getAttribute("aria-label")!))
    expect(bar?.getAttribute("aria-label")).toContain("25 min planned")
  })

  it("Test 10: a range with no data shows a dash and why, with no zeros", async () => {
    seed(lateStart())
    render(<WorkspaceApp />)
    await screen.findByRole("region", { name: "Overview" })
    show("timeGridDay", "2020-01-01", "2020-01-02")
    await screen.findByText("No focus sessions this day yet.")
    const panel = screen.getByRole("region", { name: "Overview" })
    expect(within(panel).getByText("Focus time").nextSibling).toHaveTextContent(
      "—"
    )
    expect(within(panel).queryByText(/^0/)).toBeNull()
    expect(within(panel).getByText(/Tracking since/)).toBeTruthy()
  })

  it("holds back charts under 3 data points in Month and Year", async () => {
    seed(lateStart())
    render(<WorkspaceApp />)
    await screen.findByRole("region", { name: "Overview" })
    show("dayGridMonth", TODAY.slice(0, 8) + "01", addDays(TODAY, 1))
    await screen.findByText(/heatmap needs focus on at least 3 days/)
    expect(screen.getByText(/Best hours need at least 3 starts/)).toBeTruthy()
    expect(screen.queryByTestId("month-heat")).toBeNull()
  })

  it("draws the month heatmap and best hours once there's enough", async () => {
    const days = [0, -1, -2].map((back) => addDays(TODAY, back))
    const state = run(
      days.flatMap((date, index) => {
        const at = new Date(`${date}T09:00:00`).getTime()
        return [
          {
            type: "timer-start",
            id: `f${index}`,
            kind: "focus",
            taskId: "a",
            minutes: 25,
            now: at,
            at: new Date(at).toISOString(),
          },
          { type: "timer-finish", now: at + 25 * 60_000 },
          { type: "timer-acknowledge" },
        ] as WorkspaceAction[]
      }),
      run([task("a")])
    )
    seed(state)
    render(<WorkspaceApp />)
    await screen.findByRole("region", { name: "Overview" })
    show("multiMonthYear", `${TODAY.slice(0, 4)}-01-01`, `${Number(TODAY.slice(0, 4)) + 1}-01-01`)
    expect(await screen.findByTestId("year-heat")).toBeTruthy()
    expect(screen.getByTestId("best-hours")).toBeTruthy()
  })

  it("collapses, and stays that way through a reload", async () => {
    seed(lateStart())
    const user = userEvent.setup()
    const { unmount } = render(<WorkspaceApp />)
    const toggle = await screen.findByRole("button", { name: "Overview" })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    await user.click(toggle)
    expect(screen.queryByText("Focus time")).toBeNull()
    unmount()
    render(<WorkspaceApp />)
    expect(
      await screen.findByRole("button", { name: "Overview" })
    ).toHaveAttribute("aria-expanded", "false")
  })
})

describe("the words", () => {
  it("never says procrastination anywhere the user can read", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : entry.name.endsWith(".tsx")
            ? [join(dir, entry.name)]
            : []
      )
    for (const file of walk("components")) {
      expect(readFileSync(file, "utf8").toLowerCase()).not.toContain(
        "procrastinat"
      )
    }
  })
})
