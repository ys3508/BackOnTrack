// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { plannedSessions } from "@/lib/calendar/model"
import { eventOf } from "./event-fixtures"
import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { draftRealityGap } from "@/lib/recovery/case-engine"
import { newBuffer } from "@/lib/calendar/model"
import { chooseBuffer, freeBuffersOn, nextFreeSlot } from "@/lib/today/buffer"
import { nowState, restartsOn } from "@/lib/today/now"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
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
const events = (type: string) =>
  saved().progressEvents.filter((item: { type: string }) => item.type === type)
const pad = (value: number) => String(value).padStart(2, "0")
const earlierToday = () => {
  const date = new Date(Date.now() - 30 * 60_000)
  return localToday(date) === TODAY
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : "00:00"
}
const task = (id: string, title = id, deadline: string | null = null) =>
  ({ type: "create-task", id, at: AT, title, deadline }) as WorkspaceAction
const block = (
  id: string,
  taskId: string,
  time: string,
  minutes = 25,
  date = TODAY
) =>
  ({
    type: "add-planned",
    at: AT,
    session: { id, taskId, date, time, minutes, label: "", done: false },
  }) as WorkspaceAction
const missed = (deadline: string | null = null) =>
  run([
    task("a", "Email my professor", deadline),
    block("m", "a", earlierToday()),
  ])

const reasons = () =>
  within(screen.getByRole("group", { name: /What’s making this difficult/ }))
    .getAllByRole("button")
    .map((item) => item.textContent)

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("Test 2: avoiding something, with nothing scheduled", () => {
  const enter = async (
    user: ReturnType<typeof userEvent.setup>,
    text: string
  ) => {
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      text
    )
    await user.click(await button("Continue"))
  }

  it("goes from a sentence to a real session, on Today, with no block", async () => {
    const user = userEvent.setup()
    await enter(user, "I haven't finished my homework for two weeks.")
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
    expect(window.location.hash).toBe("#/")
    expect(plannedSessions(saved())).toEqual([])
    expect(saved().tasks[0].title).toBe("I haven't finished my homework")
    expect(events("restarted")).toEqual([])

    await user.click(await button(/I know what to do, but I can’t start/))
    const action = await screen.findByTestId("plan-b-action")
    expect(action.textContent!.length).toBeGreaterThan(5)
    expect(screen.getByText("Built-in suggestion, not AI")).toBeTruthy()
    expect(events("restarted")).toEqual([])

    await user.click(await button("Change this step"))
    const input = await screen.findByLabelText("What’s one thing you could do?")
    await user.clear(input)
    await user.type(input, "Open the worksheet{Enter}")
    await user.click(await button("Start"))
    expect(saved().timer).toMatchObject({ plannedSeconds: 300 })
    expect(saved().recovery).toBeNull()
    expect(events("restarted")).toHaveLength(1)
    expect(await screen.findByText("Open the worksheet")).toBeTruthy()
  })

  it("can do 5 minutes straight away, or schedule it, without choosing a reason", async () => {
    const user = userEvent.setup()
    await enter(user, "Sort the garage")
    await user.click(await button("Do 5 minutes now"))
    expect(saved().timer.plannedSeconds).toBe(300)
    expect(events("restarted")).toHaveLength(1)
  })

  it("schedules it into a part of the day, with no exact time", async () => {
    const user = userEvent.setup()
    await enter(user, "Sort the garage")
    await user.click(await button("Schedule it"))
    await user.click(await button("Evening"))
    await user.click(await button("Save"))
    expect(plannedSessions(saved())[0]).toMatchObject({
      time: null,
      window: "evening",
      date: TODAY,
    })
    expect(saved().recovery).toBeNull()
  })

  it("finds an existing task from the list, instead of making a second one", async () => {
    seed(run([task("a", "Homework")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "homew"
    )
    await user.click(await screen.findByRole("option", { name: "Homework" }))
    await user.click(await button("Continue"))
    await screen.findByRole("heading", { name: /difficult/ })
    expect(saved().tasks).toHaveLength(1)
    expect(saved().recovery.taskId).toBe("a")
  })

  it("selects the existing task it matches exactly", async () => {
    seed(run([task("a", "Homework")]))
    const user = userEvent.setup()
    await enter(user, "homework")
    await screen.findByRole("heading", { name: /difficult/ })
    expect(saved().tasks).toHaveLength(1)
    expect(saved().recovery.taskId).toBe("a")
  })

  it("keeps what's typed, and where they were, through a reload", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "half a thought"
    )
    cleanup()
    render(<WorkspaceApp />)
    expect(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      })
    ).toHaveValue("half a thought")
  })

  it("stops for crisis wording, and creates nothing", async () => {
    const user = userEvent.setup()
    await enter(user, "I want to kill myself")
    expect(await screen.findByRole("alert")).toHaveTextContent("988")
    expect(saved().tasks).toEqual([])
  })
})

describe("the four reasons", () => {
  const stuck = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<WorkspaceApp />)
    await user.click(await button("I’m stuck"))
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
  }

  it("offers exactly those four", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    expect(
      reasons().map((text) => text!.replace("Closest to what you wrote", ""))
    ).toEqual([
      "I know what to do, but I can’t start",
      "I don’t know where to begin",
      "I’m worried about the outcome or someone’s reaction",
      "I don’t have enough time anymore",
    ])
  })

  it("Reason 1: one small action and a Start button, no list", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    await user.click(await button(/I know what to do/))
    await screen.findByTestId("plan-b-action")
    expect(screen.getAllByTestId("plan-b-action")).toHaveLength(1)
    expect(await button("Start")).toBeTruthy()
    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.queryByText(/^Then 1:/)).toBeNull()
  })

  it("Reason 2: one first step, with the rest only when asked", async () => {
    seed(run([task("a", "Clean my kitchen")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "Clean my kitchen"
    )
    await user.click(await button("Continue"))
    await user.click(await button(/I don’t know where to begin/))
    await screen.findByTestId("plan-b-action")
    expect(screen.queryByText(/^Then 1:/)).toBeNull()
    await user.click(await button("Show the next step"))
    expect(await screen.findByText(/^Then 1:/)).toBeTruthy()
    expect(screen.queryByText(/^Then 2:/)).toBeNull()
  })

  it("offers an editable message draft under the Reality Gap boxes", async () => {
    seed(run([task("a", "I'm afraid to email my professor")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "I'm afraid to email my professor"
    )
    await user.click(await button("Continue"))
    await user.click(await button(/I’m worried about the outcome/))
    await user.click(await button(/message draft|Draft a message/))
    const draft = (await screen.findByLabelText(
      "A message you could send"
    )) as HTMLTextAreaElement
    expect(draft.value.length).toBeGreaterThan(10)
    expect(screen.getByText(/doesn’t send anything/)).toBeTruthy()
    await user.type(draft, " Thanks.")
    expect(saved().tasks[0].recoveryCase.messageDraft).toMatch(/Thanks\.$/)
    expect(
      draft.compareDocumentPosition(
        screen.getByRole("heading", { name: "Possible Actions" })
      ) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy()
  })

  it("has no way out to a second recovery screen", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "Essay"
    )
    await user.click(await button("Continue"))
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
    expect(screen.queryByRole("button", { name: /fuller plan/ })).toBeNull()
  })

  it("says so and keeps going with a built-in step when Live AI fails", async () => {
    const state = run([task("a", "Essay")])
    seed({
      ...state,
      settings: { ...state.settings, modePreference: "live" },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response("nope", { status: 500 })
          : Response.json({ live: true, model: "test-model" })
      )
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "Essay"
    )
    await user.click(await button("Continue"))
    await user.click(await button(/I don’t know where to begin/))
    expect(await screen.findByText(/Live AI couldn’t answer/)).toBeTruthy()
    expect(screen.getByTestId("plan-b-action").textContent).not.toBe("")
    expect(screen.getByText(/Built-in suggestion, not AI/)).toBeTruthy()
  })

  it("Test 3: Reason 3 opens the four editable Reality Gap sections", async () => {
    seed(run([task("a", "I'm afraid to open my email")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/I’ve been avoiding something/))
    await user.type(
      await screen.findByRole("combobox", {
        name: "What you’ve been avoiding",
      }),
      "I'm afraid to open my email"
    )
    await user.click(await button("Continue"))
    await user.click(await button(/I’m worried about the outcome/))
    await screen.findByRole("heading", { name: "Reality Gap" })
    for (const name of [
      "Known Facts",
      "Worries / Assumptions",
      "Unknowns",
      "Possible Actions",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy()
    }
    expect(screen.getByText(/possibilities, not facts/)).toBeTruthy()
    const worry = screen.getByLabelText("Worries / Assumptions, item 1")
    expect((worry as HTMLTextAreaElement).value).toMatch(/might/)
    await user.clear(worry)
    await user.type(worry, "My inbox might be full")
    expect(saved().tasks[0].recoveryCase.realityGap.worried[0]).toBe(
      "My inbox might be full"
    )
    // It's a possible action, and the plan can use it.
    await user.click(
      screen.getAllByRole("button", { name: "Make this my next step" })[0]
    )
    await waitFor(() =>
      expect(screen.getByTestId("plan-b-action").textContent).toBe(
        saved().tasks[0].recoveryCase.current.text
      )
    )
  })

  it("invents no fact when someone is afraid of an action", () => {
    const gap = draftRealityGap("I'm afraid to open my email.")
    expect(gap.known).toEqual([])
    expect(gap.worried[0]).toBe("Something might go badly if I open my email")
    expect([...gap.unknown, ...gap.can].join(" ")).not.toMatch(/\d/)
  })

  it("Reason 4: asks first, and nothing is chosen for them", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    await user.click(await button(/I don’t have enough time/))
    await screen.findByRole("heading", {
      name: "How do you want to handle this?",
    })
    expect(screen.queryByTestId("plan-b-action")).toBeNull()
    expect(saved().tasks[0].recoveryCase.path).toBeNull()
  })

  it("can change the reason, and keeps earlier work", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    await user.click(await button(/I’m worried about the outcome/))
    const known = await screen.findByLabelText("Known Facts, item 1")
    await user.clear(known)
    await user.type(known, "I wrote this myself")
    await user.click(await button("Choose a different reason"))
    await user.click(await button(/I know what to do/))
    await screen.findByTestId("plan-b-action")
    expect(saved().tasks[0].recoveryCase.realityGap.known).toEqual([
      "I wrote this myself",
    ])
    expect(saved().tasks).toHaveLength(1)
  })

  it("Plan B can be replaced by another suggestion", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    await user.click(await button(/I know what to do/))
    const first = (await screen.findByTestId("plan-b-action")).textContent
    await user.click(await button("Try something else"))
    await waitFor(() =>
      expect(screen.getByTestId("plan-b-action").textContent).not.toBe(first)
    )
  })

  it("Plan B can be scheduled instead, moving the block that was missed", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    await user.click(await button(/I know what to do/))
    await user.click(await button("Schedule it"))
    await user.click(await button("Afternoon"))
    await user.click(await button("Save"))
    expect(plannedSessions(saved())).toHaveLength(1)
    expect(plannedSessions(saved())[0]).toMatchObject({
      id: "m",
      time: null,
      window: "afternoon",
    })
    expect(saved().recovery).toBeNull()
    expect(events("restarted")).toEqual([])
  })

  it("has no accessibility problems in recovery", async () => {
    seed(missed())
    const user = userEvent.setup()
    await stuck(user)
    const check = async () => {
      const results = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      })
      expect(results.violations.map((item) => item.id)).toEqual([])
    }
    await check()
    await user.click(await button(/I’m worried about the outcome/))
    await screen.findByRole("heading", { name: "Reality Gap" })
    await check()
  })
})

describe("Test 4: a missed block, all the way through", () => {
  it("gets from the card to a saved note, with one restart, through a reload", async () => {
    seed(missed())
    const user = userEvent.setup()
    render(<WorkspaceApp />)

    // 1. The recovery card appears.
    await screen.findByText(/You planned to start this at/)
    await button("Move to buffer")
    expect(events("restarted")).toEqual([])
    expect(events("recovery_shown")).toHaveLength(1)

    // 2 to 5. I'm stuck, four reasons, one chosen, a Plan B.
    await user.click(await button("I’m stuck"))
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
    expect(reasons()).toHaveLength(4)
    await user.click(await button(/I know what to do/))
    const plan = (await screen.findByTestId("plan-b-action")).textContent!
    expect(events("restarted")).toEqual([])

    // Reloading mid-recovery lands in the same place.
    cleanup()
    render(<WorkspaceApp />)
    expect((await screen.findByTestId("plan-b-action")).textContent).toBe(plan)
    expect(events("restarted")).toEqual([])

    // 6. Start it.
    await user.click(await button("Start"))
    expect(saved().timer).toMatchObject({ plannedId: "m" })
    expect(events("restarted")).toHaveLength(1)
    expect(await screen.findByText(plan)).toBeTruthy()

    // 7. Pause and resume.
    await user.click(await button("Pause"))
    await user.click(await button("Resume"))
    expect(events("restarted")).toHaveLength(1)

    // Reloading during the session doesn't count it again.
    cleanup()
    render(<WorkspaceApp />)
    await button("Pause")
    expect(events("restarted")).toHaveLength(1)

    // 8. End it, with a note.
    await user.click(await button("End session"))
    await user.type(
      await screen.findByLabelText("Where should you start next time?"),
      "Send the second paragraph"
    )
    await user.click(await button("I started / made progress"))

    // 9 and 10. One restart, and it all survives.
    cleanup()
    render(<WorkspaceApp />)
    expect(await screen.findByText("Pick up here")).toBeTruthy()
    expect(screen.getByText("Send the second paragraph")).toBeTruthy()
    expect(events("restarted")).toHaveLength(1)
    expect(saved().focusSessions).toHaveLength(1)
    expect(plannedSessions(saved())[0].outcome).toBeNull()
    expect(await screen.findByText(/Restarted 1 time/)).toBeTruthy()
  })

  it("counts Do 5 minutes now once, and a later session not at all", async () => {
    seed(missed())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Do 5 minutes now"))
    expect(events("restarted")).toHaveLength(1)
    await user.click(await button("End session"))
    await user.click(await button("I started / made progress"))
    await user.click(await button("Start"))
    expect(events("restarted")).toHaveLength(1)
  })

  it("doesn't count an ordinary start as a restart", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    expect(events("restarted")).toEqual([])
    expect(restartsOn(saved(), TODAY)).toBe(0)
  })

  it("doesn't count a card that was only looked at, or left", async () => {
    seed(missed())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("I’m stuck"))
    await user.click(await button(/I know what to do/))
    await user.click(await button("Choose a different reason"))
    await user.click(await button("Not now"))
    expect(saved().recovery).toBeNull()
    expect(events("restarted")).toEqual([])
    expect(await screen.findByText(/You planned to start this at/)).toBeTruthy()
  })

  it("won't record recovery_shown twice for one block", () => {
    const state = run(
      [
        { type: "recovery-shown", at: AT, taskId: "a", plannedId: "m" },
        { type: "recovery-shown", at: AT, taskId: "a", plannedId: "m" },
      ],
      missed()
    )
    expect(
      state.progressEvents.filter((item) => item.type === "recovery_shown")
    ).toHaveLength(1)
  })

  it("survives saving and loading", () => {
    const state = run(
      [
        {
          type: "enter-recovery",
          at: AT,
          taskId: "a",
          plannedId: "m",
          source: "scheduled",
        },
        { type: "recovery-reason", reason: "worried" },
      ],
      missed()
    )
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(state)))
    expect(restored.recovery).toMatchObject({
      taskId: "a",
      reason: "worried",
      plannedId: "m",
    })
    expect(nowState(restored, TODAY, Date.now()).kind).toBe("recovering")
  })

  it("leaves recovery if the task was finished elsewhere", () => {
    const state = run(
      [
        {
          type: "enter-recovery",
          at: AT,
          taskId: "a",
          source: "avoidance",
        },
        { type: "set-status", id: "a", at: AT, status: "completed" },
      ],
      run([task("a", "Essay")])
    )
    expect(nowState(state, TODAY, Date.now()).kind).toBe("empty")
  })
})

describe("Test 5: moving to a buffer", () => {
  const ending = new Date(`${TODAY}T14:00:00`).getTime()
  const buffer = (time = "15:00", minutes = 30): WorkspaceAction => ({
    type: "add-event",
    event: newBuffer("buf", TODAY, time, minutes),
  })

  it("has no buffer to offer unless one was placed", () => {
    expect(freeBuffersOn(EMPTY_WORKSPACE, TODAY, ending)).toEqual([])
  })

  it("finds the free part of the buffer, around what's already there", () => {
    const state = run([buffer(), task("a"), block("x", "a", "15:10", 10)])
    expect(freeBuffersOn(state, TODAY, ending)).toEqual([
      { date: TODAY, time: "15:00", minutes: 10 },
      { date: TODAY, time: "15:20", minutes: 10 },
    ])
  })

  it("counts routines as taken, too", () => {
    const state = run([
      buffer(),
      {
        type: "add-event",
        event: eventOf({
          date: "2020-01-01",
          start: "15:00",
          repeat: { days: [new Date().getDay()] },
        }),
      },
    ])
    expect(freeBuffersOn(state, TODAY, ending)).toEqual([])
  })

  it("only offers what's left of it, once it has begun", () => {
    const state = run([buffer()])
    const during = new Date(`${TODAY}T15:15:00`).getTime()
    expect(freeBuffersOn(state, TODAY, during)).toEqual([
      { date: TODAY, time: "15:15", minutes: 15 },
    ])
    const after = new Date(`${TODAY}T16:00:00`).getTime()
    expect(freeBuffersOn(state, TODAY, after)).toEqual([])
  })

  it("moves it into today's next buffer if it fits", () => {
    const state = run([buffer(), task("a"), block("m", "a", "09:00", 25)])
    expect(chooseBuffer(state, plannedSessions(state)[0], TODAY, ending)).toEqual({
      kind: "fits",
      slot: { date: TODAY, time: "15:00", minutes: 25 },
    })
  })

  it("offers the next free time when no buffer has room", () => {
    const state = run([
      buffer(),
      task("a"),
      block("m", "a", "09:00", 60),
      block("x", "a", "14:00", 30),
    ])
    expect(chooseBuffer(state, plannedSessions(state)[0], TODAY, ending)).toEqual({
      kind: "none",
      slot: { date: TODAY, time: "14:30", minutes: 60 },
      needed: 60,
    })
  })

  it("looks to tomorrow morning when today is full", () => {
    const state = run([task("a"), block("m", "a", "09:00", 60)])
    const late = new Date(`${TODAY}T23:30:00`).getTime()
    expect(nextFreeSlot(state, TODAY, late, 60, "m")).toEqual({
      date: addDays(TODAY, 1),
      time: "09:00",
      minutes: 60,
    })
  })

  it("moves the block in the app, leaving deadline and task alone", async () => {
    const deadline = addDays(TODAY, 2)
    seed(missed(deadline))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Move to buffer"))
    await waitFor(() => {
      const [moved] = plannedSessions(saved())
      const stillHere = moved.time !== earlierToday()
      const offered = screen.queryByRole("button", {
        name: /Reschedule manually/,
      })
      expect(stillHere || offered).toBeTruthy()
    })
    expect(saved().tasks[0].deadline).toBe(deadline)
    expect(saved().tasks[0].originalDeadline).toBe(deadline)
    expect(saved().tasks[0].title).toBe("Email my professor")
    expect(saved().tasks[0].status).toBe("not-started")
    expect(events("restarted")).toEqual([])
  })

  it("asks when a long session doesn't fit, with nothing moved until then", async () => {
    const time = earlierToday()
    seed(run([task("a", "Long one"), block("m", "a", time, 120)]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Move to buffer"))
    expect(await screen.findByText(/Nothing has moved/)).toBeTruthy()
    expect(plannedSessions(saved())[0]).toMatchObject({
      time,
      minutes: 120,
      date: TODAY,
    })
    await user.click(await button("Reschedule manually"))
    expect(await screen.findByRole("group", { name: "When" })).toBeTruthy()
  })
})

describe("Test 6: deadlines never change", () => {
  const deadline = addDays(TODAY, 2)
  const check = () => {
    const [stored] = saved().tasks
    expect(stored.deadline).toBe(deadline)
    expect(stored.originalDeadline).toBe(deadline)
  }

  it("through Reschedule", async () => {
    seed(missed(deadline))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Reschedule"))
    expect(screen.getByText(/The deadline stays/)).toBeTruthy()
    const day = screen.getByLabelText("Day")
    await user.clear(day)
    await user.type(day, addDays(TODAY, 4))
    await user.click(await button("Save"))
    expect(plannedSessions(saved())[0].date).toBe(addDays(TODAY, 4))
    check()
  })

  const toReasonFour = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<WorkspaceApp />)
    await user.click(await button("I’m stuck"))
    await user.click(await button(/I don’t have enough time/))
  }

  it("through Reduce, whose smaller step doesn't complete the task", async () => {
    seed(missed(deadline))
    const user = userEvent.setup()
    await toReasonFour(user)
    await user.click(await button(/^Reduce/))
    expect(await screen.findByTestId("plan-b-action")).toBeTruthy()
    expect(screen.getByText(/won’t mark the original task done/)).toBeTruthy()
    await user.click(await button("Start"))
    await user.click(await button("End session"))
    await user.click(await button("I started / made progress"))
    expect(saved().tasks[0].status).toBe("in-progress")
    check()
  })

  it("through Finish, with a session they can adjust", async () => {
    seed(missed(deadline))
    const user = userEvent.setup()
    await toReasonFour(user)
    await user.click(await button(/^Finish/))
    await screen.findByTestId("plan-b-action")
    await user.click(await button("15"))
    await user.click(await button("Start"))
    expect(saved().timer.plannedSeconds).toBe(900)
    check()
  })

  it("through Release, with a clear confirmation and a record", async () => {
    seed(missed(deadline))
    const user = userEvent.setup()
    await toReasonFour(user)
    await user.click(await button(/^Release/))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/doesn’t cancel anything outside/)
    expect(alert).toHaveTextContent(/If you stop: unknown/)
    expect(saved().tasks[0].status).toBe("not-started")
    await user.click(await button("Yes, release it"))
    expect(saved().tasks[0].status).toBe("released")
    expect(saved().recovery).toBeNull()
    check()
    const history = saved().tasks[0].history.map(
      (item: { text: string }) => item.text
    )
    expect(history.join(" ")).toMatch(
      /Released this in BackOnTrack\. The original deadline stays on record/
    )
    expect(events("recovery_action_taken").length).toBeGreaterThan(0)
  })

  it("can set it aside instead, or keep it", async () => {
    seed(missed(deadline))
    const user = userEvent.setup()
    await toReasonFour(user)
    await user.click(await button(/^Release/))
    await user.click(await button("Keep it"))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(saved().tasks[0].status).toBe("not-started")
    await user.click(await button(/^Release/))
    await user.click(await button("Set it aside for now"))
    expect(saved().tasks[0].status).toBe("paused")
    check()
  })
})

describe("Did you work on this?", () => {
  const ended = () => {
    const time = "00:00"
    return run([task("a", "Essay"), block("m", "a", time, 5)])
  }
  const passed = new Date(`${TODAY}T00:06:00`).getTime() < Date.now()

  it.runIf(passed)(
    "Yes: records what they say, marked as reported",
    async () => {
      seed(ended())
      const user = userEvent.setup()
      render(<WorkspaceApp />)
      await screen.findByText("Did you work on this?")
      await user.click(await button("Yes"))
      await user.click(await button("45"))
      await user.click(await button("Save 45 min"))
      expect(saved().focusSessions[0]).toMatchObject({
        actualSeconds: 2700,
        plannedMinutes: 5,
        reported: true,
      })
      expect(plannedSessions(saved())[0].outcome).toBe("did")
      expect(events("restarted")).toEqual([])
    }
  )

  it.runIf(passed)(
    "Not yet: keeps the task available, with no time recorded",
    async () => {
      seed(ended())
      const user = userEvent.setup()
      render(<WorkspaceApp />)
      await user.click(await button("Not yet"))
      expect(saved().focusSessions).toEqual([])
      expect(saved().tasks[0].status).toBe("not-started")
      expect(await button("Start")).toBeTruthy()
    }
  )
})

describe("getting there from elsewhere", () => {
  it("opens the same recovery from the task page, on Today", async () => {
    seed(run([task("a", "Essay")]))
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("I’m stuck"))
    await waitFor(() => expect(window.location.hash).toBe("#/"))
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
  })

  it("keeps a simple task out of recovery entirely", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(
      await screen.findByPlaceholderText("What have you been putting off?"),
      "Buy lunch{Enter}"
    )
    await user.click(await button("Start"))
    expect(saved().recovery).toBeNull()
    expect(saved().tasks[0].recoveryCase).toBeNull()
  })

  it("never calls planned-versus-actual a Reality Gap", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(document.body.textContent).not.toMatch(/Reality Gap/)
  })
})
