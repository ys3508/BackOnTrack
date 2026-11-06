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
  buildRoutineRule,
  hourRange,
  occurrenceOutcome,
  routineWeek,
  suggestEmoji,
  weekStart,
} from "@/lib/calendar/derived"
import {
  buffersFor,
  chooseBuffer,
  freeBuffersOn,
  withGap,
} from "@/lib/today/buffer"
import { addDays, localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { DEFAULT_SETTINGS, EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"
import { restoreWorkspace } from "@/lib/workspace/storage"

type CalendarProps = {
  events: {
    id: string
    title: string
    start?: string
    allDay?: boolean
    rrule?: string
    display?: string
    extendedProps: Record<string, unknown>
  }[]
  eventClick: (info: unknown) => void
  eventClassNames: (info: unknown) => string[]
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
vi.mock("@fullcalendar/rrule", () => ({ default: {} }))

const props = () => calendar.props as CalendarProps
const STORAGE = "backontrack.workspace.v1"
const AT = "2020-01-05T12:00:00.000Z"
const TODAY = localToday()
const CODE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date().getDay()]
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
const gym = {
  id: "r",
  name: "Gym",
  emoji: "🏋️",
  color: "#3f6b52",
  duration: 30,
  kind: "flexible" as const,
  minimumVersion: "Move for 5 minutes",
  rrule: buildRoutineRule([CODE], "00:00", "2020-01-05"),
  exdates: [],
  doneDates: [],
  createdAt: AT,
}
const withGym = () => run([{ type: "add-routine", routine: gym }])

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
    await user.type(screen.getByLabelText("Name"), "Gym")
    expect(await button("Emoji")).toHaveTextContent("🏋️")
    await user.click(await button("Any time that day"))
    expect(screen.queryByLabelText("Time")).toBeNull()
    await user.type(
      screen.getByLabelText("Minimum version (optional)"),
      "Move for 5 minutes"
    )
    await user.click(await button("Add routine"))
    const [routine] = saved().routines
    expect(routine).toMatchObject({
      name: "Gym",
      emoji: "🏋️",
      kind: "flexible",
      minimumVersion: "Move for 5 minutes",
      duration: 30,
    })
    expect(routine.rrule).toContain(`BYDAY=${CODE}`)
  })

  it("starts with today's weekday, and offers presets", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    const labels = {
      SU: "Sun",
      MO: "Mon",
      TU: "Tue",
      WE: "Wed",
      TH: "Thu",
      FR: "Fri",
      SA: "Sat",
    }
    expect(
      screen.getByRole("button", { name: labels[CODE as keyof typeof labels] })
    ).toHaveAttribute("aria-pressed", "true")
    await user.type(screen.getByLabelText("Name"), "Stretch")
    await user.click(await button("Weekends"))
    await user.click(await button("Add routine"))
    expect(saved().routines[0].rrule).toMatch(/BYDAY=SU,SA/)
    await user.click(await button("New routine"))
    await user.type(screen.getByLabelText("Name"), "Read")
    await user.click(await button("Every day"))
    await user.click(await button("Add routine"))
    expect(saved().routines[1].rrule).toMatch(/BYDAY=SU,MO,TU,WE,TH,FR,SA/)
  })

  it("explains why Add is disabled, and only asks for what's needed", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    const add = await button("Add routine")
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription(/needs a name/)
    await user.type(screen.getByLabelText("Name"), "x")
    expect(add).toBeEnabled()
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    for (const day of labels) {
      const chip = screen.getByRole("button", { name: day })
      if (chip.getAttribute("aria-pressed") === "true") await user.click(chip)
    }
    expect(add).toBeDisabled()
    expect(screen.getByText(/needs at least one day/)).toBeTruthy()
  })

  it("lets the user choose their own emoji, and keeps it", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("New routine"))
    await user.type(screen.getByLabelText("Name"), "Gym")
    await user.click(await button("Emoji"))
    await user.click(await button("Use 📖"))
    expect(await button("Emoji")).toHaveTextContent("📖")
    await user.type(screen.getByLabelText("Name"), " run")
    expect(await button("Emoji")).toHaveTextContent("📖")
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
    const [stored] = saved().routines
    expect(stored.minimumDates).toEqual([TODAY])
    expect(stored.doneDates).toEqual([])
    const restored = restoreWorkspace(saved())
    expect(occurrenceOutcome(restored.routines[0], TODAY)).toBe("minimum")
    expect(routineWeek(restored, restored.routines[0], TODAY)).toEqual({
      full: 0,
      minimum: 1,
    })
    await user.click(await button("Routines"))
    expect(await screen.findByText("this week: ◐ 1 minimum")).toBeTruthy()
  })

  it("has one outcome per date, which can change or be cleared", () => {
    const set = (outcome: "full" | "minimum" | "skipped" | null) =>
      ({
        type: "routine-outcome",
        routineId: "r",
        date: TODAY,
        outcome,
      }) as WorkspaceAction
    const minimum = run([set("minimum")], withGym())
    const full = run([set("full")], minimum)
    expect(full.routines[0].minimumDates).toEqual([])
    expect(full.routines[0].doneDates).toEqual([TODAY])
    const skipped = run([set("skipped")], full)
    expect(skipped.routines[0].doneDates).toEqual([])
    expect(occurrenceOutcome(skipped.routines[0], TODAY)).toBe("skipped")
    const cleared = run([set(null)], skipped)
    expect(occurrenceOutcome(cleared.routines[0], TODAY)).toBeNull()
  })

  it("doesn't affect other days, and a one-off keeps its own", () => {
    const state = run(
      [
        {
          type: "routine-outcome",
          routineId: "r",
          date: TODAY,
          outcome: "minimum",
        },
        {
          type: "place-routine",
          placement: {
            id: "p",
            routineId: "r",
            date: addDays(TODAY, 1),
            time: "",
            done: false,
          },
        },
        {
          type: "routine-outcome",
          routineId: "r",
          date: addDays(TODAY, 1),
          placementId: "p",
          outcome: "full",
        },
      ],
      withGym()
    )
    expect(occurrenceOutcome(state.routines[0], addDays(TODAY, 2))).toBeNull()
    expect(state.routinePlacements[0]).toMatchObject({
      result: "full",
      done: true,
    })
  })

  it("marks it ◐ on the calendar, in its own style", async () => {
    seed(
      run(
        [
          {
            type: "routine-outcome",
            routineId: "r",
            date: TODAY,
            outcome: "minimum",
          },
        ],
        withGym()
      )
    )
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const [y, m, d] = TODAY.split("-").map(Number)
    expect(
      props().eventClassNames({
        event: {
          start: new Date(y, m - 1, d),
          allDay: true,
          extendedProps: { kind: "routine", refId: "r" },
        },
      })
    ).toEqual(["bot-routine-minimum"])
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
        extendedProps: { kind: "routine", refId: "r", taskId: null },
      },
      el: document.body,
      jsEvent: { preventDefault() {}, target: document.body },
    })
    const dialog = await screen.findByRole("dialog", { name: "Gym" })
    expect(within(dialog).getByText(/Minimum: Move for 5 minutes/)).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "◐ Minimum" }))
    expect(saved().routines[0].minimumDates).toEqual([TODAY])
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
    const raw = JSON.parse(JSON.stringify(withGym()))
    for (const key of [
      "kind",
      "minimumVersion",
      "minimumDates",
      "skippedDates",
    ]) {
      delete raw.routines[0][key]
    }
    const [routine] = restoreWorkspace(raw).routines
    expect(routine).toMatchObject({
      kind: "fixed",
      minimumVersion: "",
      minimumDates: [],
      skippedDates: [],
    })
  })
})

describe("flexible routines on the calendar", () => {
  it("sit in the untimed row, with no hour", async () => {
    seed(withGym())
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    const event = props().events.find((item) => item.id === "routine:r:0")!
    expect(event.allDay).toBe(true)
  })

  it("don't stretch the hours or use up a buffer", () => {
    const state = run([
      {
        type: "add-routine",
        routine: {
          ...gym,
          rrule: buildRoutineRule([CODE], "15:00", "2020-01-05"),
        },
      },
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

describe("buffers from Settings", () => {
  const settings = { ...DEFAULT_SETTINGS }

  it("defaults to one 30-minute afternoon buffer", () => {
    expect(buffersFor(settings)).toEqual([{ time: "15:00", minutes: 30 }])
  })

  it("follows the number and length chosen", () => {
    expect(
      buffersFor({ ...settings, bufferCount: 2, bufferMinutes: 45 })
    ).toEqual([
      { time: "15:00", minutes: 45 },
      { time: "17:00", minutes: 45 },
    ])
    expect(buffersFor({ ...settings, bufferCount: 0 })).toEqual([])
  })

  it("uses a second buffer when the first can't fit", () => {
    const state: Workspace = {
      ...run([
        { type: "create-task", id: "a", at: AT, title: "A" },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "m",
            taskId: "a",
            date: TODAY,
            time: "09:00",
            minutes: 25,
            label: "",
            done: false,
          },
        },
        {
          type: "add-planned",
          at: AT,
          session: {
            id: "x",
            taskId: "a",
            date: TODAY,
            time: "15:00",
            minutes: 30,
            label: "",
            done: false,
          },
        },
      ]),
    }
    state.settings = { ...settings, bufferCount: 2 }
    const early = new Date(`${TODAY}T01:00:00`).getTime()
    expect(chooseBuffer(state, state.planned[0], TODAY, early)).toEqual({
      kind: "fits",
      slot: { date: TODAY, time: "17:00", minutes: 30 },
    })
  })

  it("offers nothing when turned off, and moves nothing", () => {
    const state = run([
      { type: "create-task", id: "a", at: AT, title: "A" },
      {
        type: "add-planned",
        at: AT,
        session: {
          id: "m",
          taskId: "a",
          date: TODAY,
          time: "09:00",
          minutes: 25,
          label: "",
          done: false,
        },
      },
      { type: "settings", patch: { bufferCount: 0 } },
    ])
    expect(chooseBuffer(state, state.planned[0], TODAY, Date.now())).toEqual({
      kind: "choose",
      slots: [],
      needed: 25,
    })
  })

  it("saves the choices in Settings, through a reload", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.selectOptions(
      await screen.findByLabelText("Buffers each day"),
      "2"
    )
    await user.selectOptions(screen.getByLabelText("Length of each"), "45")
    await user.selectOptions(
      screen.getByLabelText("Gap between work blocks"),
      "10"
    )
    cleanup()
    render(<WorkspaceApp />)
    expect(await screen.findByLabelText("Buffers each day")).toHaveValue("2")
    expect(saved().settings).toMatchObject({
      bufferCount: 2,
      bufferMinutes: 45,
      bufferGapMinutes: 10,
    })
  })

  it("draws them on the calendar from the settings", async () => {
    seed(run([{ type: "settings", patch: { bufferCount: 2 } }]))
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: "Calendar" })
    expect(
      props().events.filter((item) => item.display === "background")
    ).toHaveLength(2)
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
  it("collapses a day with nothing into one quiet line", async () => {
    seed(EMPTY_WORKSPACE)
    window.location.hash = "#/calendar"
    render(<WorkspaceApp />)
    await screen.findByText("Nothing recorded yet today.")
    expect(screen.queryByText("Focus time")).toBeNull()
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
    ).toEqual(["Deadline", "Planned", "Focus done", "Routine", "Buffer"])
  })

  it("offers Start, Done, Change time, Open link, and Delete on a block", async () => {
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
      "Change time",
      "Open",
      "Delete",
    ]) {
      within(dialog).getByRole("button", { name })
    }
    expect(
      within(dialog).getByRole("link", { name: "Open link" })
    ).toHaveAttribute("href", "https://example.com/")
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(saved().planned).toEqual([])
    expect(saved().tasks).toHaveLength(1)
  })

  it("moves a block into a part of the day from the popover", async () => {
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
    await user.click(await button("Change time"))
    await user.click(await button("Morning"))
    await user.click(await button("Save"))
    await waitFor(() =>
      expect(saved().planned[0]).toMatchObject({
        time: null,
        window: "morning",
      })
    )
    expect(saved().tasks[0].deadline).toBe(addDays(TODAY, 5))
  })

  it("has weekStart usable by counts", () => {
    expect(weekStart(TODAY) <= TODAY).toBe(true)
  })
})
