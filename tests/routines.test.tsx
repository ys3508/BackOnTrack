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

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import {
  hourRange,
  occurrenceOutcome,
  routineWeek,
  suggestEmoji,
  weekStart,
} from "@/lib/calendar/derived"
import {
  freeBuffersOn,
  withGap,
} from "@/lib/today/buffer"
import { plannedSessions } from "@/lib/calendar/model"
import { newBuffer } from "@/lib/calendar/model"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { DEFAULT_SETTINGS, EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { restoreWorkspace } from "@/lib/workspace/storage"
import { eventOf } from "./event-fixtures"

type CalendarProps = {
  events: {
    id: string
    title: string
    start?: string
    allDay?: boolean
    rrule?: string
    display?: string
    classNames?: string[]
    extendedProps: Record<string, unknown>
  }[]
  eventClick: (info: unknown) => void
  dateClick: (info: unknown) => void
}
const calendar = vi.hoisted(() => ({ props: null as unknown }))
vi.mock("@fullcalendar/react", () => ({
  default: (props: CalendarProps) => {
    calendar.props = props
    return <div>Calendar grid</div>
  },
}))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({
  default: {},
  Draggable: class {
    destroy() {}
  },
}))
vi.mock("@fullcalendar/multimonth", () => ({ default: {} }))

const props = () => calendar.props as CalendarProps
const STORAGE = "backontrack.workspace.v1"
const AT = "2020-01-05T12:00:00.000Z"
const TODAY = localToday()
const WEEKDAY = new Date().getDay()
const WEEKDAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][WEEKDAY]
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
const gym = eventOf({
  id: "r",
  title: "Gym",
  emoji: "🏋️",
  color: "#3f6b52",
  date: "2020-01-05",
  start: "00:00",
  flexible: true,
  minimum: "Move for 5 minutes",
  repeat: { days: [WEEKDAY] },
})
const withGym = () => run([{ type: "add-event", event: gym }])

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/routines"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
})

describe("creating a routine", () => {
  it("Test 8 setup: a flexible gym routine with a minimum, in few steps", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    await user.type(screen.getByLabelText("Title"), "Gym")
    await user.click(screen.getByLabelText("Any time that day"))
    expect(screen.queryByLabelText("Start")).toBeNull()
    await user.type(
      screen.getByLabelText("Minimum version (optional)"),
      "Move for 5 minutes"
    )
    await user.click(await button("Save"))
    const [routine] = saved().events
    expect(routine).toMatchObject({
      title: "Gym",
      emoji: "🏋️",
      flexible: true,
      taskId: null,
      minimum: "Move for 5 minutes",
      repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
    })
    // A routine isn't work to finish, so it doesn't make a task.
    expect(saved().tasks).toEqual([])
  })

  it("asks only for the essentials, and can still add one that way", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    expect(screen.queryByLabelText("Link")).toBeNull()
    await user.type(screen.getByLabelText("Title"), "Walk")
    await user.click(await button("Save"))
    expect(saved().events[0]).toMatchObject({
      title: "Walk",
      flexible: false,
      start: "07:00",
      end: "07:30",
      minimum: "",
    })
  })

  it("shows what it has when editing, and changes the whole routine", async () => {
    seed(withGym())
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/^Edit /))
    expect(screen.getByLabelText("Minimum version (optional)")).toHaveValue(
      "Move for 5 minutes"
    )
    await user.click(screen.getByRole("button", { name: "Rose" }))
    await user.click(await button("Save"))
    // From its card there's no single day to ask about.
    expect(screen.queryByText("This one only")).toBeNull()
    expect(saved().events[0].color).toBe("#c23a86")
  })

  it("starts as every day, with presets, and custom starts from that weekday", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    await user.selectOptions(screen.getByLabelText("Repeat"), "custom")
    expect(screen.getByRole("button", { name: WEEKDAY_NAME })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await user.type(screen.getByLabelText("Title"), "Stretch")
    await user.selectOptions(screen.getByLabelText("Repeat"), "Weekends")
    await user.click(await button("Save"))
    expect(saved().events[0].repeat.days).toEqual([0, 6])
    await user.click(await button("New routine"))
    await user.type(screen.getByLabelText("Title"), "Read")
    await user.click(await button("Save"))
    expect(saved().events[1].repeat.days).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("can't be saved without a name and at least one day", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    const save = await button("Save")
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText("Title"), "x")
    expect(save).toBeEnabled()
    await user.selectOptions(screen.getByLabelText("Repeat"), "custom")
    await user.click(screen.getByRole("button", { name: WEEKDAY_NAME }))
    expect(save).toBeDisabled()
  })

  it("lets the user choose their own emoji, and keeps it", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    await user.type(screen.getByLabelText("Title"), "Gym")
    await user.click(await button("More"))
    expect(await button("Use 🏋️")).toHaveAttribute("aria-pressed", "true")
    await user.click(await button("Use 📖"))
    await user.type(screen.getByLabelText("Title"), " run")
    expect(await button("Use 📖")).toHaveAttribute("aria-pressed", "true")
    await user.click(await button("Save"))
    expect(saved().events[0].emoji).toBe("📖")
  })

  it("suggests from the name, and leaves it blank when unsure", () => {
    expect(suggestEmoji("Morning run")).toBe("🏃")
    expect(suggestEmoji("Read a chapter")).toBe("📖")
    expect(suggestEmoji("Xyzzy")).toBe("")
  })
})

describe("Test 8: outcomes for one occurrence", () => {
  const open = async () => {
    seed(withGym())
    window.location.hash = "#/"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Routines today" })
  }

  it("shows the minimum, and counts it apart from full", async () => {
    await open()
    const user = userEvent.setup()
    expect(screen.getByText("Minimum: Move for 5 minutes")).toBeTruthy()
    expect(screen.getByText("Any time")).toBeTruthy()
    await user.click(await button(/Minimum version: .*Gym/))
    const [stored] = saved().events
    expect(stored.outcomes).toEqual({ [TODAY]: "minimum" })
    const restored = restoreWorkspace(saved())
    expect(occurrenceOutcome(restored.events[0], TODAY)).toBe("minimum")
    expect(routineWeek(restored, restored.events[0], TODAY)).toEqual({
      full: 0,
      minimum: 1,
    })
    await user.click(await button("Routines"))
    expect(await screen.findByText("this week: ◐ 1 minimum")).toBeTruthy()
  })

  it("has one outcome per date, which can change or be cleared", () => {
    const set = (outcome: "full" | "minimum" | "skipped" | null) =>
      ({
        type: "occurrence-outcome",
        id: "r",
        key: TODAY,
        outcome,
      }) as WorkspaceAction
    const minimum = run([set("minimum")], withGym())
    const full = run([set("full")], minimum)
    expect(full.events[0].outcomes).toEqual({ [TODAY]: "full" })
    const skipped = run([set("skipped")], full)
    expect(skipped.events[0].outcomes).toEqual({ [TODAY]: "skipped" })
    expect(occurrenceOutcome(skipped.events[0], TODAY)).toBe("skipped")
    const cleared = run([set(null)], skipped)
    expect(occurrenceOutcome(cleared.events[0], TODAY)).toBeNull()
  })

  it("doesn't affect other days, and a one-off keeps its own", () => {
    const tomorrow = addDays(TODAY, 1)
    const state = run(
      [
        { type: "occurrence-outcome", id: "r", key: TODAY, outcome: "minimum" },
        {
          type: "add-event",
          event: eventOf({
            id: "p",
            title: "Gym",
            seriesId: "r",
            date: tomorrow,
            repeat: null,
          }),
        },
        { type: "occurrence-outcome", id: "p", key: tomorrow, outcome: "full" },
      ],
      withGym()
    )
    expect(occurrenceOutcome(state.events[0], addDays(TODAY, 2))).toBeNull()
    expect(state.events[1].outcomes).toEqual({ [tomorrow]: "full" })
    expect(routineWeek(state, state.events[0], TODAY).minimum).toBe(1)
  })

  it("shows the minimum on the calendar in its own style", async () => {
    seed(
      run(
        [{ type: "occurrence-outcome", id: "r", key: TODAY, outcome: "minimum" }],
        withGym()
      )
    )
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const block = props().events.find((item) => item.id === `routine:r:${TODAY}`)!
    expect(block.classNames).toEqual(["bot-minimum"])
  })

  it("offers the three outcomes in the block popover", async () => {
    seed(withGym())
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const [y, m, d] = TODAY.split("-").map(Number)
    props().eventClick({
      event: {
        title: "Gym",
        start: new Date(y, m - 1, d),
        end: null,
        extendedProps: { kind: "routine", refId: "r", taskId: null, key: TODAY },
      },
      el: document.body,
      jsEvent: { preventDefault() {}, target: document.body },
    })
    const dialog = await screen.findByRole("dialog", { name: "Gym" })
    expect(within(dialog).getByText(/Minimum: Move for 5 minutes/)).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "◐ Minimum" }))
    expect(saved().events[0].outcomes).toEqual({ [TODAY]: "minimum" })
  })

  it("survives reloading, and there's no streak anywhere", async () => {
    await open()
    const user = userEvent.setup()
    await user.click(await button(/Minimum version: .*Gym/))
    cleanup()
    render(<WorkspaceApp />)
    expect(await button(/Minimum version: .*Gym/)).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(document.body.textContent).not.toMatch(/streak/i)
  })

  it("loads older routines, which have no type or outcomes", () => {
    const [routine] = restoreWorkspace({
      version: 2,
      routines: [
        {
          id: "r",
          name: "Gym",
          color: "#3f6b52",
          rrule: "DTSTART:20200105T070000\nRRULE:FREQ=WEEKLY;BYDAY=SU",
          duration: 30,
          createdAt: AT,
        },
      ],
    }).events
    expect(routine).toMatchObject({
      flexible: false,
      minimum: "",
      outcomes: {},
      overrides: {},
    })
  })
})

describe("flexible routines on the calendar", () => {
  it("sit in the untimed row, with no hour", async () => {
    seed(withGym())
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const event = props().events.find((item) => item.id === `routine:r:${TODAY}`)!
    expect(event.allDay).toBe(true)
  })

  it("don't stretch the hours or use up a buffer", () => {
    const state = run([
      { type: "add-event", event: { ...gym, start: "15:00", end: "15:30" } },
      { type: "add-event", event: newBuffer("buf", TODAY, "15:00", 30) },
    ])
    const at = new Date(`${TODAY}T01:00:00`).getTime()
    expect(freeBuffersOn(state, TODAY, at)).toHaveLength(1)
    const noon = new Date(`${TODAY}T12:00:00`)
    expect(hourRange(state, TODAY, addDays(TODAY, 1), noon)).toEqual({
      first: 6,
      last: 23,
    })
  })
})

describe("buffer settings", () => {
  it("has no automatic buffers, and no count or start time to set", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/settings"
    render(<WorkspaceApp />)
    await screen.findByLabelText("Default length for new buffers")
    expect(screen.queryByLabelText("Buffers each day")).toBeNull()
    expect(screen.queryByText(/3:00 PM/)).toBeNull()
    expect(DEFAULT_SETTINGS).not.toHaveProperty("bufferCount")
  })

  it("saves the choices in Settings, through a reload", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.selectOptions(
      await screen.findByLabelText("Default length for new buffers"),
      "45"
    )
    await user.selectOptions(
      screen.getByLabelText("Gap between work blocks"),
      "10"
    )
    cleanup()
    render(<WorkspaceApp />)
    expect(
      await screen.findByLabelText("Default length for new buffers")
    ).toHaveValue("45")
    expect(saved().settings).toMatchObject({
      bufferMinutes: 45,
      bufferGapMinutes: 10,
    })
  })

  it("draws no buffers on a fresh calendar", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(
      props().events.filter((item) => item.extendedProps.kind === "buffer")
    ).toEqual([])
  })
})

describe("gaps between work blocks", () => {
  const state = (gap: number) =>
    run([
      { type: "create-task", id: "a", at: AT, title: "A" },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "x",
          taskId: "a",
          date: TODAY,
          time: "10:00",
          minutes: 30,
          label: "",
          done: false,
        },
      },
      { type: "settings", patch: { bufferGapMinutes: gap } },
    ])

  it("does nothing when off", () => {
    expect(withGap(state(0), TODAY, "10:15", 25)).toBe("10:15")
  })

  it("moves a new block to after the gap", () => {
    expect(withGap(state(10), TODAY, "10:30", 25)).toBe("10:40")
    expect(withGap(state(10), TODAY, "10:15", 25)).toBe("10:40")
  })

  it("leaves a block that's already far enough away", () => {
    expect(withGap(state(10), TODAY, "11:00", 25)).toBe("11:00")
    expect(withGap(state(10), TODAY, "09:00", 25)).toBe("09:00")
  })
})

describe("calendar cleanup", () => {
  it("shows a dash and a reason for a day with nothing, never a zero", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByText("No focus sessions this day yet.")
    expect(screen.getByText("Nothing tracked yet")).toBeTruthy()
    expect(screen.queryByText("0 min")).toBeNull()
  })

  it("names the legend the way you asked", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    const key = await screen.findByRole("list", { name: "Calendar key" })
    expect(
      within(key)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(["Planned", "Done", "Minimum", "Skipped", "Buffer", "Deadline"])
  })

  it("offers Start, Done, Edit, Open link, and Delete on a block", async () => {
    seed(
      run([
        { type: "create-task", id: "a", at: AT, title: "A" },
        {
          type: "edit-task",
          id: "a",
          at: AT,
          patch: { link: "example.com" },
        },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "p",
            taskId: "a",
            date: addDays(TODAY, 1),
            time: "09:00",
            minutes: 25,
            label: "",
            done: false,
          },
        },
      ])
    )
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const start = new Date(`${addDays(TODAY, 1)}T09:00:00`)
    props().eventClick({
      event: {
        title: "A",
        start,
        end: new Date(start.getTime() + 1_500_000),
        extendedProps: { kind: "planned", refId: "p", taskId: "a" },
      },
      el: document.body,
      jsEvent: { preventDefault() {}, target: document.body },
    })
    const dialog = await screen.findByRole("dialog", { name: "A" })
    for (const name of [
      "Start focus",
      "Done",
      "Edit",
      "Open",
      "Delete",
    ]) {
      within(dialog).getByRole("button", { name })
    }
    expect(
      within(dialog).getByRole("link", { name: "Open link" })
    ).toHaveAttribute("href", "https://example.com/")
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(plannedSessions(saved())).toEqual([])
    expect(saved().tasks).toHaveLength(1)
  })

  it("makes a block any time that day from the popover", async () => {
    seed(
      run([
        {
          type: "create-task",
          id: "a",
          at: AT,
          title: "A",
          deadline: addDays(TODAY, 5),
        },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "p",
            taskId: "a",
            date: addDays(TODAY, 1),
            time: "09:00",
            minutes: 25,
            label: "",
            done: false,
          },
        },
      ])
    )
    window.location.hash = "#/calendar"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const start = new Date(`${addDays(TODAY, 1)}T09:00:00`)
    props().eventClick({
      event: {
        title: "A",
        start,
        end: new Date(start.getTime() + 1_500_000),
        extendedProps: { kind: "planned", refId: "p", taskId: "a" },
      },
      el: document.body,
      jsEvent: { preventDefault() {}, target: document.body },
    })
    await user.click(await button("Edit"))
    await user.click(screen.getByLabelText("Any time that day"))
    await user.click(await button("Save"))
    await waitFor(() =>
      expect(plannedSessions(saved())[0]).toMatchObject({ time: null })
    )
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 5))
  })

  it("has weekStart usable by counts", () => {
    expect(weekStart(TODAY) <= TODAY).toBe(true)
  })
})
