"use client"

import type { EventApi } from "@fullcalendar/core"
import { useCallback, useRef, useState } from "react"
import { Play } from "lucide-react"

import {
  Floating,
  ReportedMinutes,
} from "@/components/workspace/calendar-overlays"
import { useStartFocus } from "@/components/workspace/focus-view"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import {
  blockOutcome,
  formatClockTime,
  formatTimeRange,
} from "@/lib/calendar/derived"
import { localToday } from "@/lib/workspace/dates"
import type { CalendarItemKind } from "@/lib/calendar/events"

const KIND_WORD: Partial<Record<CalendarItemKind, string>> = {
  planned: "Planned",
  focused: "Focus done",
  routine: "Routine",
  "routine-placement": "Routine",
}

/** Title first, then the time. The colour and border already say which kind. */
export function BlockContent({
  event,
  viewType,
}: {
  event: EventApi
  viewType: string
}) {
  const { state, dispatch } = useStore()
  const startFocus = useStartFocus({ stay: true })
  const [reporting, setReporting] = useState(false)
  const didItRef = useRef<HTMLButtonElement>(null)
  const anchor = useCallback(() => didItRef.current, [])
  const stopReporting = useCallback(() => setReporting(false), [])
  const {
    kind,
    refId,
    taskId,
    awaitingAnswer,
    timed,
    adjusted,
    window: part,
  } = event.extendedProps as {
    window?: string | null
    kind: CalendarItemKind
    refId: string
    taskId: string | null
    awaitingAnswer?: boolean
    timed?: boolean
    adjusted?: boolean
  }
  const { start, end, title } = event
  if (kind === "buffer") {
    return <span className="bot-buffer-label">Buffer</span>
  }
  const outcome = blockOutcome(
    state,
    kind,
    refId,
    start ? localToday(start) : ""
  )
  const windowName = part ? part[0].toUpperCase() + part.slice(1) : null
  const minutes =
    start && end ? (end.getTime() - start.getTime()) / 60_000 : null
  const session = state.planned.find((item) => item.id === refId)
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
      className={
        inMonth
          ? "bot-block flex items-baseline gap-1"
          : minutes !== null && minutes < 20
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
        {outcome === "full" && <span aria-label="Done in full">● </span>}
        {outcome === "minimum" && (
          <span aria-label="Done in the minimum version">◐ </span>
        )}
        {outcome === "skipped" && <span className="sr-only">Skipped: </span>}
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
