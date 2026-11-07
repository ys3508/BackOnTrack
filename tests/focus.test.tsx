// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import {
  elapsedMs,
  finishTime,
  formatClock,
  isTimerFinished,
  remainingSeconds,
} from "@/lib/focus/timer"
import { workspaceReducer } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { TimerState, Workspace } from "@/lib/workspace/schemas"

const STORAGE = "backontrack.workspace.v1"
const T0 = Date.UTC(2026, 10, 5, 12, 0, 0)
const MIN = 60_000

const timerFor = (extra: Partial<TimerState> = {}): TimerState => ({
  id: "s",
  kind: "focus",
  taskId: "a",
  subtaskId: null,
  plannedSeconds: 300,
  startedAt: new Date(T0).toISOString(),
  runningSince: T0,
  accumulatedMs: 0,
  plannedId: null,
  ...extra,
})

const withTask = (): Workspace =>
  workspaceReducer(EMPTY_WORKSPACE, {
    type: "create-task",
    id: "a",
    at: new Date(T0).toISOString(),
    title: "Essay",
  })

const start = (state: Workspace, minutes = 5, now = T0) =>
  workspaceReducer(state, {
    type: "timer-start",
    id: "s",
    kind: "focus",
    taskId: "a",
    minutes,
    now,
    at: new Date(now).toISOString(),
  })

describe("wall-clock timer", () => {
  it("computes the time from timestamps, however rarely it's checked", () => {
    const timer = timerFor()
    expect(remainingSeconds(timer, T0)).toBe(300)
    expect(remainingSeconds(timer, T0 + 4 * MIN)).toBe(60)
    expect(isTimerFinished(timer, T0 + 5 * MIN)).toBe(true)
    expect(remainingSeconds(timer, T0 + 3 * 3600 * 1000)).toBe(0)
  })

  it("doesn't count paused time", () => {
    let state = start(withTask())
    state = workspaceReducer(state, { type: "timer-pause", now: T0 + MIN })
    expect(remainingSeconds(state.timer!, T0 + 30 * MIN)).toBe(240)
    state = workspaceReducer(state, {
      type: "timer-resume",
      now: T0 + 30 * MIN,
    })
    expect(remainingSeconds(state.timer!, T0 + 31 * MIN)).toBe(180)
    expect(elapsedMs(state.timer!, T0 + 31 * MIN)).toBe(2 * MIN)
  })

  it("resets to the full time, paused, without recording anything", () => {
    let state = start(withTask())
    state = workspaceReducer(state, { type: "timer-reset" })
    expect(state.timer?.runningSince).toBeNull()
    expect(remainingSeconds(state.timer!, T0 + 99 * MIN)).toBe(300)
    expect(state.focusSessions).toEqual([])
  })

  it("records when it really ended, even if noticed hours later", () => {
    expect(finishTime(timerFor(), T0 + 180 * MIN)).toBe(T0 + 5 * MIN)
    let state = start(withTask())
    state = workspaceReducer(state, {
      type: "timer-finish",
      now: T0 + 180 * MIN,
    })
    expect(state.focusSessions[0].endedAt).toBe(
      new Date(T0 + 5 * MIN).toISOString()
    )
    expect(state.focusSessions[0].actualSeconds).toBe(300)
  })

  it("formats the clock", () => {
    expect(formatClock(1500)).toBe("25:00")
    expect(formatClock(65)).toBe("01:05")
  })
})

describe("focus sessions and tasks", () => {
  it("moves a task to In Progress, but never completes it", () => {
    let state = start(withTask())
    expect(state.tasks[0].status).toBe("in-progress")
    state = workspaceReducer(state, { type: "timer-finish", now: T0 + 5 * MIN })
    expect(state.tasks[0].status).toBe("in-progress")
    expect(state.tasks[0].completedAt).toBeNull()
    expect(state.timer).toBeNull()
    expect(state.finishedSessionId).toBe("s")
    expect(state.tasks[0].history.at(-1)?.text).toBe(
      "Focus session finished (5 min)"
    )
  })

  it("won't replace a session that's already running", () => {
    const state = start(withTask(), 25)
    const again = workspaceReducer(state, {
      type: "timer-start",
      id: "other",
      kind: "focus",
      taskId: null,
      minutes: 5,
      now: T0 + MIN,
      at: "x",
    })
    expect(again.timer?.id).toBe("s")
  })

  it("records an early stop to continue later, without changing the status", () => {
    const state = workspaceReducer(start(withTask()), {
      type: "timer-stop",
      now: T0 + 2 * MIN,
      at: new Date(T0 + 2 * MIN).toISOString(),
      outcome: "continue-later",
      note: "",
    })
    expect(state.focusSessions[0]).toMatchObject({
      outcome: "continue-later",
      actualSeconds: 120,
    })
    expect(state.tasks[0].status).toBe("in-progress")
    expect(state.finishedSessionId).toBeNull()
  })

  it("records getting stuck, with the reason, and flags the task for recovery", () => {
    const state = workspaceReducer(start(withTask()), {
      type: "timer-stop",
      now: T0 + MIN,
      at: new Date(T0 + MIN).toISOString(),
      outcome: "stuck",
      note: "I can't find the prompt",
    })
    expect(state.tasks[0].status).toBe("needs-recovery")
    const text = state.tasks[0].history.map((event) => event.text)
    expect(text).toContain("Stopped focus after 1 min: got stuck")
    expect(text).toContain("I can't find the prompt")
  })

  it("doesn't save breaks as focus sessions", () => {
    let state = workspaceReducer(withTask(), {
      type: "timer-start",
      id: "b",
      kind: "break",
      taskId: null,
      minutes: 5,
      now: T0,
      at: "x",
    })
    state = workspaceReducer(state, { type: "timer-finish", now: T0 + 5 * MIN })
    expect(state.focusSessions).toEqual([])
    expect(state.timer).toBeNull()
  })
})

describe("focus screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      shouldAdvanceTime: false,
      toFake: ["Date", "setInterval", "clearInterval"],
    })
    vi.setSystemTime(T0)
    window.localStorage.clear()
    window.location.hash = "#/focus"
    window.scrollTo = vi.fn() as typeof window.scrollTo
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ live: false, model: null }))
    )
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...withTask(), legacyMigrated: true })
    )
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
  const click = (name: RegExp | string) =>
    fireEvent.click(screen.getByRole("button", { name }))
  const advance = async (ms: number) => {
    vi.setSystemTime(Date.now() + ms)
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
  }

  it("offers the three lengths, with a task preselected", async () => {
    render(<WorkspaceApp />)
    expect(screen.getByLabelText("What are you working on?")).toHaveValue("a")
    for (const name of [
      "5-minute Quick Start",
      "10-minute Focus",
      "25-minute Focus",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
  })

  it("stays accurate when a background tab skips every tick", async () => {
    render(<WorkspaceApp />)
    click("10-minute Focus")
    expect(screen.getByRole("timer")).toHaveTextContent("10:00")
    // No interval runs here at all: the clock jumps, as it does in a throttled tab.
    await advance(7 * MIN)
    expect(screen.getByRole("timer")).toHaveTextContent("03:00")
  })

  it("pauses and resumes", async () => {
    render(<WorkspaceApp />)
    click("5-minute Quick Start")
    await advance(MIN)
    // The task page behind the room has a status button with the same name.
    const room = () => within(screen.getByRole("timer").closest("section")!)
    fireEvent.click(room().getByRole("button", { name: "Pause" }))
    await advance(10 * MIN)
    expect(screen.getByRole("timer")).toHaveTextContent("04:00")
    fireEvent.click(room().getByRole("button", { name: "Resume" }))
    await advance(MIN)
    expect(screen.getByRole("timer")).toHaveTextContent("03:00")
  })

  it("opens in the room, and steps out to the work with the timer unchanged", async () => {
    render(<WorkspaceApp />)
    click("5-minute Quick Start")
    await advance(MIN)
    const hash = window.location.hash
    expect(document.documentElement.dataset.focusing).toBe("true")
    click("Leave Focus")
    expect(document.documentElement.dataset.focusing).toBeUndefined()
    expect(window.location.hash).toBe(hash)
    expect(screen.getAllByRole("timer")).toHaveLength(1)
    click("Pause timer")
    await advance(MIN)
    expect(screen.getByRole("timer")).toHaveTextContent("04:00")
    click("Enter Focus Mode")
    expect(document.documentElement.dataset.focusing).toBe("true")
    expect(screen.getAllByRole("timer")).toHaveLength(1)
  })

  it("reopens the room from the timer pill, without changing screen", async () => {
    render(<WorkspaceApp />)
    click("5-minute Quick Start")
    await advance(MIN)
    click("Leave Focus")
    click("Routines")
    click(/Open focus timer/)
    expect(window.location.hash).toBe("#/routines")
    expect(document.documentElement.dataset.focusing).toBe("true")
    expect(screen.getAllByRole("timer")).toHaveLength(1)
  })

  it("finishes, saves the session, and leaves the task open with a break offered", async () => {
    render(<WorkspaceApp />)
    click("5-minute Quick Start")
    await advance(5 * MIN + 1000)
    expect(
      screen.getByRole("heading", { name: /5 min of focus, done/ })
    ).toBeInTheDocument()
    expect(saved().tasks[0].status).toBe("in-progress")
    expect(saved().focusSessions).toHaveLength(1)
    expect(
      screen.getByLabelText("Where should you start next time?")
    ).toBeInTheDocument()
    click("I started / made progress")
    expect(saved().focusSessions[0].progressReport).toBe("yes")
    expect(saved().focusSessions[0].endOutcome).toBe("progress")
    expect(saved().tasks[0].progress).toBe(10)
    expect(
      screen.getByRole("button", { name: /5-minute break/ })
    ).toBeInTheDocument()

    click(/5-minute break/)
    expect(screen.getByText("Break")).toBeInTheDocument()
    expect(saved().focusSessions).toHaveLength(1)
  })

  it("restores a running timer after a reload, and catches up on time passed", async () => {
    const { unmount } = render(<WorkspaceApp />)
    click("25-minute Focus")
    await advance(5 * MIN)
    unmount()
    vi.setSystemTime(Date.now() + 5 * MIN)
    render(<WorkspaceApp />)
    expect(screen.getByRole("timer")).toHaveTextContent("15:00")
  })

  it("finishes a timer that ran out while the page was closed", async () => {
    const { unmount } = render(<WorkspaceApp />)
    click("5-minute Quick Start")
    unmount()
    vi.setSystemTime(Date.now() + 60 * MIN)
    render(<WorkspaceApp />)
    await act(async () => {})
    expect(saved().timer).toBeNull()
    expect(saved().focusSessions[0].outcome).toBe("completed")
    expect(
      screen.getByRole("heading", { name: /of focus, done/ })
    ).toBeInTheDocument()
  })

  it("asks what came of it, or if you got stuck, when stopping early", async () => {
    render(<WorkspaceApp />)
    click("5-minute Quick Start")
    await advance(2 * MIN)
    click("Stop")
    click("I got stuck")
    fireEvent.change(screen.getByLabelText(/What got in the way/), {
      target: { value: "Too noisy" },
    })
    click("Back")
    click("I started / made progress")
    expect(saved().focusSessions[0]).toMatchObject({
      outcome: "continue-later",
      actualSeconds: 120,
    })
    expect(saved().tasks[0].status).toBe("in-progress")
    expect(screen.getByText(/Will continue later/)).toBeInTheDocument()
  })

  it("resets without saving a session", async () => {
    render(<WorkspaceApp />)
    click("5-minute Quick Start")
    await advance(2 * MIN)
    click("Reset")
    expect(screen.getByRole("timer")).toHaveTextContent("05:00")
    expect(saved().focusSessions).toEqual([])
  })
})
