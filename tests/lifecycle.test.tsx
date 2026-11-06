// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { safeLink } from "@/components/workspace/parts"
import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Task, Workspace } from "@/lib/workspace/schemas"
import {
  nextActionFor,
  recentActions,
  startCue,
} from "@/lib/workspace/selectors"
import { restoreWorkspace } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Timeline</div> }))
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
const withTask = (patch: Partial<Task> = {}) =>
  run([
    { type: "create-task", id: "a", at: AT, title: "Essay" },
    { type: "edit-task", id: "a", at: AT, patch },
  ])
const eventTypes = () =>
  saved().progressEvents.map((item: { type: string }) => item.type)
const nowCard = () => screen.getByRole("region", { name: "Now" })

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("where to begin", () => {
  const base = withTask().tasks[0]

  it("prefers the resume note, then the current step, then the first step", () => {
    expect(startCue(base)).toBeNull()
    const first = { ...base, firstStep: "Open the doc" }
    expect(startCue(first)).toEqual({ text: "Open the doc", source: "first" })
    const step = { ...first, nextAction: "Write the title" }
    expect(startCue(step)?.source).toBe("step")
    const resume = { ...step, resumeNote: "From paragraph two" }
    expect(startCue(resume)).toEqual({
      text: "From paragraph two",
      source: "resume",
    })
    expect(nextActionFor(resume)).toBe("From paragraph two")
  })

  it("loads older tasks, which have none of these fields", () => {
    const raw = JSON.parse(JSON.stringify(withTask()))
    for (const key of ["firstStep", "resumeNote", "link", "minimumVersion"]) {
      delete raw.tasks[0][key]
    }
    delete raw.progressEvents
    const restored = restoreWorkspace(raw)
    expect(restored.tasks[0]).toMatchObject({
      firstStep: "",
      resumeNote: "",
      link: "",
      minimumVersion: "",
    })
    expect(restored.progressEvents).toEqual([])
  })

  it("shows the first step when the task becomes active", async () => {
    seed(withTask({ firstStep: "Open the doc" }))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    expect(await within(nowCard()).findByText("Open the doc")).toBeTruthy()
    await user.click(await button("Start"))
    expect(await within(nowCard()).findByText("Open the doc")).toBeTruthy()
    expect(within(nowCard()).getByRole("timer")).toBeTruthy()
  })

  it("shows a resume note above all else, prominently", async () => {
    seed(
      withTask({ firstStep: "Open the doc", resumeNote: "From paragraph two" })
    )
    render(<WorkspaceApp />)
    expect(await within(nowCard()).findByText("Pick up here")).toBeTruthy()
    expect(within(nowCard()).getByText("From paragraph two")).toBeTruthy()
    expect(within(nowCard()).queryByText("Open the doc")).toBeNull()
  })

  it("edits the note where it lives, leaving the first step alone", async () => {
    seed(
      withTask({ firstStep: "Open the doc", resumeNote: "From paragraph two" })
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Edit this step"))
    const input = await screen.findByLabelText("Pick up here")
    await user.clear(input)
    await user.type(input, "From paragraph three{Enter}")
    expect(saved().tasks[0]).toMatchObject({
      resumeNote: "From paragraph three",
      firstStep: "Open the doc",
    })
  })

  it("edits a first step from the task page, and keeps it through a reload", async () => {
    seed(withTask())
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(
      await screen.findByLabelText("What will you do first? (optional)"),
      "Open it"
    )
    await user.type(
      screen.getByLabelText("Minimum version (optional)"),
      "One line"
    )
    expect(saved().tasks[0]).toMatchObject({
      firstStep: "Open it",
      minimumVersion: "One line",
    })
    cleanup()
    render(<WorkspaceApp />)
    expect(
      await screen.findByLabelText("What will you do first? (optional)")
    ).toHaveValue("Open it")
  })
})

describe("links", () => {
  it("accepts web addresses only", () => {
    expect(safeLink("docs.google.com/x")).toBe("https://docs.google.com/x")
    expect(safeLink("http://example.com/")).toBe("http://example.com/")
    expect(safeLink("javascript:alert(1)")).toBeNull()
    expect(safeLink("data:text/html,hi")).toBeNull()
    expect(safeLink("")).toBeNull()
  })

  it("offers the link when starting, and during the session", async () => {
    seed(withTask({ link: "example.com/doc" }))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const before = await screen.findByRole("link", { name: "Open link" })
    expect(before).toHaveAttribute("href", "https://example.com/doc")
    expect(before).toHaveAttribute("rel", "noopener noreferrer")
    await user.click(await button("Start"))
    expect(await screen.findByRole("link", { name: "Open link" })).toBeTruthy()
  })

  it("never renders a script as a link", async () => {
    seed(withTask({ link: "javascript:alert(1)" }))
    render(<WorkspaceApp />)
    await button("Start")
    expect(screen.queryByRole("link", { name: "Open link" })).toBeNull()
  })
})

describe("ending a session", () => {
  const start = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    await user.click(await button("End session"))
  }

  it("stops the clock while asking, and Keep going picks it back up", async () => {
    seed(withTask())
    const user = userEvent.setup()
    await start(user)
    expect(saved().timer.runningSince).toBeNull()
    expect(saved().focusSessions).toEqual([])
    await user.click(await button("Keep going"))
    expect(saved().timer.runningSince).not.toBeNull()
    expect(saved().focusSessions).toEqual([])
  })

  it("doesn't resume a session that was already paused", async () => {
    seed(withTask())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    await user.click(await button("Pause"))
    await user.click(await button("End session"))
    await user.click(await button("Keep going"))
    expect(saved().timer.runningSince).toBeNull()
  })

  it("saves the note, and shows it on the next visit", async () => {
    seed(withTask({ firstStep: "Open the doc" }))
    const user = userEvent.setup()
    await start(user)
    await user.type(
      await screen.findByLabelText("Where should you start next time?"),
      "Continue from paragraph two."
    )
    await user.click(await button("I started / made progress"))
    expect(saved().timer).toBeNull()
    expect(saved().tasks[0]).toMatchObject({
      resumeNote: "Continue from paragraph two.",
      status: "in-progress",
      firstStep: "Open the doc",
    })
    expect(saved().focusSessions[0].endOutcome).toBe("progress")
    cleanup()
    render(<WorkspaceApp />)
    expect(await within(nowCard()).findByText("Pick up here")).toBeTruthy()
    expect(
      within(nowCard()).getByText("Continue from paragraph two.")
    ).toBeTruthy()
  })

  it("can skip the note, and an earlier one stays", async () => {
    seed(withTask({ resumeNote: "From paragraph two" }))
    const user = userEvent.setup()
    await start(user)
    await user.click(await button("I started / made progress"))
    expect(saved().tasks[0].resumeNote).toBe("From paragraph two")
    expect(saved().focusSessions).toHaveLength(1)
  })

  it("records real time separately from what was planned", async () => {
    seed(withTask({ estimateMinutes: 25 }))
    const user = userEvent.setup()
    await start(user)
    await user.click(await button("I started / made progress"))
    const [session] = saved().focusSessions
    expect(session.plannedMinutes).toBe(25)
    expect(session.actualSeconds).toBeLessThan(60)
  })

  it("Test 7: the minimum version doesn't complete the task", async () => {
    seed(withTask({ minimumVersion: "Write one line" }))
    const user = userEvent.setup()
    await start(user)
    expect(
      await screen.findByText(/Minimum version: Write one line/)
    ).toBeTruthy()
    await user.click(await button("I completed the minimum version"))
    const stored = saved()
    expect(stored.tasks[0].status).toBe("in-progress")
    expect(stored.tasks[0].completedAt).toBeNull()
    expect(eventTypes()).toEqual(["started", "minimum_met"])
    expect(stored.focusSessions[0].endOutcome).toBe("minimum")
    expect(recentActions(restoreWorkspace(stored))).toEqual([])
    expect(await screen.findByText(/Minimum version done/)).toBeTruthy()
    expect(await button("Start")).toBeTruthy()
  })

  it("the original task is completed only when the user says so", async () => {
    seed(withTask())
    const user = userEvent.setup()
    await start(user)
    await user.click(await button("I completed the original task"))
    expect(saved().tasks[0].status).toBe("completed")
    expect(saved().focusSessions[0].endOutcome).toBe("completed")
    expect(eventTypes()).toEqual(["started", "completed"])
  })

  it("says in focus history which outcome it was", async () => {
    seed(withTask())
    const user = userEvent.setup()
    await start(user)
    await user.click(await button("I completed the minimum version"))
    await user.click(await button("Save"))
    await user.click(await button("Focus history"))
    expect(
      await screen.findByText(/You said you completed the minimum version/)
    ).toBeTruthy()
    expect(screen.queryByText(/You said you made progress/)).toBeNull()
  })

  it("asks what they did when no minimum version is written, and saves it", async () => {
    seed(withTask())
    const user = userEvent.setup()
    await start(user)
    await user.click(await button("I completed the minimum version"))
    await user.type(
      await screen.findByLabelText("What did you do?"),
      "Wrote the opening line{Enter}"
    )
    await waitFor(() => expect(saved().timer).toBeNull())
    expect(saved().tasks[0].minimumVersion).toBe("Wrote the opening line")
    expect(saved().tasks[0].status).not.toBe("completed")
  })

  it("doesn't ask again when a minimum version is already written", async () => {
    seed(
      workspaceReducer(withTask(), {
        type: "edit-task",
        id: withTask().tasks[0].id,
        at: AT,
        patch: { minimumVersion: "One line" },
      })
    )
    const user = userEvent.setup()
    await start(user)
    await user.click(await button("I completed the minimum version"))
    expect(screen.queryByLabelText("What did you do?")).toBeNull()
    await waitFor(() => expect(saved().timer).toBeNull())
    expect(saved().tasks[0].minimumVersion).toBe("One line")
  })

  it("keeps a session with no task simple", async () => {
    seed(
      run(
        [
          {
            type: "timer-start",
            id: "t",
            kind: "focus",
            taskId: null,
            minutes: 5,
            now: Date.now(),
            at: AT,
          },
        ],
        EMPTY_WORKSPACE
      )
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("End session"))
    expect(
      screen.queryByLabelText("Where should you start next time?")
    ).toBeNull()
    const ends = await screen.findAllByRole("button", { name: "End session" })
    await user.click(ends.at(-1)!)
    expect(saved().timer).toBeNull()
    expect(saved().focusSessions).toHaveLength(1)
  })
})

describe("when the timer reaches zero", () => {
  const ranOut = () =>
    run(
      [
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 5,
          now: Date.now() - 400_000,
          at: AT,
        },
      ],
      withTask()
    )

  it("records actual time once, asks, and completes nothing", async () => {
    seed(ranOut())
    render(<WorkspaceApp />)
    await screen.findByLabelText("Where should you start next time?")
    expect(saved().focusSessions).toHaveLength(1)
    expect(saved().focusSessions[0].actualSeconds).toBe(300)
    expect(saved().tasks[0].status).toBe("in-progress")
    cleanup()
    render(<WorkspaceApp />)
    await screen.findByLabelText("Where should you start next time?")
    expect(saved().focusSessions).toHaveLength(1)
  })

  it("lets the user keep going, counted as a new stretch", async () => {
    seed(ranOut())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Keep going, 5 more minutes"))
    expect(saved().timer.plannedSeconds).toBe(300)
    expect(saved().focusSessions).toHaveLength(1)
    expect(eventTypes()).toEqual(["started"])
  })

  it("moves on from Today after the answer", async () => {
    seed(ranOut())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("I started / made progress"))
    await waitFor(() => expect(saved().finishedSessionId).toBeNull())
    expect(await button("Start")).toBeTruthy()
  })
})

describe("progress events", () => {
  it("records started once, across pauses, new sessions, and reloads", async () => {
    seed(withTask())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    await user.click(await button("Pause"))
    await user.click(await button("Resume"))
    cleanup()
    render(<WorkspaceApp />)
    await user.click(await button("End session"))
    await user.click(await button("I started / made progress"))
    await user.click(await button("Start"))
    expect(eventTypes()).toEqual(["started"])
    expect(saved().progressEvents[0].sessionId).toBeTruthy()
  })

  it("records completion from any route, once", () => {
    const state = run(
      [
        { type: "set-status", id: "a", at: AT, status: "completed" },
        { type: "set-status", id: "a", at: AT, status: "completed" },
      ],
      withTask()
    )
    expect(state.progressEvents.map((item) => item.type)).toEqual(["completed"])
  })

  it("doesn't call a break a start", () => {
    const state = run(
      [
        {
          type: "timer-start",
          id: "b",
          kind: "break",
          taskId: null,
          minutes: 5,
          now: 1,
          at: AT,
        },
      ],
      withTask()
    )
    expect(state.progressEvents).toEqual([])
  })

  it("survives saving, and leaves with its deleted task", () => {
    const state = run(
      [
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 5,
          now: 1,
          at: AT,
        },
      ],
      withTask()
    )
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(state)))
    expect(restored.progressEvents).toHaveLength(1)
    const removed = run([{ type: "delete-task", id: "a" }], restored)
    expect(removed.progressEvents).toEqual([])
  })
})

describe("Test 9: navigating or reloading mid-session", () => {
  const started = () =>
    run(
      [
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 25,
          now: Date.now() - 60_000,
          at: AT,
        },
      ],
      withTask()
    )

  it("keeps an active session, its elapsed time, and records nothing extra", async () => {
    seed(started())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await within(await screen.findByRole("region", { name: "Now" })).findByRole(
      "timer"
    )
    await user.click(await button("Calendar"))
    await screen.findByRole("heading", { name: "Calendar" })
    await user.click(await button("Today"))
    const timer = await screen.findByRole("timer")
    expect(timer.textContent).toMatch(/^2[34]:/)
    expect(saved().timer.id).toBe("t")
    expect(saved().focusSessions).toEqual([])
    cleanup()
    render(<WorkspaceApp />)
    expect((await screen.findByRole("timer")).textContent).toMatch(/^2[34]:/)
    expect(saved().focusSessions).toEqual([])
  })

  it("keeps a paused session paused", async () => {
    const paused = run([{ type: "timer-pause", now: Date.now() }], started())
    seed(paused)
    render(<WorkspaceApp />)
    await button("Resume")
    const before = saved().timer.accumulatedMs
    cleanup()
    render(<WorkspaceApp />)
    await button("Resume")
    expect(saved().timer.accumulatedMs).toBe(before)
    expect(saved().timer.runningSince).toBeNull()
  })

  it("keeps the clock stopped if a reload happens mid-answer", async () => {
    seed(started())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("End session"))
    const before = saved().timer
    expect(before.runningSince).toBeNull()
    cleanup()
    render(<WorkspaceApp />)
    await button("Resume")
    expect(saved().timer).toEqual(before)
    expect(saved().focusSessions).toEqual([])
  })
})

describe("the card keeps working around these", () => {
  it("lets Make it smaller take over from an older note", async () => {
    seed(withTask({ resumeNote: "From paragraph two" }))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Make it smaller"))
    expect(saved().tasks[0].resumeNote).toBe("")
    expect(saved().tasks[0].nextAction.length).toBeGreaterThan(5)
  })

  it("keeps note history, and doesn't call an old note a date", () => {
    const state = run(
      [
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 5,
          now: 1,
          at: AT,
        },
        { type: "timer-finish", now: 300_001 },
        {
          type: "session-wrap-up",
          sessionId: "t",
          at: AT,
          outcome: "progress",
          resumeNote: "Next: the intro",
        },
      ],
      withTask({ deadline: TODAY } as Partial<Task>)
    )
    expect(state.tasks[0].resumeNote).toBe("Next: the intro")
    expect(
      state.tasks[0].history.some((item) =>
        item.text.includes("Next: the intro")
      )
    ).toBe(true)
  })
})
