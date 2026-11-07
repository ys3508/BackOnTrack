"use client"

import type { EventApi } from "@fullcalendar/core"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { Flag, Play } from "lucide-react"

import {
  Floating,
  ReportedMinutes,
} from "@/components/workspace/calendar-overlays"
import { useStartFocus } from "@/components/workspace/focus-view"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { formatClockTime, formatTimeRange } from "@/lib/calendar/derived"
import { plannedSession } from "@/lib/calendar/model"
import type { BlockStatus } from "@/lib/calendar/model"
import type { CalendarItemKind } from "@/lib/calendar/events"

const KIND_WORD: Partial<Record<CalendarItemKind, string>> = {
  planned: "Planned",
  focused: "Focus done",
  routine: "Routine",
}

/** Title first, then the time. The colour says what it is, the style how it went. */
export function BlockContent({
  event,
  viewType,
}: {
  /** A calendar event, or anything else drawn the same way. */
  event: Pick<EventApi, "start" | "end" | "title" | "allDay" | "extendedProps">
  viewType: string
}) {
  const { state, dispatch } = useStore()
  const startFocus = useStartFocus({ stay: true })
  const [reporting, setReporting] = useState(false)
  const didItRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const anchor = useCallback(() => didItRef.current, [])
  const stopReporting = useCallback(() => setReporting(false), [])
  const {
    kind,
    refId,
    taskId,
    awaitingAnswer,
    timed,
    adjusted,
    color,
    status,
    occupied,
    window: part,
  } = event.extendedProps as {
    window?: string | null
    kind: CalendarItemKind
    refId: string
    taskId: string | null
    awaitingAnswer?: boolean
    timed?: boolean
    adjusted?: boolean
    color?: string
    status?: BlockStatus
    occupied?: boolean
  }
  const { start, end, title } = event
  // The calendar keeps a block's element when it's redrawn, so a new colour has
  // to be handed to it here rather than only when it first appears.
  useLayoutEffect(() => {
    const block = rootRef.current?.closest<HTMLElement>(".fc-event")
    if (block && color) block.style.setProperty("--event-color", color)
  }, [color])
  // Something is in it, and that's what the block on top is about.
  if (occupied) return <span className="bot-buffer-label">{title}</span>
  const windowName = part ? part[0].toUpperCase() + part.slice(1) : null
  const minutes =
    start && end ? (end.getTime() - start.getTime()) / 60_000 : null
  const session = plannedSession(state, refId)
  const inMonth = viewType === "dayGridMonth"
  const canPlay =
    !inMonth &&
    kind === "planned" &&
    timed &&
    !awaitingAnswer &&
    !session?.done &&
    !state.timer

  const answer = (outcome: "did" | "didnt", reported?: number) =>
    dispatch({
      type: "planned-outcome",
      at: nowIso(),
      id: refId,
      outcome,
      sessionId: newId(),
      minutes: reported,
    })

  return (
    <div
      ref={rootRef}
      className={
        inMonth
          ? "bot-block flex items-baseline gap-1"
          : minutes !== null && minutes < 30
            ? "bot-block bot-block-tight flex items-baseline gap-1.5"
            : "bot-block"
      }
    >
      {KIND_WORD[kind] && <span className="sr-only">{KIND_WORD[kind]}: </span>}
      {inMonth && start && !event.allDay && (
        <span className="bot-block-time shrink-0">
          {formatClockTime(start)}
        </span>
      )}
      <span className="bot-block-title">
        {kind === "deadline" && (
          <Flag className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        )}
        {status === "done" && <span className="sr-only">Done: </span>}
        {status === "minimum" && (
          <span className="sr-only">Done in the minimum version: </span>
        )}
        {status === "skipped" && <span className="sr-only">Skipped: </span>}
        {title}
      </span>
      {!inMonth && start && end && !event.allDay && (
        <span className="bot-block-time">{formatTimeRange(start, end)}</span>
      )}
      {windowName && <span className="bot-block-time">{windowName}</span>}
      {adjusted && <span className="bot-block-adjusted">adjusted</span>}
      {!inMonth && (canPlay || awaitingAnswer) && (
        <span className="bot-block-actions" data-block-action>
          {canPlay && minutes !== null && (
            <button
              type="button"
              data-block-action
              className="bot-block-play"
              aria-label={`Start a ${Math.round(minutes)}-minute timer for ${title}`}
              title={`Start a ${Math.round(minutes)}-minute timer`}
              onClick={() => startFocus(taskId, Math.round(minutes), refId)}
            >
              <Play className="size-3" aria-hidden />
            </button>
          )}
          {awaitingAnswer && (
            <>
              <button
                ref={didItRef}
                type="button"
                data-block-action
                aria-label={`Did it: ${title}`}
                aria-expanded={reporting}
                onClick={() => setReporting(true)}
              >
                ✓<span className="bot-block-word"> Did it</span>
              </button>
              <button
                type="button"
                data-block-action
                aria-label={`Didn’t: ${title}`}
                onClick={() => answer("didnt")}
              >
                <span className="bot-block-icon" aria-hidden>
                  ✕
                </span>
                <span className="bot-block-word">Didn’t</span>
              </button>
            </>
          )}
        </span>
      )}
      {reporting && (
        <Floating
          anchor={anchor}
          label={`Did it: ${title}`}
          onClose={stopReporting}
        >
          <p className="mb-2 text-[15px] font-medium break-words">{title}</p>
          <ReportedMinutes
            planned={session?.minutes ?? Math.round(minutes ?? 25)}
            onSave={(reported) => answer("did", reported)}
            onCancel={stopReporting}
          />
        </Floating>
      )}
    </div>
  )
}
