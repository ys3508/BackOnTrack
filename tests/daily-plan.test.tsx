// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildDailyPlan } from "@/lib/planning/daily-plan"
import {
  rankTasks,
  reasonsFor,
  remainingMinutes,
} from "@/lib/planning/priority"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { exportWorkspace, parseImport } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
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
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = localToday()
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

const task = (
  id: string,
  title: string,
  extra: Partial<Extract<WorkspaceAction, { type: "create-task" }>> = {}
): WorkspaceAction => ({ type: "create-task", id, at: AT, title, ...extra })

/** The example from the review: a two-minute email and a longer assignment. */
const mixed = () =>
  run([
    task("essay", "History essay", {
      deadline: addDays(TODAY, 3),
      priority: "high",
      estimateMinutes: 120,
    }),
    task("email", "Reply to my advisor", { estimateMinutes: 5 }),
    task("later", "Tidy my notes"),
  ])

const plan = (
  state: Workspace,
  minutes = 60,
  energy: "low" | "okay" | "good" | null = null
) => buildDailyPlan({ state, today: TODAY, minutes, energy })

const seed = (state: Workspace) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...state, legacyMigrated: true })
  )

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/plan"
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("ordering tasks", () => {
  it("weighs more than the nearest deadline, and says why", () => {
    const state = run([
      task("soon", "Near but unimportant", { deadline: addDays(TODAY, 6) }),
      task("big", "Started and important", {
        deadline: addDays(TODAY, 6),
        priority: "high",
      }),
    ])
    const [first] = rankTasks(state, TODAY)
    expect(first.task.id).toBe("big")
    expect(first.reasons).toContain("You marked it high priority")
    expect(first.reasons).toContain("Due in 6 days")
  })

  it("always gives a reason, and doesn't alarm about a passed deadline", () => {
    const state = run([
      task("a", "Plain"),
      task("b", "Old", { deadline: addDays(TODAY, -4) }),
    ])
    expect(reasonsFor(state.tasks[0], state, TODAY)[0]).toContain(
      "No deadline or priority"
    )
    const text = reasonsFor(state.tasks[1], state, TODAY).join(" ")
    expect(text).toContain("worth checking")
    expect(text).not.toMatch(/overdue|late|missed/i)
  })

  it("leaves out paused and finished tasks", () => {
    const state = run([
      task("a", "Paused"),
      { type: "set-status", id: "a", at: AT, status: "paused" },
      task("b", "Done"),
      { type: "set-status", id: "b", at: AT, status: "completed" },
      task("c", "Open"),
    ])
    expect(rankTasks(state, TODAY).map((entry) => entry.task.id)).toEqual(["c"])
  })

  it("uses the user's estimate, shrinks it with progress, or admits it's a guess", () => {
    const state = run([
      task("a", "Known", { estimateMinutes: 60 }),
      { type: "set-progress", id: "a", at: AT, progress: 50 },
      task("b", "Unknown"),
      { type: "add-subtask", id: "b", at: AT, subId: "1", title: "One" },
      { type: "add-subtask", id: "b", at: AT, subId: "2", title: "Two" },
    ])
    expect(remainingMinutes(state.tasks[0])).toEqual({
      minutes: 30,
      known: true,
    })
    expect(remainingMinutes(state.tasks[1])).toEqual({
      minutes: 50,
      known: false,
    })
  })
})

describe("what today can hold", () => {
  it("puts a quick task before a longer one, as the review describes", () => {
    const { items } = plan(mixed())
    expect(items.map((item) => item.taskId)).toEqual([
      "email",
      "essay",
      "later",
    ])
    expect(items[0].reason).toContain("quick to clear")
    expect(items[1].minutes).toBeLessThan(120)
  })

  it("doesn't let something quick squeeze out what's due now", () => {
    const state = run([
      task("due", "Due today", { deadline: TODAY, estimateMinutes: 60 }),
      task("email", "Quick email", { estimateMinutes: 5 }),
    ])
    expect(plan(state, 30).items[0].taskId).toBe("due")
    expect(plan(state, 30).items.map((item) => item.taskId)).not.toContain(
      "email"
    )
  })

  it("gives what's due now the time, not whatever's left", () => {
    const state = run([
      task("due", "ML assignment", {
        deadline: addDays(TODAY, 1),
        priority: "high",
        estimateMinutes: 240,
      }),
      task("read", "Read a chapter", {
        deadline: addDays(TODAY, 5),
        estimateMinutes: 60,
      }),
      task("mail", "Reply to my advisor", { estimateMinutes: 5 }),
    ])
    const result = plan(state)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ taskId: "due", minutes: 50 })
    expect(result.notToday.map((item) => item.title)).toEqual([
      "Read a chapter",
      "Reply to my advisor",
    ])
    expect(result.risks[0]).toContain("Today’s plan gives it 50")
  })

  it("keeps that true even when the urgent work was missed before", () => {
    const state = run([
      task("due", "ML assignment", {
        deadline: addDays(TODAY, 1),
        estimateMinutes: 240,
      }),
      {
        type: "add-subtask",
        id: "due",
        at: AT,
        subId: "1",
        title: "Train a classifier",
      },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "p",
          taskId: "due",
          date: addDays(TODAY, -1),
          time: null,
          minutes: 25,
          label: "",
          done: false,
        },
      },
    ])
    const [item] = plan(state).items
    expect(item.minutes).toBe(50)
    expect(item.action).toBe("Open the dataset and identify the target column")
    expect(item.reason).toContain("it gets most of today")
  })

  it("names a task with no steps plainly, without asking to break it down", () => {
    const { items } = plan(mixed())
    const email = items.find((item) => item.taskId === "email")!
    expect(email.action).toBe("Reply to my advisor")
  })

  it("never plans more than the time available", () => {
    for (const minutes of [15, 30, 60, 120, 180]) {
      const { items, usableMinutes } = plan(mixed(), minutes)
      const total = items.reduce((sum, item) => sum + item.minutes, 0)
      expect(total).toBeLessThanOrEqual(usableMinutes)
      expect(usableMinutes).toBeLessThan(minutes)
    }
  })

  it("asks less of a low-energy day, and works without saying anything", () => {
    const state = run([
      task("a", "One", { estimateMinutes: 120 }),
      task("b", "Two", { estimateMinutes: 120 }),
      task("c", "Three", { estimateMinutes: 120 }),
    ])
    const low = plan(state, 120, "low")
    const unsaid = plan(state, 120, null)
    expect(low.items).toHaveLength(2)
    expect(low.items[0].minutes).toBe(15)
    expect(low.usableMinutes).toBeLessThan(unsaid.usableMinutes)
    expect(unsaid.items.length).toBeGreaterThan(low.items.length)
  })

  it("lists what isn't included, and flags a deadline at risk without changing it", () => {
    const state = run([
      task("due", "Lab report", {
        deadline: addDays(TODAY, 1),
        estimateMinutes: 240,
      }),
      task("other", "Tidy notes"),
    ])
    const result = plan(state, 15)
    expect(result.notToday.map((item) => item.title)).toContain("Tidy notes")
    expect(result.risks[0]).toContain("Lab report")
    expect(result.risks[0]).toContain("due tomorrow")
    expect(state.tasks[0].deadline).toBe(addDays(TODAY, 1))
  })

  it("admits when the size of a task at risk is a guess", () => {
    const state = run([task("due", "Lab", { deadline: TODAY })])
    expect(plan(state, 15).risks[0]).toContain("rough guess")
  })

  it("rethinks unfinished work instead of just moving it", () => {
    const earlier = addDays(TODAY, -1)
    const state = run(
      [
        task("a", "Essay", { estimateMinutes: 120 }),
        {
          type: "add-subtask",
          id: "a",
          at: AT,
          subId: "1",
          title: "Write the introduction",
        },
        task("b", "Notes", { estimateMinutes: 120 }),
        {
          type: "set-daily-plan",
          plan: {
            date: earlier,
            minutes: 60,
            energy: null,
            createdAt: AT,
            items: [
              {
                taskId: "a",
                subtaskId: "1",
                title: "Essay",
                action: "Write the introduction",
                minutes: 25,
                reason: "",
                done: false,
              },
            ],
          },
        },
      ],
      EMPTY_WORKSPACE
    )
    const result = plan(state)
    const essay = result.items.find((item) => item.taskId === "a")!
    expect(result.unfinished).toBe(1)
    expect(essay.minutes).toBe(10)
    expect(essay.reason).toContain("starts small instead of just moving it")
    expect(essay.action).not.toBe("Write the introduction")
    expect(state.tasks[0].deadline).toBeNull()
    expect(state.tasks[0].status).not.toBe("needs-recovery")
  })

  it("counts a missed planned session as unfinished, but not one still to come", () => {
    const planned = (date: string): WorkspaceAction => ({
      type: "add-planned",
      at: AT,
      session: {
        id: date,
        taskId: "a",
        date,
        time: null,
        minutes: 25,
        label: "",
        done: false,
      },
    })
    const base = run([task("a", "Essay")])
    expect(plan(run([planned(addDays(TODAY, -1))], base)).unfinished).toBe(1)
    expect(plan(run([planned(addDays(TODAY, 1))], base)).unfinished).toBe(0)
  })
})

describe("the plan itself", () => {
  const today = () =>
    run(
      [
        {
          type: "set-daily-plan",
          plan: {
            date: TODAY,
            minutes: 60,
            energy: null,
            createdAt: AT,
            items: plan(mixed()).items,
          },
        },
      ],
      mixed()
    )

  it("survives a backup, and drops a deleted task", () => {
    expect(
      parseImport(exportWorkspace(today()))?.dailyPlan?.items
    ).toHaveLength(3)
    const old = { ...today(), dailyPlan: undefined } as unknown as Workspace
    expect(parseImport(exportWorkspace(old))?.dailyPlan).toBeNull()
    const after = workspaceReducer(today(), {
      type: "delete-task",
      id: "email",
    })
    expect(after.dailyPlan?.items.map((item) => item.taskId)).toEqual([
      "essay",
      "later",
    ])
  })

  it("doesn't complete a task when its item for today is done", () => {
    const after = workspaceReducer(today(), {
      type: "toggle-daily-item",
      taskId: "essay",
    })
    expect(
      after.dailyPlan?.items.find((item) => item.taskId === "essay")?.done
    ).toBe(true)
    expect(after.tasks.find((item) => item.id === "essay")?.status).toBe(
      "not-started"
    )
  })
})

describe("in the app", () => {
  it("isn't offered with fewer than two tasks", async () => {
    seed(run([task("a", "Only one")]))
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { level: 1 })
    expect(screen.queryByRole("button", { name: "Plan my day" })).toBeNull()
  })

  it("shows the suggested order with reasons on Tasks, and can switch it off", async () => {
    seed(
      run([
        task("low", "First added"),
        task("high", "Second added", { priority: "high" }),
      ])
    )
    window.location.hash = "#/tasks"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByText(/Why here: You marked it high priority/)
    const titles = () =>
      screen
        .getAllByRole("listitem")
        .map((item) => item.textContent)
        .filter((text) => /added/.test(text ?? ""))
    expect(titles()[0]).toContain("Second added")
    await user.click(screen.getByRole("button", { name: "As added" }))
    expect(titles()[0]).toContain("First added")
    expect(screen.queryByText(/Why here/)).toBeNull()
  })

  it("lets a time estimate be added and changed", async () => {
    window.location.hash = "#/tasks"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.type(await screen.findByLabelText("New task"), "Call the bank")
    await user.selectOptions(
      screen.getByLabelText("Time needed (optional)"),
      "15"
    )
    await user.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(saved().tasks[0].estimateMinutes).toBe(15))
    expect(screen.getByLabelText("Time needed (optional)")).toHaveValue("")
  })
})
