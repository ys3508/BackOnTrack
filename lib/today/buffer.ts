import { endOf } from "@/lib/calendar/derived"
import {
  allOccurrences,
  isPlannedEvent,
  plannedSessions,
} from "@/lib/calendar/model"
import { addDays } from "@/lib/workspace/dates"
import type {
  PlannedSession,
  Settings,
  Workspace,
} from "@/lib/workspace/schemas"

/** Where buffers go, in order: the afternoon first. */
const BUFFER_TIMES = ["15:00", "17:00", "11:00", "19:00"]

/** From Settings. Unused, a buffer means nothing: it's never "missed". */
export function buffersFor(settings: Settings) {
  return BUFFER_TIMES.slice(0, settings.bufferCount).map((time) => ({
    time,
    minutes: settings.bufferMinutes,
  }))
}

/**
 * Leaves the chosen space after a work block by moving a new block's start
 * later. It's optional, and off by default.
 */
export function withGap(
  state: Workspace,
  date: string,
  time: string,
  minutes: number,
  ignoreId = ""
) {
  const gap = state.settings.bufferGapMinutes
  if (!gap) return time
  let start = new Date(`${date}T${time}:00`).getTime()
  const others = plannedSessions(state)
    .filter(
      (item) =>
        item.id !== ignoreId && item.date === date && item.time && !item.done
    )
    .map((item) => {
      const from = new Date(`${date}T${item.time}:00`).getTime()
      return [from, from + item.minutes * 60_000] as const
    })
    .sort((a, b) => a[0] - b[0])
  for (const [from, to] of others) {
    if (start < to + gap * 60_000 && start + minutes * 60_000 > from) {
      start = to + gap * 60_000
    }
  }
  const moved = new Date(start)
  // Past midnight there's no later today to move it to, so it stays as chosen.
  return moved.toLocaleDateString("en-CA") === date ? clockOf(moved) : time
}

export type BufferSlot = { date: string; time: string; minutes: number }

const pad = (value: number) => String(value).padStart(2, "0")
const clockOf = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** Everything already holding time on a date, so nothing gets overlapped. */
function busyOn(state: Workspace, date: string, ignoreId: string) {
  const busy: [number, number][] = []
  const add = (time: string, minutes: number) => {
    const start = new Date(`${date}T${time}:00`).getTime()
    busy.push([start, start + minutes * 60_000])
  }
  for (const item of plannedSessions(state)) {
    if (item.id !== ignoreId && item.date === date && item.time && !item.done) {
      add(item.time, item.minutes)
    }
  }
  for (const item of allOccurrences(state, date, addDays(date, 1))) {
    if (isPlannedEvent(item.event) || item.event.flexible) continue
    if (item.event.kind === "buffer" || item.date !== date) continue
    add(item.start, item.minutes)
  }
  for (const item of state.focusSessions) {
    const start = new Date(item.startedAt)
    const end = new Date(item.endedAt).getTime()
    if (start.toLocaleDateString("en-CA") === date) {
      busy.push([start.getTime(), end])
    }
  }
  return busy
}

/** The free stretches inside a day's buffers, from now on. */
export function freeBuffersOn(
  state: Workspace,
  date: string,
  now: number,
  ignoreId = ""
): BufferSlot[] {
  const busy = busyOn(state, date, ignoreId).sort((a, b) => a[0] - b[0])
  const slots: BufferSlot[] = []
  for (const buffer of buffersFor(state.settings)) {
    const opens = new Date(`${date}T${buffer.time}:00`).getTime()
    const closes = endOf(date, buffer.time, buffer.minutes).getTime()
    let from = Math.max(opens, Math.ceil(now / 300_000) * 300_000)
    for (const [start, end] of busy) {
      if (end <= from || start >= closes) continue
      if (start > from) {
        slots.push({
          date,
          time: clockOf(new Date(from)),
          minutes: (start - from) / 60_000,
        })
      }
      from = Math.max(from, end)
    }
    if (from < closes) {
      slots.push({
        date,
        time: clockOf(new Date(from)),
        minutes: (closes - from) / 60_000,
      })
    }
  }
  return slots.filter((slot) => slot.minutes >= 5)
}

export type BufferChoice =
  | { kind: "fits"; slot: BufferSlot }
  /** Too short, or not today. Nothing moves until the user chooses. */
  | { kind: "choose"; slots: BufferSlot[]; needed: number }

/** Never truncates, overlaps, or moves anything by itself unless it really fits. */
export function chooseBuffer(
  state: Workspace,
  session: PlannedSession,
  today: string,
  now: number
): BufferChoice {
  const todays = freeBuffersOn(state, today, now, session.id)
  const fit = todays.find((slot) => slot.minutes >= session.minutes)
  if (fit) return { kind: "fits", slot: fit }
  const tomorrow = freeBuffersOn(state, addDays(today, 1), now, session.id)
  return {
    kind: "choose",
    slots: [...todays, ...tomorrow],
    needed: session.minutes,
  }
}
