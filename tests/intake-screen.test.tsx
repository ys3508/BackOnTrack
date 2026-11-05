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

import { RecoveryApp } from "@/components/recovery-app"
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import { EMPTY_INTAKE } from "@/lib/intake"
import type { Intake } from "@/lib/schemas"
import { initialSession, saveSession } from "@/lib/session"

const STORAGE_KEY = "backontrack.session.v1"
const JOB = DEMO_SCENARIOS[0]

function stubFetch(live = false) {
  const posts: { intake: Intake }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return Response.json({ live, model: live ? "test-model" : null })
      }
      posts.push(JSON.parse(init.body as string))
      return Response.json({ analysis: JOB.analysis })
    })
  )
  return posts
}

const button = (name: RegExp | string) => screen.findByRole("button", { name })
const radio = (name: RegExp | string) => screen.getByRole("radio", { name })
const group = (name: string) => screen.getByRole("group", { name })

async function open() {
  render(<RecoveryApp />)
  await waitFor(async () =>
    expect(await button("Help me restart")).toBeEnabled()
  )
}

async function openDetails(user: ReturnType<typeof userEvent.setup>) {
  await open()
  await user.click(await button("Add details (optional)"))
}

const saved = () =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).intake as Intake

beforeEach(() => {
  window.localStorage.clear()
  window.scrollTo = vi.fn() as typeof window.scrollTo
})

describe("top of the page", () => {
  it("uses the new wording and keeps the examples", async () => {
    stubFetch()
    await open()
    expect(
      screen.getByRole("heading", { name: "What’s been weighing on you?" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "A few words are enough. You can figure out the rest as you go."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        "e.g. I haven't replied to an important email..."
      )
    ).toBeInTheDocument()
    for (const scenario of DEMO_SCENARIOS) {
      expect(await button(scenario.label)).toBeInTheDocument()
    }
    expect(screen.queryByText(/putting off/i)).not.toBeInTheDocument()
  })
})

describe("progressive disclosure", () => {
  it("is collapsed by default, and can submit without opening it", async () => {
    stubFetch()
    const user = userEvent.setup()
    await open()
    const toggle = await button("Add details (optional)")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()

    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(saved().deadline).toBeNull()
    expect(saved().status).toBeNull()
    expect(saved().obstacle).toBeNull()
  })

  it("selects nothing automatically", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    expect(screen.getAllByRole("radio")).toHaveLength(13)
    screen
      .getAllByRole("radio")
      .forEach((option) => expect(option).not.toBeChecked())
    expect(screen.queryByLabelText("Deadline date")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/what is it/i)).not.toBeInTheDocument()
  })
})

describe("original deadline", () => {
  it("reveals the calendar only for Pick a date, and stores the date as typed", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Pick a date"))
    const input = screen.getByLabelText("Deadline date")
    expect(input).toHaveAttribute("type", "date")
    fireEvent.change(input, { target: { value: "2026-03-01" } })

    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(saved().deadline).toEqual({ type: "date", date: "2026-03-01" })
    expect(screen.getByText(/Sunday, March 1, 2026/)).toBeInTheDocument()
  })

  it("has no minimum date, so past deadlines are allowed", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Pick a date"))
    expect(screen.getByLabelText("Deadline date")).not.toHaveAttribute("min")
  })

  it("stores No deadline", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("No deadline"))
    expect(screen.queryByLabelText("Deadline date")).not.toBeInTheDocument()
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByText("You said there is no deadline.")
    expect(saved().deadline).toEqual({ type: "none" })
  })

  it("stores I'm not sure as an unknown", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(
      within(group("Original deadline")).getByRole("radio", {
        name: "I’m not sure",
      })
    )
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByText(/What the deadline is/)
    expect(saved().deadline).toEqual({ type: "unsure" })
  })

  it("treats Pick a date with no date as unanswered", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Pick a date"))
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(saved().deadline).toBeNull()
  })
})

describe("clickable status and obstacle", () => {
  it("keeps one status selected, and clears it when clicked again", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Haven’t started"))
    await user.click(radio("Missed the deadline"))
    expect(radio("Missed the deadline")).toBeChecked()
    expect(radio("Haven’t started")).not.toBeChecked()
    await user.click(radio("Missed the deadline"))
    expect(radio("Missed the deadline")).not.toBeChecked()

    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(saved().status).toBeNull()
  })

  it("passes status and obstacle to Demo Mode and the summary", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Started, then stopped"))
    await user.click(radio("It feels overwhelming"))
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))

    await screen.findByText(/Current status you chose: Started, then stopped/)
    screen.getByText(/Main obstacle you chose: It feels overwhelming/)
    await user.click(await button(/see the recovery options/i))
    await user.click(await button(/continue with reduce/i))
    await user.click(await button("Finish for now"))
    const details = screen.getByText("Details you chose").parentElement!
    expect(details).toHaveTextContent("Original deadline:Not answered")
    expect(details).toHaveTextContent("Current status:Started, then stopped")
    expect(details).toHaveTextContent("Main obstacle:It feels overwhelming")
  })

  it("passes the selections in Live AI requests", async () => {
    const posts = stubFetch(true)
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("No deadline"))
    await user.click(radio("Haven’t started"))
    await user.click(radio("I don’t have the energy"))
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(posts[0].intake).toMatchObject({
      deadline: { type: "none" },
      status: "not-started",
      obstacle: "no-energy",
      obstacleOther: "",
    })
  })
})

describe("Something else", () => {
  it("shows an optional text field that can be left blank", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Something else"))
    expect(screen.getByLabelText(/what is it/i)).toBeInTheDocument()
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(saved().obstacle).toBe("something-else")
    expect(saved().obstacleOther).toBe("")
  })

  it("stores the text, and discards it if another option is chosen", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Something else"))
    await user.type(screen.getByLabelText(/what is it/i), "No laptop")
    await user.click(radio("I’m worried about the outcome"))
    expect(screen.queryByLabelText(/what is it/i)).not.toBeInTheDocument()
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await screen.findByRole("heading", { name: /actually true/i })
    expect(saved().obstacle).toBe("worried-outcome")
    expect(saved().obstacleOther).toBe("")
  })
})

describe("restoring the intake", () => {
  it("restores every answer when going back, reopening the section", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Pick a date"))
    fireEvent.change(screen.getByLabelText("Deadline date"), {
      target: { value: "2026-03-01" },
    })
    await user.click(radio("Started, then stopped"))
    await user.click(radio("Something else"))
    await user.type(screen.getByLabelText(/what is it/i), "No laptop")
    await user.click(await button(JOB.label))
    await user.click(await button("Help me restart"))
    await user.click(await button(/edit what i wrote/i))

    expect(await button("Add details (optional)")).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(radio("Pick a date")).toBeChecked()
    expect(screen.getByLabelText("Deadline date")).toHaveValue("2026-03-01")
    expect(radio("Started, then stopped")).toBeChecked()
    expect(radio("Something else")).toBeChecked()
    expect(screen.getByLabelText(/what is it/i)).toHaveValue("No laptop")
  })

  it("restores saved answers after a page reload", async () => {
    stubFetch()
    saveSession({
      ...initialSession,
      intake: {
        ...EMPTY_INTAKE,
        responsibility: JOB.input,
        deadline: { type: "unsure" },
        obstacle: "no-energy",
      },
    })
    await open()
    expect(
      screen.getByRole("textbox", { name: /weighing on you/i })
    ).toHaveValue(JOB.input)
    expect(
      within(group("Original deadline")).getByRole("radio", {
        name: "I’m not sure",
      })
    ).toBeChecked()
    expect(radio("I don’t have the energy")).toBeChecked()
  })

  it("loads a session saved in the old free-text format without crashing", async () => {
    stubFetch()
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...initialSession,
        intake: {
          responsibility: JOB.input,
          deadline: "last Friday",
          status: "stopped",
          obstacle: "my laptop broke",
        },
      })
    )
    await open()
    expect(radio("Something else")).toBeChecked()
    expect(screen.getByLabelText(/what is it/i)).toHaveValue("my laptop broke")
    expect(saved().legacyNotes).toContain("last Friday")
  })

  it("clears the form when the user deletes their data", async () => {
    stubFetch()
    saveSession({
      ...initialSession,
      intake: { ...EMPTY_INTAKE, responsibility: JOB.input, status: "unsure" },
    })
    const user = userEvent.setup()
    await open()
    await user.click(await button(/delete my data/i))
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: /weighing on you/i })
      ).toHaveValue("")
    )
    expect(await button("Add details (optional)")).toHaveAttribute(
      "aria-expanded",
      "false"
    )
  })
})

describe("keyboard accessibility", () => {
  it("can open the section and choose options with the keyboard alone", async () => {
    stubFetch()
    const user = userEvent.setup()
    await open()
    const toggle = await button("Add details (optional)")
    toggle.focus()
    await user.keyboard("{Enter}")
    expect(toggle).toHaveAttribute("aria-expanded", "true")

    await user.tab()
    expect(radio("Pick a date")).toHaveFocus()
    expect(radio("Pick a date")).not.toBeChecked()
    await user.keyboard(" ")
    expect(radio("Pick a date")).toBeChecked()
    await user.tab()
    expect(screen.getByLabelText("Deadline date")).toHaveFocus()

    await user.tab()
    expect(radio("Haven’t started")).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(radio("Started, then stopped")).toBeChecked()
    expect(radio("Started, then stopped")).toHaveFocus()
    await user.keyboard(" ")
    expect(radio("Started, then stopped")).not.toBeChecked()
  })

  it("clears a checked option on Space, where browsers send no click", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    await user.click(radio("Haven’t started"))
    fireEvent.keyUp(radio("Haven’t started"), { key: " " })
    await waitFor(() => expect(radio("Haven’t started")).not.toBeChecked())
    fireEvent.keyUp(radio("Started, then stopped"), { key: " " })
    expect(radio("Started, then stopped")).not.toBeChecked()
  })

  it("labels each group for screen readers", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    expect(
      within(group("Original deadline")).getAllByRole("radio")
    ).toHaveLength(3)
    expect(within(group("Current status")).getAllByRole("radio")).toHaveLength(
      4
    )
    expect(within(group("Main obstacle")).getAllByRole("radio")).toHaveLength(6)
  })
})

describe("mobile layout classes", () => {
  it("stacks options in one column below the small breakpoint, with tall targets", async () => {
    stubFetch()
    const user = userEvent.setup()
    await openDetails(user)
    for (const option of screen.getAllByRole("radio")) {
      const target = option.closest("label")!
      expect(target).toHaveClass("min-h-12")
      expect(target.parentElement).toHaveClass("grid-cols-1")
    }
    expect(await button("Add details (optional)")).toHaveClass("min-h-11")
    expect(await button(JOB.label)).toHaveClass("min-h-11")
  })
})
