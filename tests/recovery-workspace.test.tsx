// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = localToday()
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)

function stubFetch(live = false, post?: (body: unknown) => Response) {
  const mock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method && post
      ? post(JSON.parse(init.body as string))
      : Response.json({ live, model: live ? "test-model" : null })
  )
  vi.stubGlobal("fetch", mock)
  return mock
}

function seed(title: string, deadline: string | null = null) {
  const state = workspaceReducer(EMPTY_WORKSPACE, {
    type: "create-task",
    id: "a",
    at: AT,
    title,
    deadline,
  })
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...state, legacyMigrated: true })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ""
  window.scrollTo = vi.fn() as typeof window.scrollTo
})

describe("definition of done", () => {
  it("takes a real task from adding it to returning later, all in one app", async () => {
    const posts = stubFetch()
    const user = userEvent.setup()
    const { unmount } = render(<WorkspaceApp />)

    // 1. Add a real task.
    await user.type(
      await screen.findByLabelText("New task"),
      "Finish my biology homework"
    )
    await user.click(screen.getByRole("button", { name: "Add" }))

    // 2. See it in the workspace.
    await screen.findByRole("heading", { name: "Your next small step" })
    await user.click(await button("Finish my biology homework"))

    // 3. View and modify its deadline.
    const due = addDays(TODAY, 5)
    fireEvent.change(await screen.findByLabelText("Deadline"), {
      target: { value: due },
    })
    expect(saved().tasks[0].deadline).toBe(due)

    // 4. Start a focus session for it.
    await user.click(await button("10-minute Focus"))
    await screen.findByRole("timer")
    expect(saved().tasks[0].status).toBe("in-progress")

    // 5. Pause and resume work.
    await user.click(await button("Pause timer"))
    expect(saved().timer.runningSince).toBeNull()
    await user.click(await button("Resume timer"))
    expect(saved().timer.runningSince).not.toBeNull()

    // Stop early, and report getting stuck.
    await user.click(await button("Stop"))
    await user.click(await button("I got stuck"))
    await user.type(
      screen.getByLabelText(/What got in the way/),
      "Can't find the worksheet"
    )
    await user.click(await button("Find another way in"))
    expect(saved().tasks[0].status).toBe("needs-recovery")

    // 7. Request a recovery plan after getting stuck. No task data changes yet.
    await user.click(await button("Get a recovery plan"))
    const planHeading = await screen.findByRole("heading", { level: 1 })
    expect(planHeading).not.toHaveTextContent("Let’s find a way back")
    expect(screen.getByText(/prewritten, not AI-generated/)).toBeInTheDocument()
    const before = saved().tasks[0]
    expect(before.documents).toEqual([])
    expect(before.subtasks).toEqual([])
    expect(saved().planned).toEqual([])

    // The draft can be edited in place before accepting.
    const draft = screen.getByLabelText(/Your draft/)
    expect((draft as HTMLTextAreaElement).value).toContain(
      "Finish my biology homework"
    )
    fireEvent.change(draft, { target: { value: "My edited draft" } })

    // 8. Accept the suggestion.
    await user.click(await button("Add selected to my task"))
    await screen.findByRole("heading", { name: "Finish my biology homework" })
    const after = saved().tasks[0]
    expect(after.documents[0]).toMatchObject({
      body: "My edited draft",
      source: "demo",
    })
    expect(after.subtasks.length).toBeGreaterThan(0)
    expect(after.nextAction).not.toBe("")
    expect(after.status).toBe("in-progress")
    expect(saved().planned.length).toBeGreaterThan(0)
    expect(after.deadline).toBe(due)

    // 6. Mark progress.
    fireEvent.change(screen.getByLabelText("Progress"), {
      target: { value: "40" },
    })
    expect(saved().tasks[0].progress).toBe(40)

    // 9. View the updated task and session history.
    expect(
      screen.getByText(/of 10 min on Finish my biology homework/)
    ).toBeInTheDocument()
    const history = screen.getByRole("heading", {
      name: "History",
    }).parentElement!
    expect(history).toHaveTextContent("Progress set to 40%")
    await user.click(within(history).getByRole("button", { name: /Show all/ }))
    expect(history).toHaveTextContent(
      "Accepted a recovery plan from Demo Mode template"
    )
    expect(history).toHaveTextContent("Can't find the worksheet")
    expect(history).toHaveTextContent("got stuck")

    // 10. Return later and continue from saved progress.
    unmount()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Finish my biology homework" })
    expect(screen.getByLabelText("Progress")).toHaveValue("40")
    expect(screen.getByDisplayValue("My edited draft")).toBeInTheDocument()

    // Demo Mode made no POST requests at any point.
    expect(posts.mock.calls.filter(([, init]) => init?.method)).toEqual([])
  })
})

describe("previewing suggestions", () => {
  it("applies only what the user keeps selected", async () => {
    stubFetch()
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    await screen.findByLabelText(/Your draft/)
    await user.click(
      screen.getByRole("checkbox", { name: "Save this draft to the task" })
    )
    await user.click(
      screen.getByRole("checkbox", { name: "Make this my next action" })
    )
    const stepBoxes = within(
      screen.getByRole("heading", { name: "Steps to add" }).parentElement!
    ).getAllByRole("checkbox")
    await user.click(stepBoxes[0])
    const scheduleBoxes = within(
      screen.getByRole("heading", { name: "Work sessions to plan" })
        .parentElement!
    ).getAllByRole("checkbox")
    for (const box of scheduleBoxes) await user.click(box)
    await user.click(await button("Add selected to my task"))
    const task = saved().tasks[0]
    expect(task.documents).toEqual([])
    expect(task.nextAction).toBe("")
    expect(task.subtasks).toHaveLength(stepBoxes.length - 1)
    expect(saved().planned).toEqual([])
  })

  it("changes nothing but the history when declined", async () => {
    stubFetch()
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    await screen.findByLabelText(/Your draft/)
    await user.click(await button("No thanks"))
    await screen.findByRole("heading", { name: "Do my homework" })
    const task = saved().tasks[0]
    expect(task.documents).toEqual([])
    expect(task.subtasks).toEqual([])
    expect(task.nextAction).toBe("")
    expect(task.recovery).toBeNull()
    expect(task.rejectedPlans).toHaveLength(1)
    expect(saved().planned).toEqual([])
    expect(task.history.at(-1).text).toContain("Declined")
  })

  it("gives a different plan when still stuck", async () => {
    stubFetch()
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    const first = (await screen.findByRole("heading", { level: 1 })).textContent
    await user.click(await button(/Still stuck/))
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe(
        first
      )
    )
    expect(
      screen.getByText(/didn't fit, so this is a different approach/)
    ).toBeInTheDocument()
  })

  it("keeps a pending plan after a reload, for recovery after an interruption", async () => {
    stubFetch()
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    const { unmount } = render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    await screen.findByLabelText(/Your draft/)
    unmount()
    render(<WorkspaceApp />)
    expect(await screen.findByLabelText(/Your draft/)).toBeInTheDocument()
  })

  it("shows the Reality Check and lets the user override the strategy", async () => {
    stubFetch()
    seed("Clean the garage")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    await user.click(await button(/See why/))
    for (const name of [
      "Known facts",
      "Assumptions",
      "Unknowns",
      "Potential consequences",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByRole("radio", { name: /reduce/i })).toBeChecked()
    await user.click(screen.getByRole("radio", { name: /release/i }))
    await screen.findByRole("heading", { name: "Let this go cleanly" })
    expect(saved().tasks[0].status).toBe("not-started")

    await user.click(
      screen.getByRole("checkbox", { name: /mark this task as Released/ })
    )
    await user.click(await button("Add selected to my task"))
    await waitFor(() => expect(saved().tasks[0].status).toBe("released"))
  })

  it("won't release a high-stakes task without an acknowledgement", async () => {
    stubFetch()
    seed("File my taxes")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Get a recovery plan"))
    await user.click(await button(/See why/))
    await user.click(screen.getByRole("radio", { name: /release/i }))
    await screen.findByRole("heading", { name: "Let this go cleanly" })
    await user.click(
      screen.getByRole("checkbox", { name: /mark this task as Released/ })
    )
    expect(await button("Add selected to my task")).toBeDisabled()
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }))
    expect(await button("Add selected to my task")).toBeEnabled()
  })
})

describe("with Live AI", () => {
  const analysis = DEMO_SCENARIOS[0].analysis
  const plan = {
    headline: "From the AI",
    adaptationNote: "",
    nextStep: {
      instruction: "Do the AI step",
      why: "Why",
      minutes: 5,
      approach: "write-in-app",
    },
    artifact: { kind: "email", title: "AI draft", body: "AI body" },
    steps: ["AI step one"],
    choices: [],
    schedule: [],
  }

  it("labels live AI, and sends the task's data", async () => {
    let body: { task: { title: string } } | undefined
    stubFetch(true, (received) => {
      body = received as typeof body
      return Response.json({ analysis, plan })
    })
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Live AI" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )
    await user.click(await button("Get a recovery plan"))
    await screen.findByRole("heading", { name: "From the AI" })
    expect(screen.getByText("Generated by live AI")).toBeInTheDocument()
    expect(body?.task.title).toBe("Do my homework")
    await user.click(await button("Add selected to my task"))
    await waitFor(() =>
      expect(saved().tasks[0].documents[0].source).toBe("live")
    )
  })

  it("never labels a built-in template as AI output", async () => {
    stubFetch(true, () => Response.json({ analysis, plan, usedFallback: true }))
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Live AI" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )
    await user.click(await button("Get a recovery plan"))
    await screen.findByText(/built-in template/)
    expect(screen.queryByText("Generated by live AI")).not.toBeInTheDocument()
    expect(screen.getByText(/prewritten, not AI-generated/)).toBeInTheDocument()
  })

  it("keeps working, with no changes, when the AI is unavailable", async () => {
    stubFetch(true, () =>
      Response.json(
        {
          error: { code: "ai_unavailable", message: "The AI service is down." },
        },
        { status: 502 }
      )
    )
    seed("Do my homework")
    window.location.hash = "#/recover/a"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Live AI" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )
    await user.click(await button("Get a recovery plan"))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The AI service is down."
    )
    expect(saved().tasks[0].recovery).toBeNull()

    await user.click(await button(/Continue in Demo Mode/))
    await user.click(await button("Get a recovery plan"))
    await screen.findByLabelText(/Your draft/)
    expect(screen.getByText(/prewritten, not AI-generated/)).toBeInTheDocument()
  })
})
