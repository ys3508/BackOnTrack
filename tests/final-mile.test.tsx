// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildIcs } from "@/lib/calendar/ics"
import { dueReminders, reminderKey } from "@/lib/today/reminders"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { exportWorkspace, restoreWorkspace } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Grid</div> }))
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
const AT = "2020-01-05T12:00:00.000Z"
const TODAY = localToday()
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })
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
const pad = (n: number) => String(n).padStart(2, "0")
const clock = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000)

const blockAt = (when: Date, id = "p") =>
  [
    {
      type: "add-planned",
      at: AT,
      session: {
        id,
        taskId: "a",
        date: localToday(when),
        time: clock(when),
        minutes: 25,
        label: "",
        done: false,
      },
    },
  ] as WorkspaceAction[]
const withTask = (extra: WorkspaceAction[] = []) =>
  run([{ type: "create-task", id: "a", at: AT, title: "Essay" }, ...extra])
const on: WorkspaceAction = {
  type: "settings",
  patch: { remindersEnabled: true },
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("which blocks are due a reminder", () => {
  const now = new Date(`${TODAY}T10:00:00`).getTime()
  const block = (time: string, patch = {}) =>
    ({
      type: "add-planned",
      at: AT,
      session: {
        id: "p",
        taskId: "a",
        date: TODAY,
        time,
        minutes: 25,
        label: "",
        done: false,
        ...patch,
      },
    }) as WorkspaceAction

  it("is nothing while reminders are off", () => {
    expect(dueReminders(withTask([block("10:04")]), now)).toEqual([])
  })

  it("is a block about five minutes away, and not one further off or begun", () => {
    expect(dueReminders(withTask([on, block("10:04")]), now)).toHaveLength(1)
    expect(dueReminders(withTask([on, block("10:05")]), now)).toHaveLength(1)
    expect(dueReminders(withTask([on, block("10:06")]), now)).toEqual([])
    expect(dueReminders(withTask([on, block("09:59")]), now)).toEqual([])
  })

  it("reminds once, and again if the block moves", () => {
    const state = withTask([on, block("10:04")])
    const key = reminderKey(state.planned[0])
    const reminded = run([{ type: "mark-reminded", key }], state)
    expect(dueReminders(reminded, now)).toEqual([])
    const moved = run(
      [{ type: "move-planned", at: AT, id: "p", date: TODAY, time: "10:03" }],
      reminded
    )
    expect(dueReminders(moved, now)).toHaveLength(1)
  })

  it("skips what's done, answered, untimed, paused, finished, or already running", () => {
    expect(
      dueReminders(withTask([on, block("10:04", { done: true })]), now)
    ).toEqual([])
    expect(
      dueReminders(withTask([on, block("10:04", { outcome: "didnt" })]), now)
    ).toEqual([])
    expect(
      dueReminders(withTask([on, block("10:04", { time: null })]), now)
    ).toEqual([])
    expect(
      dueReminders(
        withTask([
          on,
          block("10:04"),
          { type: "set-status", id: "a", at: AT, status: "paused" },
        ]),
        now
      )
    ).toEqual([])
    expect(
      dueReminders(
        withTask([
          on,
          block("10:04"),
          { type: "set-status", id: "a", at: AT, status: "completed" },
        ]),
        now
      )
    ).toEqual([])
    expect(
      dueReminders(
        withTask([
          on,
          block("10:04"),
          {
            type: "timer-start",
            id: "t",
            kind: "focus",
            taskId: "a",
            minutes: 5,
            now,
            at: AT,
          },
        ]),
        now
      )
    ).toEqual([])
  })
})

describe("reminders in the app", () => {
  it("explains itself before asking for permission, and asks only when turned on", async () => {
    const requestPermission = vi.fn(async () => "granted")
    vi.stubGlobal(
      "Notification",
      Object.assign(vi.fn(), { permission: "default", requestPermission })
    )
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    expect(
      await screen.findByText(/only work while BackOnTrack is open/)
    ).toBeTruthy()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(screen.getByText(/aren’t push notifications/)).toBeTruthy()
    await user.click(await button("Turn on reminders"))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(saved().settings.remindersEnabled).toBe(true)
    await user.click(await button("Turn off reminders"))
    expect(saved().settings.remindersEnabled).toBe(false)
  })

  it("never asks on its own, just from opening the app", async () => {
    const requestPermission = vi.fn(async () => "granted")
    vi.stubGlobal(
      "Notification",
      Object.assign(vi.fn(), { permission: "default", requestPermission })
    )
    seed(withTask(blockAt(inMinutes(3))))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Go to Today" })).toBeNull()
  })

  it("still reminds on screen if notifications are refused, once only", async () => {
    vi.stubGlobal(
      "Notification",
      Object.assign(vi.fn(), { permission: "denied" })
    )
    seed(withTask([on, ...blockAt(inMinutes(3))]))
    render(<WorkspaceApp />)
    expect(await button("Go to Today")).toBeTruthy()
    expect(saved().remindedBlocks).toHaveLength(1)
    cleanup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(screen.queryByRole("button", { name: "Go to Today" })).toBeNull()
    expect(saved().remindedBlocks).toHaveLength(1)
  })

  it("sends a browser notification when allowed, which opens Today", async () => {
    const created: { onclick: null | (() => void); close: () => void }[] = []
    class FakeNotification {
      static permission = "granted"
      onclick: null | (() => void) = null
      close = vi.fn()
      constructor(
        public title: string,
        public options: { body: string }
      ) {
        created.push(this)
      }
    }
    vi.stubGlobal("Notification", FakeNotification)
    window.focus = vi.fn()
    seed(withTask([on, ...blockAt(inMinutes(3))]))
    window.location.hash = "#/settings"
    render(<WorkspaceApp />)
    await waitFor(() => expect(created).toHaveLength(1))
    act(() => created[0].onclick?.())
    await waitFor(() => expect(window.location.hash).toBe("#/"))
  })
})

describe("the storage notice", () => {
  it("appears once, and stays dismissed through a reload", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    expect(await screen.findByText(/saved in this browser only/)).toBeTruthy()
    await user.click(await button("Got it"))
    expect(screen.queryByText(/saved in this browser only/)).toBeNull()
    cleanup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(screen.queryByText(/saved in this browser only/)).toBeNull()
  })
})

describe("Live AI and Demo", () => {
  it("is in Settings, not the header", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(screen.queryByRole("group", { name: /Response source/ })).toBeNull()
    await user.click(await button("Settings"))
    const group = await screen.findByRole("group", { name: /Response source/ })
    expect(group).toBeTruthy()
    expect(await screen.findByText(/not AI, and sends nothing/)).toBeTruthy()
    expect(screen.getByText(/all work without AI/)).toBeTruthy()
  })
})

describe("calendar export", () => {
  const start = addDays(TODAY, 1)
  const state = () =>
    run([
      {
        type: "create-task",
        id: "a",
        at: AT,
        title: "Essay, part; two",
        deadline: addDays(TODAY, 3),
      },
      {
        type: "create-task",
        id: "old",
        at: AT,
        title: "Old",
        deadline: "2020-01-01",
      },
      {
        type: "create-task",
        id: "done",
        at: AT,
        title: "Finished",
        deadline: addDays(TODAY, 3),
      },
      { type: "set-status", id: "done", at: AT, status: "completed" },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "t",
          taskId: "a",
          date: start,
          time: "09:30",
          minutes: 45,
          label: "",
          done: false,
        },
      },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "w",
          taskId: "a",
          date: start,
          time: null,
          window: "evening",
          minutes: 25,
          label: "",
          done: false,
        },
      },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "past",
          taskId: "a",
          date: "2020-01-02",
          time: "09:00",
          minutes: 25,
          label: "",
          done: false,
        },
      },
    ])
  const ics = () => buildIcs(state(), TODAY, new Date("2026-01-01T00:00:00Z"))
  const unfolded = () => ics().replace(/\r\n /g, "")

  it("is a well-formed calendar, with CRLF line endings", () => {
    const text = ics()
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true)
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/)
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(
      text.match(/END:VEVENT/g)!.length
    )
  })

  it("has a timed block with the right start and end", () => {
    const begin = new Date(`${start}T09:30:00`)
    const end = new Date(begin.getTime() + 45 * 60_000)
    const iso = (date: Date) =>
      `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`
    expect(unfolded()).toContain(`UID:planned-t@backontrack`)
    expect(unfolded()).toContain(`DTSTART:${iso(begin)}`)
    expect(unfolded()).toContain(`DTEND:${iso(end)}`)
  })

  it("makes untimed blocks and deadlines all-day, with an exclusive end", () => {
    expect(unfolded()).toContain("SUMMARY:Essay\\, part\; two (Evening)")
    expect(unfolded()).toContain(
      `DTSTART;VALUE=DATE:${start.replaceAll("-", "")}`
    )
    const due = addDays(TODAY, 3)
    expect(unfolded()).toContain("SUMMARY:Due: Essay\\, part\; two")
    expect(unfolded()).toContain(
      `DTSTART;VALUE=DATE:${due.replaceAll("-", "")}`
    )
    expect(unfolded()).toContain(
      `DTEND;VALUE=DATE:${addDays(due, 1).replaceAll("-", "")}`
    )
  })

  it("leaves out what's past or finished", () => {
    expect(unfolded()).not.toContain("planned-past")
    expect(unfolded()).not.toContain("deadline-old")
    expect(unfolded()).not.toContain("deadline-done")
  })

  it("folds long lines at 75 bytes, even with emoji", () => {
    const long = run([
      {
        type: "create-task",
        id: "l",
        at: AT,
        title: "🏋️ ".repeat(60),
        deadline: addDays(TODAY, 1),
      },
    ])
    const text = buildIcs(long, TODAY)
    const encoder = new TextEncoder()
    for (const line of text.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(text.replace(/\r\n /g, "")).toContain("🏋️ 🏋️")
  })

  it("is offered from Settings and the Calendar, and changes nothing", async () => {
    const create = vi.fn(() => "blob:x")
    URL.createObjectURL = create
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    seed(state())
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const before = saved().tasks
    await user.click(await button("Export calendar (.ics)"))
    expect(click).toHaveBeenCalledTimes(1)
    await user.click(await button("Calendar"))
    await user.click(await button("Export .ics"))
    expect(click).toHaveBeenCalledTimes(2)
    expect(saved().tasks).toEqual(before)
    click.mockRestore()
  })
})

describe("everything travels together", () => {
  it("keeps all of it through export and restore", () => {
    const state = run(
      [
        { type: "edit-task", id: "a", at: AT, patch: { resumeNote: "Here" } },
        { type: "park-thought", id: "x", at: AT, text: "Later", taskId: "a" },
        { type: "mark-reminded", key: "k" },
        {
          type: "enter-recovery",
          at: AT,
          taskId: "a",
          source: "avoidance",
        },
      ],
      withTask()
    )
    const restored = restoreWorkspace(JSON.parse(exportWorkspace(state)))
    expect(restored.tasks[0].resumeNote).toBe("Here")
    expect(restored.parkingLot).toHaveLength(1)
    expect(restored.remindedBlocks).toEqual(["k"])
    expect(restored.recovery?.taskId).toBe("a")
    expect(restored.progressEvents.length).toBeGreaterThan(0)
  })
})
