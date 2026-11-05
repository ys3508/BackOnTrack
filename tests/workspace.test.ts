import { describe, expect, it } from "vitest"

import { initialSession } from "@/lib/session"
import { EMPTY_INTAKE } from "@/lib/intake"
import { addDays, deadlineText, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import {
  nextActionFor,
  recentActions,
  recommendTask,
  tasksNeedingAttention,
  upcomingDeadlines,
} from "@/lib/workspace/selectors"
import { restoreWorkspace, taskFromSession } from "@/lib/workspace/storage"

const AT = "2026-11-05T12:00:00.000Z"
const TODAY = "2026-11-05"

const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

const create = (
  id: string,
  extra: Partial<Extract<WorkspaceAction, { type: "create-task" }>> = {}
): WorkspaceAction => ({
  type: "create-task",
  id,
  at: AT,
  title: `Task ${id}`,
  ...extra,
})

const task = (state: Workspace, id = "a") =>
  state.tasks.find((item) => item.id === id)!

describe("task tracker", () => {
  it("creates a task with sensible defaults and a history entry", () => {
    const created = task(run([create("a", { title: "  Essay  " })]))
    expect(created).toMatchObject({
      title: "Essay",
      status: "not-started",
      priority: "none",
      progress: 0,
      deadline: null,
    })
    expect(created.history.map((event) => event.text)).toEqual(["Task created"])
  })

  it("supports every status, with pause and resume in the history", () => {
    let state = run([create("a")])
    for (const status of [
      "in-progress",
      "paused",
      "in-progress",
      "needs-recovery",
      "released",
      "completed",
    ] as const) {
      state = workspaceReducer(state, {
        type: "set-status",
        id: "a",
        at: AT,
        status,
      })
      expect(task(state).status).toBe(status)
    }
    expect(task(state).progress).toBe(100)
    expect(task(state).completedAt).toBe(AT)
    expect(task(state).history.at(2)?.text).toContain("Paused")
  })

  it("edits fields and records what changed", () => {
    const state = run([
      create("a"),
      {
        type: "edit-task",
        id: "a",
        at: AT,
        patch: { title: "Renamed", priority: "high", nextAction: "Call them" },
      },
    ])
    expect(task(state)).toMatchObject({
      title: "Renamed",
      priority: "high",
      nextAction: "Call them",
    })
    const text = task(state)
      .history.map((event) => event.text)
      .join(" | ")
    expect(text).toContain('Renamed to "Renamed"')
    expect(text).toContain("Priority set to High")
    expect(text).toContain("Next action set: Call them")
  })

  it("keeps the original deadline when the deadline changes", () => {
    const state = run([
      create("a", { deadline: "2026-11-10" }),
      { type: "set-deadline", id: "a", at: AT, deadline: "2026-11-20" },
    ])
    expect(task(state).deadline).toBe("2026-11-20")
    expect(task(state).originalDeadline).toBe("2026-11-10")
    expect(task(state).history.at(-1)?.text).toContain("changed from")
  })

  it("tracks progress, within bounds", () => {
    expect(
      task(
        run([
          create("a"),
          { type: "set-progress", id: "a", at: AT, progress: 140 },
        ])
      ).progress
    ).toBe(100)
  })

  it("updates progress from steps", () => {
    const state = run([
      create("a"),
      { type: "add-subtask", id: "a", at: AT, subId: "1", title: "One" },
      { type: "add-subtask", id: "a", at: AT, subId: "2", title: "Two" },
      { type: "toggle-subtask", id: "a", at: AT, subId: "1" },
    ])
    expect(task(state).progress).toBe(50)
    expect(task(state).history.at(-1)?.text).toBe("Completed: One")
  })

  it("completes the next action, then the next step, without completing the task", () => {
    let state = run([
      create("a"),
      { type: "edit-task", id: "a", at: AT, patch: { nextAction: "First" } },
      { type: "add-subtask", id: "a", at: AT, subId: "1", title: "Second" },
      { type: "complete-next-action", id: "a", at: AT },
    ])
    expect(task(state).nextAction).toBe("")
    expect(nextActionFor(task(state))).toBe("Second")
    state = workspaceReducer(state, {
      type: "complete-next-action",
      id: "a",
      at: AT,
    })
    expect(task(state).subtasks[0].done).toBe(true)
    expect(task(state).status).toBe("not-started")
  })

  it("deletes a task and its planned sessions", () => {
    const state = run([
      create("a"),
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "p",
          taskId: "a",
          date: TODAY,
          time: null,
          minutes: 25,
          label: "",
          done: false,
        },
      },
      { type: "delete-task", id: "a" },
    ])
    expect(state.tasks).toEqual([])
    expect(state.planned).toEqual([])
  })

  it("saves and edits documents", () => {
    const state = run([
      create("a"),
      {
        type: "save-document",
        id: "a",
        at: AT,
        docId: "d",
        title: "Draft",
        body: "One",
      },
      {
        type: "save-document",
        id: "a",
        at: AT,
        docId: "d",
        title: "Draft",
        body: "Two",
      },
    ])
    expect(task(state).documents).toHaveLength(1)
    expect(task(state).documents[0].body).toBe("Two")
  })
})

describe("workspace selectors", () => {
  it("recommends one task and honors Something else for the day", () => {
    let state = run([
      create("low", { priority: "low" }),
      create("soon", { deadline: addDays(TODAY, 1) }),
    ])
    expect(recommendTask(state, TODAY)?.id).toBe("soon")
    state = workspaceReducer(state, {
      type: "skip-recommendation",
      taskId: "soon",
      date: TODAY,
    })
    expect(recommendTask(state, TODAY)?.id).toBe("low")
    expect(recommendTask(state, addDays(TODAY, 1))?.id).toBe("soon")
  })

  it("never recommends paused or finished tasks", () => {
    const state = run([
      create("a"),
      create("b"),
      { type: "set-status", id: "a", at: AT, status: "paused" },
      { type: "set-status", id: "b", at: AT, status: "completed" },
    ])
    expect(recommendTask(state, TODAY)).toBeNull()
  })

  it("lists tasks needing attention, and upcoming deadlines in order", () => {
    const state = run([
      create("past", { deadline: addDays(TODAY, -3) }),
      create("later", { deadline: addDays(TODAY, 9) }),
      create("sooner", { deadline: addDays(TODAY, 2) }),
      create("far", { deadline: addDays(TODAY, 40) }),
      create("stuck"),
      { type: "set-status", id: "stuck", at: AT, status: "needs-recovery" },
    ])
    expect(tasksNeedingAttention(state, TODAY).map((t) => t.id)).toEqual([
      "stuck",
      "past",
    ])
    expect(upcomingDeadlines(state, TODAY).map((t) => t.id)).toEqual([
      "sooner",
      "later",
    ])
  })

  it("lists recently completed actions, newest first", () => {
    const state = run([
      create("a"),
      { type: "edit-task", id: "a", at: AT, patch: { nextAction: "Email" } },
      { type: "complete-next-action", id: "a", at: "2026-11-05T13:00:00.000Z" },
    ])
    expect(recentActions(state)[0].event.text).toBe("Completed: Email")
  })

  it("describes deadlines without alarm words", () => {
    expect(deadlineText(TODAY, TODAY)).toBe("Due today")
    expect(deadlineText(addDays(TODAY, -2), TODAY)).toContain("Deadline was")
    expect(deadlineText(addDays(TODAY, -2), TODAY)).not.toMatch(
      /overdue|late|missed/i
    )
  })

  it("uses the local calendar date", () => {
    expect(localToday(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02")
  })
})

describe("saved data", () => {
  it("survives anything unusable", () => {
    for (const raw of [null, "x", {}, { version: 2 }]) {
      expect(restoreWorkspace(raw)).toEqual(EMPTY_WORKSPACE)
    }
  })

  it("drops only the damaged items", () => {
    const good = task(run([create("a")]))
    const restored = restoreWorkspace({
      version: 1,
      tasks: [good, { id: "bad" }, "nope"],
      focusSessions: "x",
      planned: [{ nope: true }],
      timer: { broken: true },
      settings: { homeListSize: 99 },
      finishedSessionId: "missing",
    })
    expect(restored.tasks).toEqual([good])
    expect(restored.focusSessions).toEqual([])
    expect(restored.planned).toEqual([])
    expect(restored.timer).toBeNull()
    expect(restored.finishedSessionId).toBeNull()
    expect(restored.settings.homeListSize).toBe(3)
  })

  it("migrates an earlier guided session into a task without inventing progress", () => {
    const migrated = taskFromSession(
      {
        ...initialSession,
        intake: {
          ...EMPTY_INTAKE,
          responsibility: "I missed my homework",
          deadline: { type: "date", date: "2026-11-01" },
        },
        strategy: "REDUCE",
        steps: [
          {
            instruction: "Did this",
            approach: "decide",
            outcome: "completed",
            userText: "ok",
            note: "",
            source: "demo",
          },
          {
            instruction: "Not this",
            approach: "decide",
            outcome: "stuck",
            userText: "",
            note: "too big",
            source: "demo",
          },
        ],
      },
      "id",
      AT
    )!
    expect(migrated.status).toBe("in-progress")
    expect(migrated.deadline).toBe("2026-11-01")
    const text = migrated.history.map((event) => event.text).join(" | ")
    expect(text).toContain("Completed: Did this")
    expect(text).toContain("Tried: Not this")
    expect(text).not.toContain("Completed: Not this")
    expect(text).toContain("too big")
    expect(migrated.progress).toBe(0)
  })

  it("does not create a task from an empty session", () => {
    expect(taskFromSession(initialSession, "id", AT)).toBeNull()
  })
})
