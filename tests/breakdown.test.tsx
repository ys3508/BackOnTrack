// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildBreakdownRequest } from "@/lib/recovery/context"
import {
  demoBreakdown,
  extractRequirements,
} from "@/lib/recovery/demo-breakdown"
import { TaskBreakdownRequestSchema } from "@/lib/schemas"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { currentSubtask, nextActionFor } from "@/lib/workspace/selectors"
import { restoreWorkspace } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = "2026-11-05"
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)
const seed = (title = "Finish my machine learning assignment") =>
  run([{ type: "create-task", id: "a", at: AT, title }])
const breakdown = (steps: string[]) => ({
  steps,
  note: "",
  ambiguities: [],
  source: "demo" as const,
  usedFallback: false,
  createdAt: AT,
})
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })

describe("demo breakdown", () => {
  const request = (title: string, extra = {}) => ({
    ...buildBreakdownRequest(seed(title).tasks[0], seed(title), TODAY),
    ...extra,
  })

  it("gives practical homework steps, not advice", () => {
    const { steps } = demoBreakdown(
      request("I haven't finished my homework for a long time")
    )
    expect(steps[0]).toMatch(/instructions/)
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect(steps.join(" ")).not.toMatch(
      /matters most|why this matters|priorities/i
    )
  })

  it("uses a job application template", () => {
    expect(demoBreakdown(request("Apply for jobs")).steps[0]).toMatch(
      /company and role/
    )
  })

  it("starts with the late policy for a missed deadline", () => {
    const state = run([
      {
        type: "create-task",
        id: "a",
        at: AT,
        title: "Biology essay",
        deadline: "2026-11-01",
      },
    ])
    const { steps } = demoBreakdown(
      buildBreakdownRequest(state.tasks[0], state, TODAY)
    )
    expect(steps[0]).toMatch(/late-work policy/)
  })

  it("starts smaller after a failed attempt", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "Biology essay" },
      { type: "report-stuck", id: "a", at: AT, text: "Too big" },
    ])
    const { steps } = demoBreakdown(
      buildBreakdownRequest(state.tasks[0], state, TODAY)
    )
    expect(steps[0]).toMatch(/one rough line/)
  })

  it("extracts requirements from instructions, marked as simple rules", () => {
    const state = workspaceReducer(seed(), {
      type: "edit-task",
      id: "a",
      at: AT,
      patch: { description: "x" },
    })
    const task = {
      ...state.tasks[0],
      instructions: {
        text: "Project brief.\n- Train a classifier on the dataset\n- Report the accuracy\nYou must submit a PDF by Friday.",
        sourceName: "",
        kind: "paste" as const,
        truncated: false,
        addedAt: AT,
      },
    }
    const result = demoBreakdown(buildBreakdownRequest(task, state, TODAY))
    expect(result.steps).toContain("Train a classifier on the dataset")
    expect(result.steps).toContain("Report the accuracy")
    expect(result.steps.join(" ")).toContain("You must submit a PDF")
    expect(result.note).toMatch(/simple text rules/)
  })

  it("handles instructions with nothing to extract", () => {
    expect(extractRequirements("Hello there.")).toEqual([])
    expect(extractRequirements("")).toEqual([])
  })

  it("makes a different plan after a rejection", () => {
    const first = demoBreakdown(request("Fix the bike")).steps
    const second = demoBreakdown(
      request("Fix the bike", { rejected: [first] })
    ).steps
    expect(second).not.toEqual(first)
  })

  it("builds a valid request, even with very long instructions", () => {
    const state = seed()
    const task = {
      ...state.tasks[0],
      instructions: {
        text: "x".repeat(50_000),
        sourceName: "",
        kind: "paste" as const,
        truncated: false,
        addedAt: AT,
      },
      workDoc: {
        content: `<p>${"y".repeat(50_000)}</p>`,
        updatedAt: AT,
        cursor: 0,
        previous: null,
      },
    }
    expect(
      TaskBreakdownRequestSchema.safeParse(
        buildBreakdownRequest(task, state, TODAY)
      ).success
    ).toBe(true)
  })
})

describe("subtasks are real, editable records", () => {
  const withSteps = () =>
    run(
      [
        {
          type: "set-breakdown",
          id: "a",
          at: AT,
          breakdown: breakdown(["One", "Two", "Three"]),
        },
        {
          type: "accept-breakdown",
          id: "a",
          at: AT,
          steps: [
            { id: "1", title: "One" },
            { id: "2", title: "Two" },
            { id: "3", title: "Three" },
          ],
        },
      ],
      seed()
    )

  it("does nothing to the task until a breakdown is accepted", () => {
    const state = run(
      [
        {
          type: "set-breakdown",
          id: "a",
          at: AT,
          breakdown: breakdown(["One"]),
        },
      ],
      seed()
    )
    expect(state.tasks[0].subtasks).toEqual([])
    expect(state.tasks[0].history.at(-1)?.kind).toBe("suggested")
    const declined = workspaceReducer(state, {
      type: "decline-breakdown",
      id: "a",
      at: AT,
    })
    expect(declined.tasks[0].subtasks).toEqual([])
    expect(declined.tasks[0].pendingBreakdown).toBeNull()
  })

  it("records accepted steps with their source", () => {
    const task = withSteps().tasks[0]
    expect(task.subtasks.map((sub) => sub.source)).toEqual([
      "demo",
      "demo",
      "demo",
    ])
    expect(task.history.at(-1)?.kind).toBe("accepted")
  })

  it("edits, reorders, deletes, adds, and completes", () => {
    let state = workspaceReducer(withSteps(), {
      type: "edit-subtask",
      id: "a",
      at: AT,
      subId: "2",
      title: " Two edited ",
    })
    state = workspaceReducer(state, {
      type: "move-subtask",
      id: "a",
      subId: "3",
      direction: -1,
    })
    expect(state.tasks[0].subtasks.map((sub) => sub.title)).toEqual([
      "One",
      "Three",
      "Two edited",
    ])
    state = workspaceReducer(state, {
      type: "remove-subtask",
      id: "a",
      at: AT,
      subId: "3",
    })
    state = workspaceReducer(state, {
      type: "add-subtask",
      id: "a",
      at: AT,
      subId: "4",
      title: "Four",
    })
    state = workspaceReducer(state, {
      type: "toggle-subtask",
      id: "a",
      at: AT,
      subId: "1",
    })
    const task = state.tasks[0]
    expect(task.subtasks.map((sub) => sub.id)).toEqual(["1", "2", "4"])
    expect(task.subtasks[0]).toMatchObject({ done: true, completedAt: AT })
    expect(task.progress).toBe(33)
    expect(task.history.at(-1)?.kind).toBe("completed")
    expect(currentSubtask(task)?.title).toBe("Two edited")
  })

  it("ignores moving past either end, and an empty edit", () => {
    const state = withSteps()
    const moved = workspaceReducer(state, {
      type: "move-subtask",
      id: "a",
      subId: "1",
      direction: -1,
    })
    expect(moved.tasks[0].subtasks.map((sub) => sub.id)).toEqual([
      "1",
      "2",
      "3",
    ])
    const edited = workspaceReducer(state, {
      type: "edit-subtask",
      id: "a",
      at: AT,
      subId: "1",
      title: "  ",
    })
    expect(edited.tasks[0].subtasks[0].title).toBe("One")
  })

  it("keeps finished steps when replanning, and replaces only the open ones", () => {
    let state = workspaceReducer(withSteps(), {
      type: "toggle-subtask",
      id: "a",
      at: AT,
      subId: "1",
    })
    state = workspaceReducer(state, {
      type: "set-breakdown",
      id: "a",
      at: AT,
      breakdown: breakdown(["New"]),
    })
    state = workspaceReducer(state, {
      type: "accept-breakdown",
      id: "a",
      at: AT,
      steps: [{ id: "9", title: "New" }],
    })
    const task = state.tasks[0]
    expect(task.subtasks.map((sub) => [sub.title, sub.done])).toEqual([
      ["One", true],
      ["New", false],
    ])
    expect(task.progress).toBe(50)
    expect(task.history.at(-1)?.text).toContain("kept 1 finished")
  })

  it("lets the user choose the current step", () => {
    const state = workspaceReducer(withSteps(), {
      type: "set-current-subtask",
      id: "a",
      at: AT,
      subId: "3",
    })
    expect(currentSubtask(state.tasks[0])?.title).toBe("Three")
    expect(nextActionFor(state.tasks[0])).toBe("Three")
  })
})

describe("data migration", () => {
  it("upgrades version 1 data, keeping everything and classifying its history", () => {
    const restored = restoreWorkspace({
      version: 1,
      tasks: [
        {
          id: "old",
          title: "Old task",
          status: "in-progress",
          createdAt: AT,
          updatedAt: AT,
          subtasks: [{ id: "s", title: "Old step", done: true }],
          documents: [
            {
              id: "d",
              title: "Old draft",
              body: "Keep me",
              source: "demo",
              updatedAt: AT,
            },
          ],
          history: [
            { id: "1", at: AT, type: "action", text: "Completed: Old thing" },
            {
              id: "2",
              at: AT,
              type: "focus",
              text: "Focus session completed (5 min)",
            },
            {
              id: "3",
              at: AT,
              type: "recovery",
              text: "Accepted a recovery plan",
            },
          ],
        },
      ],
      focusSessions: [
        {
          id: "f",
          taskId: "old",
          taskTitle: "Old task",
          plannedMinutes: 5,
          actualSeconds: 300,
          startedAt: AT,
          endedAt: AT,
          outcome: "completed",
        },
      ],
    })
    const [task] = restored.tasks
    expect(restored.version).toBe(2)
    expect(task.subtasks[0]).toMatchObject({
      title: "Old step",
      done: true,
      source: "user",
    })
    expect(task.documents[0].body).toBe("Keep me")
    expect(task.workDoc).toBeNull()
    expect(task.history.map((event) => event.kind)).toEqual([
      "completed",
      "attempted",
      "accepted",
    ])
    expect(restored.focusSessions[0].progressReport).toBeNull()
  })
})

describe("task screen and home", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.scrollTo = vi.fn() as typeof window.scrollTo
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ live: false, model: null }))
    )
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...seed(), legacyMigrated: true })
    )
  })

  it("previews, edits, and accepts a breakdown", async () => {
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Break this down"))
    const first = await screen.findByLabelText("Suggested step 1")
    expect(saved().tasks[0].subtasks).toEqual([])
    expect(screen.getByText(/prewritten, not AI-generated/)).toBeInTheDocument()

    fireEvent.change(first, { target: { value: "Read the brief twice" } })
    await user.click(
      screen.getByRole("button", { name: "Remove suggested step 2" })
    )
    await user.click(screen.getByRole("button", { name: "Add a step" }))
    const inputs = screen.getAllByLabelText(/Suggested step/)
    fireEvent.change(inputs.at(-1)!, { target: { value: "My own step" } })
    await user.click(
      screen.getByRole("button", { name: "Move suggested step 1 down" })
    )
    await user.click(await button("Add these steps"))

    const titles = saved().tasks[0].subtasks.map(
      (sub: { title: string }) => sub.title
    )
    expect(titles[1]).toBe("Read the brief twice")
    expect(titles.at(-1)).toBe("My own step")
    expect(titles).toHaveLength(6)
  })

  it("edits, reorders, completes, and deletes steps by keyboard-friendly controls", async () => {
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...run(
          [
            {
              type: "set-breakdown",
              id: "a",
              at: AT,
              breakdown: breakdown(["One", "Two"]),
            },
            {
              type: "accept-breakdown",
              id: "a",
              at: AT,
              steps: [
                { id: "1", title: "One" },
                { id: "2", title: "Two" },
              ],
            },
          ],
          seed()
        ),
        legacyMigrated: true,
      })
    )
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Edit steps"))
    await user.click(await button("Edit One"))
    await user.clear(screen.getByLabelText("Edit step"))
    await user.type(screen.getByLabelText("Edit step"), "One better{Enter}")
    await waitFor(() =>
      expect(saved().tasks[0].subtasks[0].title).toBe("One better")
    )

    await user.click(await button("Move Two up"))
    expect(saved().tasks[0].subtasks[0].title).toBe("Two")
    await user.click(screen.getByRole("checkbox", { name: /^Two/ }))
    expect(saved().tasks[0].subtasks[0].done).toBe(true)
    expect(screen.getByText("1 of 2 done")).toBeInTheDocument()
    await user.click(await button("Delete One better"))
    expect(saved().tasks[0].subtasks).toHaveLength(1)
  })

  it("shows one small step on the home page, with the rest behind a toggle", async () => {
    let state = run(
      [
        {
          type: "set-breakdown",
          id: "a",
          at: AT,
          breakdown: breakdown(["One", "Two", "Three"]),
        },
        {
          type: "accept-breakdown",
          id: "a",
          at: AT,
          steps: [
            { id: "1", title: "One" },
            { id: "2", title: "Second step" },
            { id: "3", title: "Third step" },
          ],
        },
      ],
      seed()
    )
    state = workspaceReducer(state, {
      type: "toggle-subtask",
      id: "a",
      at: AT,
      subId: "1",
    })
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
    window.location.hash = "#/today"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Continue where you left off" })
    expect(screen.getByText(/You completed 1 of 3 steps/)).toBeInTheDocument()
    expect(screen.getByText("Second step")).toBeInTheDocument()
    expect(screen.queryByText("Third step")).not.toBeInTheDocument()
    await user.click(await button("See all steps"))
    expect(screen.getByText("Third step")).toBeInTheDocument()
  })

  it("offers one step on a new task, without any list", async () => {
    window.location.hash = "#/today"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Your next small step" })
    expect(screen.getByText(/into small steps/)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "See all steps" })
    ).not.toBeInTheDocument()
  })
})

describe("requirement extraction", () => {
  it("doesn't read a list back as one long line", () => {
    const found = extractRequirements(
      "Assignment 3: Classification\n- Train a classifier\n- Report the accuracy\nYou must submit a PDF. Graded on clarity."
    )
    expect(found).toEqual([
      "Train a classifier",
      "Report the accuracy",
      "You must submit a PDF.",
      "Graded on clarity.",
    ])
  })
})
