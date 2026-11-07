"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  EventContentArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core"

import { BlockContent } from "@/components/workspace/calendar-block"
import { useStore } from "@/components/workspace/store"
import { buildCalendarItems } from "@/lib/calendar/events"
import { buffersFor } from "@/lib/today/buffer"
import { localToday } from "@/lib/workspace/dates"

/** One source for what's drawn, so Calendar and Today's timeline can't disagree. */
export function useCalendarEvents(
  range: { from: string; until: string },
  hidden = false
) {
  const { state, today } = useStore()
  // Ticks so a block can ask "Did it?" as soon as its time has gone by.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Only changes when something new has ended, so a drag isn't disturbed.
  const items = useMemo(
    () => buildCalendarItems(state, today, now, range),
    [state, today, now, range]
  )
  const itemsKey = JSON.stringify(items)

  const events = useMemo<EventInput[]>(() => {
    if (hidden) return []
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
    return [...items, ...buffers]
    // itemsKey stands in for items, which is new on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, state.settings, hidden])

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
    if (color) arg.el.style.setProperty("--event-color", color)
    arg.el.setAttribute("data-block-id", refId)
    if (arg.event.start) {
      arg.el.setAttribute("data-date", localToday(arg.event.start))
    }
  }, [])

  return { events, eventContent, eventDidMount }
}
