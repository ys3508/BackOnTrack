import { addDays } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"

/** RFC 5545 needs these characters escaped in text values. */
function escapeText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

/** Lines over 75 bytes continue on the next line, starting with a space. */
function fold(line: string) {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ""
  for (const char of line) {
    if (encoder.encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.join("\r\n ")
}

const pad = (value: number) => String(value).padStart(2, "0")

function utc(date: Date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

const compactDate = (date: string) => date.replaceAll("-", "")

const WINDOW_NAME = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
}

/**
 * A one-time copy of what's planned from today on, plus deadlines. Nothing syncs
 * afterwards. Past blocks and finished work are left out on purpose.
 */
export function buildIcs(state: Workspace, today: string, now = new Date()) {
  const stamp = utc(now)
  const events: string[][] = []

  for (const session of state.planned) {
    if (session.done || session.outcome || session.date < today) continue
    const task = state.tasks.find((item) => item.id === session.taskId)
    if (!task || !isActive(task)) continue
    const title = session.label ? `${task.title}: ${session.label}` : task.title
    const summary = session.window
      ? `${title} (${WINDOW_NAME[session.window]})`
      : title
    const lines = [
      "BEGIN:VEVENT",
      `UID:planned-${session.id}@backontrack`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${escapeText(summary)}`,
    ]
    if (session.time) {
      const start = new Date(`${session.date}T${session.time}:00`)
      const end = new Date(start.getTime() + session.minutes * 60_000)
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`)
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(session.date)}`,
        `DTEND;VALUE=DATE:${compactDate(addDays(session.date, 1))}`
      )
    }
    lines.push("TRANSP:OPAQUE", "END:VEVENT")
    events.push(lines)
  }

  for (const task of state.tasks) {
    if (!task.deadline || !isActive(task) || task.deadline < today) continue
    events.push([
      "BEGIN:VEVENT",
      `UID:deadline-${task.id}@backontrack`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${escapeText(`Due: ${task.title}`)}`,
      `DTSTART;VALUE=DATE:${compactDate(task.deadline)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(task.deadline, 1))}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    ])
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BackOnTrack//Calendar export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flat(),
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n")
    .concat("\r\n")
}

export function downloadIcs(state: Workspace, today: string) {
  const url = URL.createObjectURL(
    new Blob([buildIcs(state, today)], { type: "text/calendar;charset=utf-8" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = "backontrack-calendar.ics"
  link.click()
  URL.revokeObjectURL(url)
}
