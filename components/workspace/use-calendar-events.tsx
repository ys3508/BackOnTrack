"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  EventContentArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core"

import { BlockContent } from "@/components/workspace/calendar-block"
import { useStore } from "@/components/workspace/store"
import { blockOutcome, parseRoutineRule } from "@/lib/calendar/derived"
import { buildCalendarItems } from "@/lib/calendar/events"
import type { CalendarItemKind } from "@/lib/calendar/events"
import { buffersFor } from "@/lib/today/buffer"
import { localToday } from "@/lib/workspace/dates"

/** One source for what's drawn, so Calendar and Today's timeline can't disagree. */
export function useCalendarEvents(hidden = false) {
  const { state, today } = useStore()
  // Ticks so a block can ask "Did it?" as soon as its time has gone by.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Only changes when something new has ended, so a drag isn't disturbed.
  const planned = useMemo(
    () => buildCalendarItems(state, today, now),
    [state, today, now]
  )
  const plannedKey = JSON.stringify(planned)

  const events = useMemo<EventInput[]>(() => {
    if (hidden) return []
    const routines = state.routines.flatMap((routine): EventInput[] =>
      [routine, ...routine.priorRules].map((rule, index) => ({
        id: `routine:${routine.id}:${index}`,
        title: `${routine.emoji} ${routine.name}`.trim(),
        rrule: rule.rrule,
        // A flexible routine sits in the untimed row, with no hour of its own.
        ...(routine.kind === "flexible"
          ? {
              allDay: true,
              exdate: routine.exdates,
            }
          : {
              duration: { minutes: rule.duration },
              exdate: routine.exdates.map(
                (date) => `${date}T${parseRoutineRule(rule.rrule).time}:00`
              ),
            }),
        editable: true,
        durationEditable: routine.kind !== "flexible",
        classNames: ["bot-routine"],
        extendedProps: {
          kind: "routine",
          refId: routine.id,
          taskId: null,
          color: routine.color,
        },
      }))
    )
    const placed = state.routinePlacements.flatMap((item): EventInput[] => {
      const routine = state.routines.find((r) => r.id === item.routineId)
      if (!routine) return []
      const start = new Date(`${item.date}T${item.time || "00:00"}:00`)
      const minutes = item.minutes ?? routine.duration
      return [
        {
          id: `placement:${item.id}`,
          title: `${routine.emoji} ${routine.name}`.trim(),
          ...(item.time
            ? {
                start,
                end: new Date(start.getTime() + minutes * 60_000),
              }
            : { start: item.date, allDay: true }),
          editable: true,
          durationEditable: Boolean(item.time),
          classNames: ["bot-routine"],
          extendedProps: {
            kind: "routine-placement",
            refId: item.id,
            taskId: null,
            color: routine.color,
            adjusted: item.adjusted,
          },
        },
      ]
    })
    // Time set aside for catching up. Unused, it's simply unused.
    const buffers = buffersFor(state.settings).map(
      (buffer, index): EventInput => ({
        id: `buffer:${index}`,
        title: "Buffer",
        rrule: `DTSTART:20200101T${buffer.time.replace(":", "")}00\nRRULE:FREQ=DAILY`,
        duration: { minutes: buffer.minutes },
        display: "background",
        classNames: ["bot-buffer"],
        extendedProps: { kind: "buffer", refId: "buffer", taskId: null },
      })
    )
    return [...planned, ...routines, ...placed, ...buffers]
    // plannedKey stands in for planned, which is new on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plannedKey,
    state.routines,
    state.routinePlacements,
    state.settings,
    hidden,
  ])

  /** Which occurrence of a routine is done, or has gone by, varies by date. */
  const eventClasses = useCallback(
    (arg: EventContentArg) => {
      const { kind, refId } = arg.event.extendedProps as {
        kind: CalendarItemKind
        refId: string
      }
      if (kind !== "routine" && kind !== "routine-placement") return []
      const date = arg.event.start ? localToday(arg.event.start) : ""
      const outcome = blockOutcome(state, kind, refId, date)
      if (outcome === "full") return ["bot-routine-done"]
      if (outcome === "minimum") return ["bot-routine-minimum"]
      if (outcome === "skipped") return ["bot-routine-skipped"]
      return !arg.event.allDay &&
        arg.event.end &&
        arg.event.end.getTime() < Date.now()
        ? ["bot-missed"]
        : []
    },
    [state]
  )

  const eventContent = useCallback(
    (arg: EventContentArg) => (
      <BlockContent event={arg.event} viewType={arg.view.type} />
    ),
    []
  )

  const eventDidMount = useCallback((arg: EventMountArg) => {
    const { color, refId } = arg.event.extendedProps as {
      color?: string
      refId: string
    }
    if (color) arg.el.style.setProperty("--routine", color)
    arg.el.setAttribute("data-block-id", refId)
    if (arg.event.start) {
      arg.el.setAttribute("data-date", localToday(arg.event.start))
    }
  }, [])

  return { events, eventClasses, eventContent, eventDidMount }
}
