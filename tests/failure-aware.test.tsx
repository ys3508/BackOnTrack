// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import axe from "axe-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { buildRecoveryRequest } from "@/lib/recovery/context"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import { ownWords, taskKindOf } from "@/lib/workspace/friction"
import {
  MIN_EVIDENCE,
  activePatterns,
  detectPatterns,
  guidanceFor,
  hintFor,
} from "@/lib/workspace/patterns"
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
vi.mock("@fullcalendar/rrule", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
// Real dates, because patterns only look at the last 60 days.
const NOW = Date.now()
const AT = new Date(NOW).toISOString()
const TODAY = AT.slice(0, 10)
const DAY = 24 * 60 * 60 * 1000
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const run = (actions: WorkspaceAction[], start: Workspace = EMPTY_WORKSPACE) =>
  actions.reduce(workspaceReducer, start)

/** Each call is 90 minutes later than the last, so they're separate moments. */
let tick = 0
const later = () =>
  new Date(NOW - (400 - ++tick) * 90 * 60 * 1000).toISOString()

const create = (id: string, title = "Write my essay"): WorkspaceAction => ({
  type: "create-task",
  id,
  at: AT,
  title,
})
const stuck = (id = "a", at: string = later()): WorkspaceAction => ({
  type: "report-stuck",
  id,
  at,
  text: "",
})
const help = (
  kind: "outline" | "smaller-steps",
  id = "a"
): WorkspaceAction => ({
  type: "log-help",
  id,
  at: AT,
  helpKind: kind,
})
const step = (subId: string, id = "a"): WorkspaceAction[] => [
  { type: "add-subtask", id, at: AT, subId, title: `Step ${subId}` },
  { type: "toggle-subtask", id, at: AT, subId },
]
const session = (sessionId: string, seconds: number): WorkspaceAction[] => [
  {
    type: "timer-start",
    id: sessionId,
    kind: "focus",
    taskId: "a",
    minutes: 5,
    now: 0,
    at: AT,
  },
  {
    type: "timer-stop",
    now: seconds * 1000,
    at: later(),
    outcome: "continue-later",
    note: "",
  },
]
const threeStuck = () => run([create("a"), stuck(), stuck(), stuck()])

const ids = (state: Workspace) =>
  detectPatterns(state, NOW).map((item) => item.id)
const guidance = (state: Workspace, id = "a") => {
  const task = state.tasks.find((item) => item.id === id)!
  return guidanceFor(state, task, taskKindOf(task), NOW)
}
const planFor = (state: Workspace) =>
  demoTaskRecovery(buildRecoveryRequest(state.tasks[0], state, TODAY, {})).plan

const seed = (state: Workspace) =>
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...state, legacyMigrated: true })
  )

async function getEditor(): Promise<Editor> {
  await waitFor(() =>
    expect(document.querySelector(".ProseMirror")).toBeTruthy()
  )
  return (
    document.querySelector(".ProseMirror") as unknown as { editor: Editor }
  ).editor
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/today"
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("not claiming too much", () => {
  it("says nothing until there are enough similar moments", () => {
    expect(MIN_EVIDENCE).toBe(3)
    expect(ids(run([create("a"), stuck(), stuck()]))).toEqual([])
    expect(ids(threeStuck())).toContain("blank-start")
  })

  it("treats repeated clicks in one moment as one", () => {
    const at = later()
    const state = run([
      create("a"),
      stuck("a", at),
      stuck("a", at),
      stuck("a", at),
    ])
    expect(state.frictionLog).toHaveLength(3)
    expect(ids(state)).toEqual([])
    // A different task at the same time is still a separate moment.
    expect(
      ids(
        run([
          create("a"),
          create("b"),
          create("c"),
          stuck("a", at),
          stuck("b", at),
          stuck("c", at),
        ])
      )
    ).toContain("blank-start")
  })

  it("forgets moments older than 60 days", () => {
    const old = new Date(NOW - 61 * DAY).toISOString()
    const state = run([create("a"), stuck("a", old), stuck("a", old), stuck()])
    expect(ids(state)).toEqual([])
  })

  it("needs more than one task to call it a kind of task", () => {
    expect(ids(threeStuck())).not.toContain("kind-stuck:writing")
    const two = run([
      create("a"),
      create("b"),
      stuck("a"),
      stuck("a"),
      stuck("b"),
    ])
    expect(ids(two)).toContain("kind-stuck:writing")
  })

  it("doesn't shame, diagnose, or claim to know the cause", () => {
    const state = run([
      create("a"),
      create("b"),
      stuck("a"),
      stuck("a"),
      stuck("b"),
      ...session("s1", 2),
      ...session("s2", 2),
      ...session("s3", 2),
      help("outline"),
      ...step("1"),
      help("outline"),
      ...step("2"),
      help("outline"),
      ...step("3"),
    ])
    const text = detectPatterns(state, NOW)
      .map((item) => `${item.title} ${item.evidence}`)
      .join(" ")
    expect(text.length).toBeGreaterThan(50)
    expect(text).not.toMatch(
      /lazy|fail|should have|you always|you never|adhd|disorder|procrastinat/i
    )
    expect(text).toContain("doesn’t prove")
  })
})

describe("what gets recorded", () => {
  it("holds no task text, and goes when its task is deleted", () => {
    const state = run([
      create("a", "Private medical letter"),
      {
        type: "report-stuck",
        id: "a",
        at: AT,
        text: "I feel awful about this",
      },
    ])
    const log = JSON.stringify(state.frictionLog)
    expect(state.frictionLog).toHaveLength(1)
    expect(log).not.toMatch(/medical|awful/)
    expect(
      workspaceReducer(state, { type: "delete-task", id: "a" }).frictionLog
    ).toEqual([])
  })

  it("counts only the user's own words", () => {
    const html =
      '<p>My own words here</p><p><span data-suggested="true">Suggested text that is long</span></p><pre><code>print(1)</code></pre>'
    expect(ownWords(html)).toBe(4)
  })

  it("records nothing when switched off, but keeps a stated preference", () => {
    const state = run([
      create("a"),
      {
        type: "learning",
        patch: { enabled: false, preferred: "smaller-steps" },
      },
      stuck(),
      stuck(),
      stuck(),
    ])
    expect(state.frictionLog).toEqual([])
    expect(detectPatterns(state, NOW)).toEqual([])
    expect(guidance(state).preferred).toBe("smaller-steps")
  })

  it("survives a backup, and old data starts empty", () => {
    const state = threeStuck()
    expect(parseImport(exportWorkspace(state))?.frictionLog).toHaveLength(3)
    const old = {
      ...state,
      frictionLog: undefined,
      learning: undefined,
    } as unknown as Workspace
    const restored = parseImport(exportWorkspace(old))!
    expect(restored.frictionLog).toEqual([])
    expect(restored.learning.enabled).toBe(true)
  })
})

describe("patterns", () => {
  it("notices sessions that keep stopping early, not ones that don't", () => {
    const early = run([
      create("a"),
      ...session("1", 2),
      ...session("2", 200),
      ...session("3", 3),
      ...session("4", 4),
    ])
    expect(ids(early)).toContain("focus-early")
    expect(
      detectPatterns(early, NOW).find((item) => item.id === "focus-early")
        ?.evidence
    ).toContain("3 of your last 4")
    const fine = run([
      create("a"),
      ...session("1", 200),
      ...session("2", 200),
      ...session("3", 200),
    ])
    expect(ids(fine)).not.toContain("focus-early")
  })

  it("notices repeated moving without progress, and progress resets it", () => {
    const moves = (date: string, id: string): WorkspaceAction => ({
      type: "move-planned",
      id,
      at: later(),
      date,
      time: null,
    })
    const planned: WorkspaceAction = {
      type: "add-planned",
      at: AT,
      session: {
        id: "p",
        taskId: "a",
        date: "2030-01-01",
        time: null,
        minutes: 25,
        label: "",
        done: false,
      },
    }
    const state = run([
      create("a"),
      planned,
      moves("2030-01-02", "p"),
      moves("2030-01-03", "p"),
      moves("2030-01-04", "p"),
    ])
    expect(ids(state)).toContain("moved:a")
    // Moving something earlier isn't putting it off.
    expect(ids(run([moves("2029-01-01", "p")], state))).toContain("moved:a")
    expect(
      state.frictionLog.filter((item) => item.kind === "moved")
    ).toHaveLength(3)

    const afterMoves = new Date(NOW + 5000).toISOString()
    const progressed = run(
      [
        {
          type: "add-subtask",
          id: "a",
          at: afterMoves,
          subId: "1",
          title: "One",
        },
        { type: "toggle-subtask", id: "a", at: afterMoves, subId: "1" },
      ],
      state
    )
    expect(ids(progressed)).not.toContain("moved:a")
  })

  it("learns which help was followed by progress", () => {
    const state = run([
      create("a"),
      help("outline"),
      ...step("1"),
      help("outline"),
      ...step("2"),
      help("outline"),
      ...step("3"),
      help("outline"),
      stuck(),
    ])
    const found = detectPatterns(state, NOW).find(
      (item) => item.id === "help-works:outline"
    )
    expect(found?.evidence).toContain("3 of 4 times")
    expect(guidance(state).preferred).toBe("outline")
  })

  it("gives the reason behind its choice first", () => {
    const state = run([
      create("a"),
      stuck(),
      stuck(),
      stuck(),
      help("outline"),
      ...step("1"),
      help("outline"),
      ...step("2"),
      help("outline"),
      ...step("3"),
    ])
    expect(guidance(state).preferred).toBe("outline")
    expect(guidance(state).notes[0]).toContain("An outline seems to help")
  })

  it("learns which help hasn't helped, and steps away from it", () => {
    const state = run([
      create("a"),
      { type: "add-subtask", id: "a", at: AT, subId: "1", title: "Write it" },
      help("smaller-steps"),
      stuck(),
      help("smaller-steps"),
      stuck(),
      help("smaller-steps"),
      stuck(),
    ])
    expect(ids(state)).toContain("help-stalled:smaller-steps")
    expect(guidance(state).avoid).toEqual(["smaller-steps"])
    const plan = planFor(
      workspaceReducer(state, {
        type: "learning",
        patch: { dismissed: ["blank-start"] },
      })
    )
    expect(plan.smallerSteps).toEqual([])
  })

  it("counts only the first outcome after help", () => {
    const state = run([create("a"), help("outline"), ...step("1"), stuck()])
    const entry = state.frictionLog.find((item) => item.kind === "help")
    expect(entry?.outcome).toBe("progress")
  })

  it("counts writing after help as progress, once it's the user's own", () => {
    const save = (content: string): WorkspaceAction => ({
      type: "save-work-doc",
      id: "a",
      at: AT,
      content,
      cursor: 1,
    })
    const suggested = save(
      '<p><span data-suggested="true">A long suggested paragraph of text here</span></p>'
    )
    const after = run([create("a"), help("outline"), suggested])
    expect(after.frictionLog.at(-1)?.outcome).toBeNull()
    const wrote = workspaceReducer(
      after,
      save("<p>Now I have written five whole words</p>")
    )
    expect(wrote.frictionLog.at(-1)?.outcome).toBe("progress")
  })
})

describe("changing the approach", () => {
  it("offers a prepared document first, and says why", () => {
    const plan = planFor(threeStuck())
    expect(plan.headline).toBe("Start from a prepared document")
    expect(plan.artifact.body).toContain("## Questions to answer")
    expect(plan.adaptationNote).toContain("Based on your records")
    expect(plan.adaptationNote).toContain("3 separate occasions")
  })

  it("doesn't change anything without evidence", () => {
    const plan = planFor(run([create("a"), stuck()]))
    expect(plan.headline).not.toBe("Start from a prepared document")
    expect(plan.adaptationNote).not.toContain("Based on your records")
  })

  it("leaves a document with text in it alone", () => {
    const state = workspaceReducer(threeStuck(), {
      type: "save-work-doc",
      id: "a",
      at: AT,
      content: "<p>Already started</p>",
      cursor: 1,
    })
    expect(planFor(state).headline).not.toBe("Start from a prepared document")
    expect(hintFor(state, state.tasks[0], "writing", NOW)?.action).not.toBe(
      "setup"
    )
  })

  it("follows a stated preference straight away, with no records", () => {
    const state = run([
      create("a"),
      { type: "learning", patch: { preferred: "prepared" } },
    ])
    expect(planFor(state).headline).toBe("Start from a prepared document")
    expect(guidance(state).notes[0]).toContain("They said they prefer")
  })

  it("stops using a pattern the user says is wrong", () => {
    const state = workspaceReducer(threeStuck(), {
      type: "learning",
      patch: { dismissed: ["blank-start"] },
    })
    expect(activePatterns(state, NOW)).toEqual([])
    expect(detectPatterns(state, NOW)).toHaveLength(1)
    expect(planFor(state).headline).not.toBe("Start from a prepared document")
    expect(guidance(state).notes).toEqual([])
  })

  it("tells the model only when there's something to say", () => {
    const request = (state: Workspace) =>
      buildRecoveryRequest(state.tasks[0], state, TODAY, {}).task
    expect(request(run([create("a")])).learned).toEqual([])
    expect(request(threeStuck()).learned[0]).toContain("Empty documents")
    expect(request(threeStuck()).preferredHelp).toBe("prepared")
  })
})

describe("in the app", () => {
  it("records help accepted through the interface", async () => {
    seed(
      run([
        create("a", "Train a classifier"),
        {
          type: "add-subtask",
          id: "a",
          at: AT,
          subId: "1",
          title: "Train a classifier",
        },
      ])
    )
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await getEditor()
    await user.click(await button("Help me do this"))
    await user.click(await button("Use this"))
    await waitFor(() =>
      expect(saved().frictionLog.at(-1)).toMatchObject({
        kind: "help",
        helpKind: "smaller-steps",
        outcome: null,
      })
    )
  })

  it("shows a hint with its evidence, and acts on it", async () => {
    seed(
      run(
        [
          {
            type: "add-subtask",
            id: "a",
            at: AT,
            subId: "1",
            title: "Write it",
          },
        ],
        threeStuck()
      )
    )
    window.location.hash = "#/tasks/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    const hint = await screen.findByRole("region", {
      name: "Something BackOnTrack noticed",
    })
    expect(
      within(hint).getByText(/3 separate occasions recently/)
    ).toBeInTheDocument()
    expect(within(hint).getByText(/not AI and not a diagnosis/)).toBeTruthy()
    await user.click(
      within(hint).getByRole("button", {
        name: "Start from a prepared document",
      })
    )
    await user.click(await button("Edit the first section"))
    expect(editor.getText()).toContain("Questions to answer")
    // Steps the task already had aren't offered again.
    expect(screen.queryByLabelText("Suggested step 1")).toBeNull()
    expect(saved().tasks[0].subtasks).toHaveLength(1)
  })

  it("drops the hint when the user says it isn't right", async () => {
    seed(
      run(
        [
          {
            type: "add-subtask",
            id: "a",
            at: AT,
            subId: "1",
            title: "Write it",
          },
        ],
        threeStuck()
      )
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const hint = await screen.findByRole("region", {
      name: "Something BackOnTrack noticed",
    })
    await user.click(
      within(hint).getByRole("button", { name: "This isn’t right" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Something BackOnTrack noticed" })
      ).toBeNull()
    )
    await waitFor(() =>
      expect(saved().learning.dismissed).toEqual(["blank-start"])
    )
  })

  it("explains itself plainly when there's nothing yet", async () => {
    seed(run([create("a"), stuck()]))
    window.location.hash = "#/settings"
    render(<WorkspaceApp />)
    expect(
      await screen.findByText(/at least 3 separate moments/)
    ).toBeInTheDocument()
  })

  it("lets the user see, correct, and delete everything in Settings", async () => {
    seed(threeStuck())
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)

    const noticed = await screen.findByRole("list", {
      name: "What’s been noticed",
    })
    expect(within(noticed).getByText(/Empty documents/)).toBeInTheDocument()

    await user.selectOptions(
      screen.getByLabelText("When I need a place to start, I prefer"),
      "outline"
    )
    await waitFor(() => expect(saved().learning.preferred).toBe("outline"))

    await user.click(await button(/See the 3 records/))
    const records = screen.getByRole("list", { name: "Records" })
    expect(within(records).getAllByRole("listitem")).toHaveLength(3)
    await user.click(
      within(records).getAllByRole("button", { name: /Delete record/ })[0]
    )
    await waitFor(() => expect(saved().frictionLog).toHaveLength(2))
    // Now below the minimum, so the pattern is gone too.
    expect(
      screen.queryByRole("list", { name: "What’s been noticed" })
    ).toBeNull()

    await user.click(await button("Delete these records"))
    await user.click(await button("Delete records"))
    await waitFor(() => expect(saved().frictionLog).toEqual([]))
    expect(saved().learning.preferred).toBe("outline")

    await user.click(screen.getByLabelText("Learn from my activity"))
    await waitFor(() => expect(saved().learning.enabled).toBe(false))
    expect(screen.getByText(/Learning is off/)).toBeInTheDocument()
  })

  it("can bring back something dismissed", async () => {
    seed(
      workspaceReducer(threeStuck(), {
        type: "learning",
        patch: { dismissed: ["blank-start"] },
      })
    )
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/Bring back 1/))
    expect(
      await screen.findByRole("list", { name: "What’s been noticed" })
    ).toBeInTheDocument()
  })

  it.each([
    ["settings", "#/settings"],
    ["home with a hint", "#/today"],
  ])("has no accessibility violations on %s", async (_name, hash) => {
    seed(
      run(
        [
          {
            type: "add-subtask",
            id: "a",
            at: AT,
            subId: "1",
            title: "Write it",
          },
        ],
        threeStuck()
      )
    )
    window.location.hash = hash
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText(/Empty documents/)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const { violations } = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(violations.map((item) => item.id)).toEqual([])
  })
})
