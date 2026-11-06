// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { timelineWindow } from "@/lib/today/timeline"
import { WorkspaceApp } from "@/components/workspace/workspace-app"
import {
  firstStepOf,
  nowState,
  pickAnother,
  sessionMinutes,
} from "@/lib/today/now"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { DEFAULT_SETTINGS, EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"

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
const task = (
  id: string,
  title = id,
  deadline: string | null = null
): WorkspaceAction => ({ type: "create-task", id, at: AT, title, deadline })

const pad = (value: number) => String(value).padStart(2, "0")
const clock = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`
/** A time today, relative to now, staying inside today near midnight. */
const offset = (minutes: number) => {
  const date = new Date(Date.now() + minutes * 60_000)
  return localToday(date) === TODAY
    ? date
    : new Date(`${TODAY}T${minutes < 0 ? "00:00" : "23:59"}:00`)
}
const block = (
  id: string,
  taskId: string,
  time: string,
  minutes = 25
): WorkspaceAction => ({
  type: "add-planned",
  at: AT,
  session: { id, taskId, date: TODAY, time, minutes, label: "", done: false },
})

const nowCard = () => screen.getByRole("region", { name: "Now" })
const primaries = () =>
  within(nowCard())
    .getAllByRole("button")
    .filter((item) => item.className.includes("bg-primary"))

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("which state the Now card is in", () => {
  const now = Date.now()
  const earlier = clock(offset(-30))
  const later = clock(offset(30))

  it("goes by what's true: timer, then missed, then upcoming, then a suggestion", () => {
    const base = run([task("a"), task("b")])
    expect(nowState(EMPTY_WORKSPACE, TODAY, now).kind).toBe("empty")
    expect(nowState(base, TODAY, now).kind).toBe("suggested")
    const upcoming = run([block("u", "a", later)], base)
    expect(nowState(upcoming, TODAY, now).kind).toBe("upcoming")
    const missed = run([block("m", "b", earlier)], upcoming)
    expect(nowState(missed, TODAY, now)).toMatchObject({
      kind: "missed",
      task: { id: "b" },
    })
    const running = run(
      [
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 5,
          now,
          at: AT,
        },
      ],
      missed
    )
    expect(nowState(running, TODAY, now).kind).toBe("active")
    const paused = run([{ type: "timer-pause", now }], running)
    expect(nowState(paused, TODAY, now).kind).toBe("paused")
  })

  it("isn't missed once started, answered, finished, or moved", () => {
    const base = run([task("a"), block("m", "a", earlier)])
    const attempted = run(
      [
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          plannedId: "m",
          minutes: 5,
          now,
          at: AT,
        },
        {
          type: "timer-stop",
          now: now + 5000,
          at: AT,
          outcome: "continue-later",
          note: "",
        },
      ],
      base
    )
    expect(nowState(attempted, TODAY, now).kind).toBe("suggested")
    const didnt = run(
      [
        {
          type: "planned-outcome",
          at: AT,
          id: "m",
          outcome: "didnt",
          sessionId: "x",
        },
      ],
      base
    )
    expect(nowState(didnt, TODAY, now).kind).toBe("suggested")
    const finished = run(
      [{ type: "set-status", id: "a", at: AT, status: "completed" }],
      base
    )
    expect(nowState(finished, TODAY, now).kind).toBe("empty")
    const tomorrow = run(
      [
        {
          type: "move-planned",
          at: AT,
          id: "m",
          date: addDays(TODAY, 1),
          time: "09:00",
        },
      ],
      base
    )
    expect(nowState(tomorrow, TODAY, now).kind).toBe("suggested")
  })

  it("never suggests a paused task", () => {
    const state = run([
      task("a"),
      { type: "set-status", id: "a", at: AT, status: "paused" },
    ])
    expect(nowState(state, TODAY, now).kind).toBe("empty")
  })

  it("keeps a session short, even for a long estimate", () => {
    const base = run([task("a")]).tasks[0]
    expect(sessionMinutes(base, DEFAULT_SETTINGS)).toBe(5)
    expect(
      sessionMinutes({ ...base, estimateMinutes: 240 }, DEFAULT_SETTINGS)
    ).toBe(25)
    expect(
      sessionMinutes({ ...base, estimateMinutes: 15 }, DEFAULT_SETTINGS)
    ).toBe(15)
    expect(firstStepOf(base)).toBeNull()
  })
})

describe("Pick one for me", () => {
  it("won't swap a near deadline for something that can wait", () => {
    const state = run([task("urgent", "Urgent", TODAY), task("later")])
    expect(pickAnother(state, TODAY, "urgent")).toMatchObject({
      id: "urgent",
      keptBecause: expect.stringMatching(/due today/),
    })
  })

  it("moves between urgent things, and between things that can wait", () => {
    const urgent = run([
      task("u1", "U1", TODAY),
      task("u2", "U2", addDays(TODAY, 1)),
    ])
    expect(pickAnother(urgent, TODAY, "u1").id).toBe("u2")
    expect(pickAnother(urgent, TODAY, "u2").id).toBe("u1")
    const calm = run([task("a"), task("b"), task("c")])
    expect(pickAnother(calm, TODAY, "a").id).toBe("b")
    expect(pickAnother(calm, TODAY, "c").id).toBe("a")
  })

  it("goes to the urgent one from one that can wait", () => {
    const state = run([task("urgent", "Urgent", TODAY), task("later")])
    expect(pickAnother(state, TODAY, "later").id).toBe("urgent")
  })

  it("says so when there's only one", () => {
    expect(pickAnother(run([task("a")]), TODAY, "a").keptBecause).toMatch(
      /only open task/
    )
  })
})

describe("navigation", () => {
  it("has only Today, Calendar, Routines, and Settings", async () => {
    render(<WorkspaceApp />)
    const nav = await screen.findByRole("navigation", { name: "Main" })
    expect(
      within(nav)
        .getAllByRole("button")
        .map((item) => item.textContent)
    ).toEqual(["Today", "Calendar", "Routines", "Settings"])
  })

  it("keeps the remaining screens reachable", async () => {
    seed(run([task("a")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("All tasks"))
    await screen.findByRole("heading", { name: "Tasks" })
    await user.click(await button("Today"))
    await user.click(await button("Focus history"))
    await screen.findByRole("heading", { name: "Focus" })
    await user.click(await button("Today"))
    await screen.findByRole("heading", { name: "Today" })
    expect(screen.queryByRole("button", { name: "Plan my day" })).toBeNull()
  })

  it.each([
    "#/plan",
    "#/avoid",
    "#/case/a",
    "#/recover",
    "#/recover/a",
    "#/guided",
  ])("sends the old address %s to Today", async (hash) => {
    seed(run([task("a")]))
    window.location.hash = hash
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
  })

  it("shows routines on their own page", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Routines"))
    await screen.findByRole("heading", { name: "Routines" })
    await button("New routine")
  })
})

describe("Test 1 and Test 10: the card shows only what's relevant", () => {
  it("with no tasks: just Quick Capture", async () => {
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    const card = nowCard()
    expect(within(card).getAllByRole("button")).toHaveLength(1)
    expect(
      within(card).getByPlaceholderText("What have you been putting off?")
    ).toBeTruthy()
    expect(screen.queryByText("Today’s timeline")).toBeNull()
    expect(screen.queryByText(/Focused/)).toBeNull()
  })

  it("a title alone makes a task, which can be started or finished at once", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(
      await screen.findByPlaceholderText("What have you been putting off?"),
      "Buy lunch{Enter}"
    )
    expect(saved().tasks[0]).toMatchObject({
      title: "Buy lunch",
      deadline: null,
      estimateMinutes: null,
      priority: "none",
      recoveryCase: null,
    })
    await waitFor(() => expect(primaries()).toHaveLength(1))
    expect(primaries()[0]).toHaveTextContent("Start")
    await user.click(await button("Mark Buy lunch complete"))
    await waitFor(() => expect(saved().tasks[0].status).toBe("completed"))
  })

  it("with an upcoming task: one main button, and its details", async () => {
    const at = offset(40)
    seed(run([task("a", "Essay", TODAY), block("u", "a", clock(at), 45)]))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    const card = nowCard()
    expect(primaries()).toHaveLength(1)
    expect(primaries()[0]).toHaveTextContent("Start")
    expect(within(card).getByText("Essay")).toBeTruthy()
    expect(within(card).getByText(/Due today/)).toBeTruthy()
    expect(within(card).getByText(/45 min/)).toBeTruthy()
    within(card).getByRole("button", { name: "Make it smaller" })
    within(card).getByRole("button", { name: "Change time" })
    expect(within(card).queryByRole("button", { name: "Pause" })).toBeNull()
  })

  it("offers I'm stuck on an upcoming block, as a small link", async () => {
    seed(run([task("a", "Essay"), block("u", "a", clock(offset(40)), 45)]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    const stuck = within(nowCard()).getByRole("button", { name: "I’m stuck" })
    expect(primaries()).toHaveLength(1)
    await user.click(stuck)
    expect(saved().recovery).toMatchObject({
      taskId: "a",
      plannedId: "u",
      source: "scheduled",
    })
    await screen.findByRole("heading", {
      name: "What’s making this difficult right now?",
    })
  })

  it("doesn't offer I'm stuck on a suggested task's card", async () => {
    seed(run([task("a", "Essay")]))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(
      within(nowCard()).queryByRole("button", { name: "I’m stuck" })
    ).toBeNull()
  })

  it("with a missed block: says so plainly, and doesn't call it overdue", async () => {
    const at = offset(-30)
    seed(run([task("a", "Essay"), block("m", "a", clock(at))]))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    const card = nowCard()
    expect(
      within(card).getByText(
        /You planned to start this at .*, but haven’t started yet\./
      )
    ).toBeTruthy()
    expect(primaries()).toHaveLength(1)
    expect(primaries()[0]).toHaveTextContent("Do 5 minutes now")
    within(card).getByRole("button", { name: "Reschedule" })
    within(card).getByRole("button", { name: "I’m stuck" })
    expect(card.textContent).not.toMatch(/overdue|late|missed|failed/i)
    // Whole class names only: the button's own invalid-input styling isn't red text.
    expect(card.innerHTML).not.toMatch(/[" ](text|bg)-(destructive|red)/)
  })

  it("with an active task: Pause is the main button, and there's a countdown", async () => {
    seed(
      run([
        task("a", "Essay"),
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 25,
          now: Date.now(),
          at: AT,
        },
      ])
    )
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(primaries()).toHaveLength(1)
    expect(primaries()[0]).toHaveTextContent("Pause")
    within(nowCard()).getByRole("timer")
    within(nowCard()).getByRole("button", { name: "End session" })
    within(nowCard()).getByRole("button", { name: /Parking Lot/ })
    expect(
      screen.queryByRole("button", { name: /Open focus timer/ })
    ).toBeNull()
  })
})

describe("working from the card", () => {
  it("starts the planned block for its own length, staying on Today", async () => {
    seed(run([task("a", "Essay"), block("u", "a", clock(offset(40)), 45)]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    expect(saved().timer).toMatchObject({
      taskId: "a",
      plannedId: "u",
      plannedSeconds: 2700,
    })
    expect(window.location.hash).toBe("#/")
    expect(primaries()[0]).toHaveTextContent("Pause")
  })

  it("pauses and resumes, and a reload doesn't reset or duplicate it", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    await user.click(await button("Pause"))
    const paused = saved().timer
    expect(paused.runningSince).toBeNull()
    expect(await screen.findByText(/so far/)).toBeTruthy()
    cleanup()
    render(<WorkspaceApp />)
    expect(await button("Resume")).toBeTruthy()
    expect(saved().timer.id).toBe(paused.id)
    expect(saved().focusSessions).toEqual([])
    await user.click(await button("Resume"))
    expect(saved().timer.runningSince).not.toBeNull()
    expect(saved().timer.id).toBe(paused.id)
  })

  it("does 5 minutes on a missed block, without touching its deadline", async () => {
    const deadline = addDays(TODAY, 3)
    seed(
      run([task("a", "Essay", deadline), block("m", "a", clock(offset(-30)))])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Do 5 minutes now"))
    expect(saved().timer).toMatchObject({ plannedId: "m", plannedSeconds: 300 })
    expect(saved().tasks[0].deadline).toBe(deadline)
  })

  it("reschedules a missed block, and the deadline stays put", async () => {
    const deadline = addDays(TODAY, 3)
    seed(
      run([task("a", "Essay", deadline), block("m", "a", clock(offset(-30)))])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Reschedule"))
    const day = within(nowCard()).getByLabelText("Day")
    await user.clear(day)
    await user.type(day, addDays(TODAY, 1))
    await user.click(within(nowCard()).getByRole("button", { name: "Save" }))
    expect(saved().planned[0].date).toBe(addDays(TODAY, 1))
    expect(saved().tasks[0].deadline).toBe(deadline)
    expect(saved().tasks[0].originalDeadline).toBe(deadline)
  })

  it("sets time aside for a task that has none", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Change time"))
    await user.click(within(nowCard()).getByRole("button", { name: "Save" }))
    expect(saved().planned).toHaveLength(1)
    expect(saved().planned[0].taskId).toBe("a")
  })

  it("makes a step smaller, labels it as built-in, and starts it for 5 minutes", async () => {
    seed(run([task("a", "Clean my kitchen")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Make it smaller"))
    const step = saved().tasks[0].nextAction
    expect(step.length).toBeGreaterThan(5)
    expect(await screen.findByText(/built-in suggestion, not AI/)).toBeTruthy()
    await user.click(await button("Make it smaller"))
    expect(saved().tasks[0].nextAction).not.toBe(step)
    await user.click(await button("Start"))
    expect(saved().timer.plannedSeconds).toBe(300)
  })

  it("keeps a block's own length, even after making its step smaller", async () => {
    seed(
      run([
        task("a", "Clean my kitchen"),
        block("u", "a", clock(offset(40)), 45),
      ])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Make it smaller"))
    await user.click(await button("Start"))
    expect(saved().timer.plannedSeconds).toBe(45 * 60)
    expect(saved().timer.plannedId).toBe("u")
  })

  it("lets the user rewrite the step", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const input = await screen.findByPlaceholderText(
      "e.g. open the assignment page"
    )
    await user.type(input, "Open the doc{Enter}")
    expect(saved().tasks[0].firstStep).toBe("Open the doc")
  })

  it("saves the first step when the field loses focus", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(
      await screen.findByLabelText("What will you do first?"),
      "Open the doc"
    )
    await user.tab()
    expect(saved().tasks[0].firstStep).toBe("Open the doc")
  })

  it("offers I've been avoiding something once, on the card", async () => {
    seed(run([task("a", "Essay")]))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(
      screen.getAllByRole("button", { name: /I’ve been avoiding something/ })
    ).toHaveLength(1)
    within(nowCard()).getByRole("button", {
      name: /I’ve been avoiding something/,
    })
  })

  it("collapses an empty timeline to one line that opens", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const line = await button(/Nothing scheduled today · plan a block/)
    expect(screen.queryByRole("button", { name: "Full Calendar" })).toBeNull()
    await user.click(line)
    await button("Full Calendar")
  })

  it("shows the timeline when something is scheduled", async () => {
    seed(run([task("a", "Essay"), block("u", "a", clock(offset(40)), 45)]))
    render(<WorkspaceApp />)
    await button(/Full Calendar/)
    expect(
      screen.queryByRole("button", { name: /Nothing scheduled today/ })
    ).toBeNull()
  })

  it("never hides tasks: the rest are behind Show all", async () => {
    seed(
      run([
        task("a", "One", TODAY),
        task("b", "Two", TODAY),
        task("c", "Three", TODAY),
        task("d", "Four", TODAY),
        task("e", "Five", TODAY),
      ])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const list = (await screen.findByRole("heading", { name: "Today’s tasks" }))
      .parentElement!
    expect(within(list).getAllByRole("listitem")).toHaveLength(3)
    await user.click(within(list).getByRole("button", { name: /Show all 5/ }))
    expect(within(list).getAllByRole("listitem")).toHaveLength(5)
  })

  it("counts Not started yet, and hides it when empty", async () => {
    seed(run([task("a", "Essay")]))
    const first = render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    expect(screen.queryByText(/Not started yet/)).toBeNull()
    first.unmount()
    seed(
      run([task("a", "Essay", "2020-01-01"), task("b", "Rent", "2020-01-02")])
    )
    render(<WorkspaceApp />)
    await screen.findByText("Not started yet (2)")
  })

  it("keeps a parked thought without leaving the session", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    const timer = saved().timer.id
    await user.click(await button(/Parking Lot/))
    await user.type(
      await screen.findByLabelText(/Park a stray/),
      "Call mum{Enter}"
    )
    expect(saved().parkingLot[0]).toMatchObject({
      text: "Call mum",
      taskId: "a",
    })
    expect(saved().timer.id).toBe(timer)
    expect(window.location.hash).toBe("#/")
    cleanup()
    render(<WorkspaceApp />)
    expect(await screen.findByText("Parked thoughts (1)")).toBeTruthy()
  })

  it("ends a session without completing the task", async () => {
    seed(run([task("a", "Essay")]))
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Start"))
    await user.click(await button("End session"))
    await user.click(await button("I started / made progress"))
    expect(saved().timer).toBeNull()
    expect(saved().focusSessions).toHaveLength(1)
    expect(saved().tasks[0].status).toBe("in-progress")
  })

  it("asks, after a timer runs out, without completing anything", async () => {
    const state = run([
      task("a", "Essay"),
      {
        type: "timer-start",
        id: "t",
        kind: "focus",
        taskId: "a",
        minutes: 5,
        now: Date.now() - 400_000,
        at: AT,
      },
    ])
    seed(state)
    render(<WorkspaceApp />)
    expect(
      await screen.findByLabelText("Where should you start next time?")
    ).toBeTruthy()
    expect(saved().tasks[0].status).toBe("in-progress")
  })
})

describe("Quick Capture anywhere", () => {
  it("opens with ⌘K or Ctrl+K, needs only a title, and closes with Escape", async () => {
    const user = userEvent.setup()
    window.location.hash = "#/settings"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Settings and data" })
    await user.keyboard("{Control>}k{/Control}")
    await screen.findByRole("dialog", { name: "Quick capture" })
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "Quick capture" })).toBeNull()
    await user.keyboard("{Meta>}k{/Meta}")
    const dialog = await screen.findByRole("dialog", { name: "Quick capture" })
    await user.type(
      within(dialog).getByRole("textbox"),
      "Renew passport{Enter}"
    )
    expect(saved().tasks[0].title).toBe("Renew passport")
    expect(saved().tasks[0].deadline).toBeNull()
    expect(window.location.hash).toBe("#/settings")
    expect(await screen.findByText("Added “Renew passport”")).toBeTruthy()
  })

  it("never finds a deadline in the words", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(
      await screen.findByPlaceholderText("What have you been putting off?"),
      "Pay rent by Friday{Enter}"
    )
    expect(saved().tasks[0].deadline).toBeNull()
  })

  it("stops for crisis wording, and creates nothing", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(
      await screen.findByPlaceholderText("What have you been putting off?"),
      "I want to kill myself{Enter}"
    )
    expect(await screen.findByRole("alert")).toHaveTextContent("988")
    expect(saved().tasks).toEqual([])
  })
})

describe("around the card", () => {
  it("shows a quiet summary only when there's something to say", async () => {
    const at = new Date(`${TODAY}T00:10:00`).getTime()
    seed(
      run([
        task("a", "Essay"),
        {
          type: "timer-start",
          id: "t",
          kind: "focus",
          taskId: "a",
          minutes: 25,
          now: at,
          at: new Date(at).toISOString(),
        },
        { type: "timer-finish", now: at + 1_500_000 },
        { type: "timer-acknowledge" },
      ])
    )
    render(<WorkspaceApp />)
    expect(await screen.findByText("Focused 25 min")).toBeTruthy()
  })

  it("has no limit on tasks: the rest are folded away, not removed", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      task(`t${i}`, `Task ${i}`)
    )
    const state = run([...many, task("today", "Due now", TODAY)])
    seed(state)
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Today" })
    // Made on an earlier day, so these aren't all about today.
    expect(screen.getByText("Other open tasks (12)")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 12 tasks", hidden: true })
    )
    for (let i = 0; i < 12; i++) {
      expect(
        screen.getByRole("button", {
          name: `Mark Task ${i} complete`,
          hidden: true,
        })
      ).toBeTruthy()
    }
  })

  it("suggests reconsidering a very full day, without blocking anything", async () => {
    const user = userEvent.setup()
    seed(
      run([
        task("a", "Essay"),
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "p",
            taskId: "a",
            date: TODAY,
            time: null,
            minutes: 540,
            label: "",
            done: false,
          },
        },
      ])
    )
    render(<WorkspaceApp />)
    expect(await screen.findByText(/9 h planned today/)).toBeTruthy()
    await user.click(await button("It’s fine"))
    expect(screen.queryByText(/planned today/)).toBeNull()
    expect(saved().planned).toHaveLength(1)
  })

  it("lists a routine that falls today, and marks it done", async () => {
    const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
    const code = weekdays[new Date().getDay()]
    seed(
      run([
        task("a", "Essay"),
        {
          type: "add-routine",
          routine: {
            id: "r",
            name: "Gym",
            emoji: "",
            color: "#3f6b52",
            duration: 60,
            rrule: `DTSTART:20200101T070000\nRRULE:FREQ=WEEKLY;BYDAY=${code}`,
            exdates: [],
            doneDates: [],
            createdAt: AT,
          },
        },
      ])
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Done in full: Gym"))
    expect(saved().routines[0].doneDates).toEqual([TODAY])
  })

  it("still offers one way back after time away", async () => {
    const state = run([task("a", "Essay")])
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...state,
        legacyMigrated: true,
        lastOpenedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      })
    )
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Pick up where you left off" })
    act(() => {})
  })
})

describe("the timeline's window", () => {
  const at = (hour: number) => {
    const date = new Date()
    date.setHours(hour, 0, 0, 0)
    return date
  }
  it("shows an hour before now, and the next four", () => {
    expect(timelineWindow(at(13))).toEqual({ first: 12, last: 17 })
  })
  it("stays inside the day", () => {
    expect(timelineWindow(at(23))).toEqual({ first: 19, last: 24 })
    expect(timelineWindow(at(0))).toEqual({ first: 0, last: 5 })
  })
})
