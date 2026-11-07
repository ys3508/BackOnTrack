"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Plus } from "lucide-react"
import dayGridPlugin from "@fullcalendar/daygrid"
import interactionPlugin from "@fullcalendar/interaction"
import type {
  DateClickArg,
  DropArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction"
import multiMonthPlugin from "@fullcalendar/multimonth"
import FullCalendar from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/timegrid"
import type {
  DateSelectArg,
  DateSpanApi,
  DatesSetArg,
  DayCellContentArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { AuraStar } from "@/components/workspace/aura"
import { BlockPopover } from "@/components/workspace/calendar-overlays"
import type { BlockRef } from "@/components/workspace/calendar-overlays"
import {
  BufferChip,
  MyRoutines,
  NotStartedTray,
} from "@/components/workspace/calendar-sidebar"
import { EventEditor, ScopeChoice } from "@/components/workspace/event-editor"
import type {
  EditorPreview,
  EventDraft,
} from "@/components/workspace/event-editor"
import { ConfirmDialog } from "@/components/workspace/parts"
import { Overview } from "@/components/workspace/overview"
import { useCalendarEvents } from "@/components/workspace/use-calendar-events"
import { ReplanDialog } from "@/components/workspace/schedule"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import {
  defaultSessionMinutes,
  formatClockTime,
  formatDuration,
  heatLevel,
  hourRange,
} from "@/lib/calendar/derived"
import { droppedSlot } from "@/lib/calendar/events"
import { focusByDay } from "@/lib/calendar/overview"
import type { PeriodKind } from "@/lib/calendar/overview"
import {
  addClock,
  minutesBetween,
  newBuffer,
  nextFreeQuarter,
  occurrenceAt,
} from "@/lib/calendar/model"
import type { EventPatch } from "@/lib/calendar/model"
import { downloadIcs } from "@/lib/calendar/ics"
import { withGap } from "@/lib/today/buffer"
import type { CalendarItemKind } from "@/lib/calendar/events"
import { addDays, localToday, shortDate } from "@/lib/workspace/dates"
import type { Task } from "@/lib/workspace/schemas"

const DAY_VIEW = "timeGridDay"
const WEEK_VIEW = "timeGridWeek"
const MONTH_VIEW = "dayGridMonth"
const YEAR_VIEW = "multiMonthYear"

type DeadlineMove = { task: Task; date: string }

type AskingScope = {
  id: string
  key: string
  title: string
  patch: EventPatch
}
type Open = { block: BlockRef; element: Element }
type Shown = {
  type: string
  from: string
  until: string
  /** The period itself: a Month's grid also shows days around it. */
  periodFrom: string
  periodUntil: string
}

const PERIOD_OF: Record<string, PeriodKind> = {
  [DAY_VIEW]: "day",
  [WEEK_VIEW]: "week",
  [MONTH_VIEW]: "month",
  [YEAR_VIEW]: "year",
}

const pad = (value: number) => String(value).padStart(2, "0")

/** How a block looks says how it went, so this doesn't use anyone's colour. */
const LEGEND = [
  { label: "Planned", style: "bot-planned" },
  { label: "Done", style: "bot-done" },
  { label: "Minimum", style: "bot-minimum" },
  { label: "Skipped", style: "bot-skipped" },
  { label: "Buffer", style: "bot-buffer-block" },
  { label: "Deadline", style: "bot-deadline" },
]

/** About an hour before now, so the current time is on screen and has context. */
function scrollPosition() {
  const now = new Date()
  return `${pad(Math.max(0, now.getHours() - 1))}:00:00`
}

export function CalendarView() {
  const { state, dispatch, today } = useStore()
  const { settings } = state
  const [selected, setSelected] = useState(today)
  const [deadlineMove, setDeadlineMove] = useState<DeadlineMove | null>(null)
  const [replanning, setReplanning] = useState<Task | null>(null)
  const [creating, setCreating] = useState<EventDraft | null>(null)
  const [preview, setPreview] = useState<EditorPreview | null>(null)
  const [askingScope, setAskingScope] = useState<AskingScope | null>(null)
  const [opened, setOpened] = useState<Open | null>(null)
  const [editingRoutine, setEditingRoutine] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown>({
    type: DAY_VIEW,
    from: today,
    until: addDays(today, 1),
    periodFrom: today,
    periodUntil: addDays(today, 1),
  })
  const calendar = useRef<FullCalendar>(null)

  const isYear = shown.type === YEAR_VIEW
  const isMonth = shown.type === MONTH_VIEW
  const isTimed = shown.type === DAY_VIEW || shown.type === WEEK_VIEW
  const closeCreating = useCallback(() => {
    setCreating(null)
    setPreview(null)
  }, [])
  const closeOpened = useCallback(() => setOpened(null), [])

  const heat = useMemo(() => focusByDay(state.activity), [state.activity])
  const hours = useMemo(
    () => hourRange(state, shown.from, shown.until),
    [state, shown.from, shown.until]
  )

  const range = useMemo(
    () => ({ from: shown.from, until: shown.until }),
    [shown.from, shown.until]
  )
  const { events, eventContent, eventDidMount } = useCalendarEvents(
    range,
    isYear
  )

  /** Shows where a new event will land, while it's being filled in. */
  const withPending = useMemo<EventInput[]>(() => {
    const place = preview ?? (creating && { ...creating, flexible: false })
    if (!creating || !place || place.flexible || !isTimed) return events
    const start = new Date(`${place.date}T${place.start}:00`)
    return [
      ...events,
      {
        id: "pending",
        title: "New · not saved yet",
        start,
        end: new Date(start.getTime() + place.minutes * 60_000),
        editable: false,
        classNames: ["bot-pending"],
        extendedProps: { kind: "pending", refId: "pending", taskId: null },
      },
    ]
  }, [events, creating, preview, isTimed])

  const selectedDay = useCallback(
    (date: Date) => (localToday(date) === selected ? ["bot-selected-day"] : []),
    [selected]
  )

  function openEditor(draft: EventDraft) {
    setSelected(draft.date)
    setOpened(null)
    setPreview(null)
    setCreating(draft)
  }

  function handleDateClick(info: DateClickArg) {
    const date = info.dateStr.slice(0, 10)
    if (shown.type === YEAR_VIEW) {
      setSelected(date)
      setOpened(null)
      calendar.current?.getApi().changeView(DAY_VIEW, date)
      return
    }
    // A buffer with something in it has only its empty part left to click on.
    const clicked = info.dateStr.slice(0, 16)
    const holder = events.find(
      (item) =>
        item.display === "background" &&
        typeof item.start === "string" &&
        typeof item.end === "string" &&
        item.start <= clicked &&
        clicked < item.end
    )
    if (holder && !info.allDay) {
      const element = [
        ...document.querySelectorAll(
          `.fc-bg-event[data-block-id="${holder.extendedProps?.refId}"]`
        ),
      ].find((item) => item.getAttribute("data-date") === date)
      if (element) {
        closeCreating()
        setOpened({
          element,
          block: {
            kind: "buffer",
            refId: holder.extendedProps?.refId,
            occurrence: holder.extendedProps?.key,
            taskId: null,
            title: String(holder.title),
            date,
            start: new Date(holder.start as string),
            end: new Date(holder.end as string),
          },
        })
        return
      }
    }
    const minutes = defaultSessionMinutes(settings)
    const allDay = info.allDay
    openEditor({
      date,
      // A click in Month has no hour of its own, so it finds the next free one.
      start:
        isMonth
          ? nextFreeQuarter(state, date, "09:00", minutes)
          : allDay
            ? "00:00"
            : withGap(state, date, info.dateStr.slice(11, 16), minutes),
      minutes,
      flexible: allDay && !isMonth,
    })
  }

  /** Dragging across slots sets the length directly. */
  function handleSelect(info: DateSelectArg) {
    openEditor({
      date: localToday(info.start),
      start: `${pad(info.start.getHours())}:${pad(info.start.getMinutes())}`,
      minutes: (info.end.getTime() - info.start.getTime()) / 60_000,
      chosen: true,
    })
    // The pending block takes over from the selection's mirror.
    calendar.current?.getApi().unselect()
  }

  function handleEventClick(info: EventClickArg) {
    // Its own buttons on the block, such as Did it, have already done their job.
    if ((info.jsEvent.target as Element).closest?.("[data-block-action]")) {
      return
    }
    const { kind, refId, taskId, key } = info.event.extendedProps as {
      kind: CalendarItemKind
      refId: string
      taskId: string | null
      key?: string
    }
    if (kind === "pending") return
    const { start, end } = info.event
    info.jsEvent.preventDefault()
    closeCreating()
    setOpened({
      element: info.el,
      block: {
        kind,
        refId,
        occurrence: key,
        taskId,
        title: info.event.title,
        date: start ? localToday(start) : selected,
        start,
        end,
      },
    })
  }

  /** A repeating event asks how far this reaches; anything else just changes. */
  function changeOccurrence(
    id: string,
    key: string,
    title: string,
    patch: EventPatch
  ) {
    const event = state.events.find((item) => item.id === id)
    if (event?.repeat) {
      setAskingScope({ id, key, title, patch })
    } else if (event) {
      dispatch({
        type: "edit-event",
        id,
        key,
        scope: "all",
        patch,
        newId: newId(),
      })
    }
  }

  function handleEventDrop(info: EventDropArg) {
    const { kind, refId, key } = info.event.extendedProps as {
      kind: CalendarItemKind
      refId: string
      key?: string
    }
    const start = info.event.start
    if (!start) return info.revert()
    const slot = droppedSlot(start, info.event.allDay)
    setOpened(null)

    if (kind === "planned") {
      dispatch({
        type: "move-planned",
        at: nowIso(),
        id: refId,
        date: slot.date,
        time: slot.time,
      })
      return
    }
    // The change is made by the state below, so the drag itself snaps back.
    info.revert()
    if (kind === "routine" || kind === "buffer") {
      const event = state.events.find((item) => item.id === refId)
      const before = event && occurrenceAt(event, key ?? slot.date)
      if (!event || !before) return
      changeOccurrence(refId, before.key, info.event.title, {
        date: slot.date,
        ...(slot.time && !event.flexible
          ? { start: slot.time, end: addClock(slot.time, before.minutes) }
          : {}),
      })
      return
    }
    // A deadline never moves without a decision, so it snaps back and asks.
    const task = state.tasks.find((item) => item.id === refId)
    if (kind === "deadline" && task) {
      setDeadlineMove({ task, date: slot.date })
    }
  }

  function handleEventResize(info: EventResizeDoneArg) {
    const { start, end } = info.event
    const { kind, refId, key } = info.event.extendedProps as {
      kind: CalendarItemKind
      refId: string
      key?: string
    }
    if (!start || !end) return info.revert()
    const minutes = (end.getTime() - start.getTime()) / 60_000
    setOpened(null)
    if (kind === "planned") {
      dispatch({ type: "resize-planned", at: nowIso(), id: refId, minutes })
      dispatch({ type: "settings", patch: { lastSessionMinutes: minutes } })
      return
    }
    info.revert()
    if (kind !== "routine" && kind !== "buffer") return
    const clock = `${pad(start.getHours())}:${pad(start.getMinutes())}`
    changeOccurrence(refId, key ?? localToday(start), info.event.title, {
      end: addClock(clock, minutes),
    })
  }

  /** Something dragged in from the tray or from My routines. */
  function handleDrop(info: DropArg) {
    const slot = droppedSlot(info.date, info.allDay)
    const kind = info.draggedEl.getAttribute("data-kind")
    const id = info.draggedEl.getAttribute("data-id")
    if (!id) return
    if (kind === "task") {
      const task = state.tasks.find((item) => item.id === id)
      const length = defaultSessionMinutes(settings, task)
      dispatch({
        type: "add-planned",
        at: nowIso(),
        session: {
          id: newId(),
          taskId: id,
          date: slot.date,
          time: slot.time && withGap(state, slot.date, slot.time, length),
          minutes: length,
          label: "",
          done: false,
        },
      })
    }
    if (kind === "buffer") {
      const length = settings.bufferMinutes
      dispatch({
        type: "add-event",
        event: newBuffer(
          newId(),
          slot.date,
          slot.time ?? nextFreeQuarter(state, slot.date, "09:00", length),
          length,
          nowIso()
        ),
      })
    }
    if (kind === "routine") {
      const routine = state.events.find((item) => item.id === id)
      if (!routine) return
      // An extra one, on a day of its own, that still counts for this routine.
      const start = slot.time ?? routine.start
      dispatch({
        type: "add-event",
        event: {
          ...routine,
          id: newId(),
          seriesId: routine.seriesId ?? routine.id,
          date: slot.date,
          start,
          end: addClock(start, minutesBetween(routine.start, routine.end)),
          flexible: routine.flexible || !slot.time,
          repeat: null,
          overrides: {},
          outcomes: {},
          createdAt: nowIso(),
        },
      })
    }
  }

  const lastView = useRef("")
  const handleDatesSet = useCallback((info: DatesSetArg) => {
    const from = localToday(info.start)
    setShown({
      type: info.view.type,
      from,
      until: localToday(info.end),
      periodFrom: localToday(info.view.currentStart ?? info.start),
      periodUntil: localToday(info.view.currentEnd ?? info.end),
    })
    // In Day view, the day on screen is the chosen day.
    if (info.view.type === DAY_VIEW) setSelected(from)
    setOpened(null)
    if (info.view.type !== lastView.current) {
      lastView.current = info.view.type
      if (info.view.type === DAY_VIEW || info.view.type === WEEK_VIEW) {
        window.setTimeout(() => {
          calendar.current?.getApi().scrollToTime(scrollPosition())
        }, 0)
      }
    }
  }, [])

  const dayClasses = useCallback(
    (arg: DayCellContentArg) => {
      const date = localToday(arg.date)
      // A whole outlined column would be noise, so Week marks its header instead.
      if (shown.type === MONTH_VIEW) return selectedDay(arg.date)
      if (shown.type !== YEAR_VIEW) return []
      const level = heatLevel(heat.get(date) ?? 0)
      return level ? [`bot-heat-${level}`] : []
    },
    [heat, selectedDay, shown.type]
  )

  const dayContent = useCallback(
    (arg: DayCellContentArg) => {
      if (shown.type !== YEAR_VIEW) return undefined
      const minutes = heat.get(localToday(arg.date)) ?? 0
      return (
        <span
          title={minutes ? `${formatDuration(minutes)} of focus` : undefined}
        >
          {arg.dayNumberText}
          {minutes > 0 && (
            <span className="sr-only">
              , {formatDuration(minutes)} of focus
            </span>
          )}
        </span>
      )
    },
    [heat, shown.type]
  )

  /** The same editor as clicking the grid, at the next quarter hour that's free. */
  function addToSelected() {
    const nowDate = new Date()
    const minutes = defaultSessionMinutes(settings)
    openEditor({
      date: selected,
      start: nextFreeQuarter(
        state,
        selected,
        selected === today
          ? `${pad(nowDate.getHours())}:${pad(nowDate.getMinutes())}`
          : "09:00",
        minutes
      ),
      minutes,
    })
  }

  const pendingAnchor = useCallback(
    () => document.querySelector(".bot-pending"),
    []
  )
  const creatingDate = creating?.date
  const dayAnchor = useCallback(
    () =>
      document.querySelector(`.fc-daygrid-day[data-date="${creatingDate}"]`) ??
      document.querySelector(".fc-view-harness"),
    [creatingDate]
  )
  const openedElement = opened?.element
  const openedId = opened?.block.refId
  const openedDate = opened?.block.date
  const blockAnchor = useCallback(() => {
    if (openedElement?.isConnected) return openedElement
    // The calendar redraws blocks, so it finds this one again by its id.
    return (
      [...document.querySelectorAll(`[data-block-id="${openedId}"]`)].find(
        (element) => element.getAttribute("data-date") === openedDate
      ) ?? null
    )
  }, [openedElement, openedId, openedDate])

  return (
    <div className="space-y-4">
      <ScreenHeading>Calendar</ScreenHeading>

      {!state.events.length && (
        <p className="bot-rise flex items-center gap-3 rounded-[1.5rem] bg-white/70 px-4 py-3 text-sm">
          <AuraStar className="size-9 shrink-0" />
          <span>
            A wide-open day. Drag across the grid to plan a block, or click any
            time to start small.
          </span>
        </p>
      )}

      <Overview
        kind={PERIOD_OF[shown.type] ?? "day"}
        from={shown.periodFrom}
        until={shown.periodUntil}
      />

      <div
        className={
          isYear
            ? "space-y-4"
            : "grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]"
        }
      >
        {!isYear && (
          <aside
            aria-label="Things to put on the calendar"
            className="order-2 space-y-5 lg:sticky lg:top-4 lg:order-none"
          >
            {isTimed && (
              <NotStartedTray
                onSchedule={(taskId) =>
                  setReplanning(
                    state.tasks.find((task) => task.id === taskId) ?? null
                  )
                }
              />
            )}
            <BufferChip />
            <MyRoutines
              editingId={editingRoutine}
              setEditingId={setEditingRoutine}
            />
          </aside>
        )}

        <div className="min-w-0 space-y-2">
          {isYear ? (
            <ul
              aria-label="Focus minutes key"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
            >
              <li>Focus each day:</li>
              {["up to 25 min", "up to 1 h", "up to 2 h", "more"].map(
                (label, index) => (
                  <li key={label} className="flex items-center gap-1">
                    <span
                      aria-hidden
                      className={`inline-block size-3.5 rounded-sm bot-heat-swatch-${index + 1}`}
                    />
                    {label}
                  </li>
                )
              )}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ul
                aria-label="Calendar key"
                className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
              >
                {LEGEND.map((item) => (
                  <li key={item.label} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`bot-legend-swatch ${item.style}`}
                    />
                    {item.label}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="min-h-10 text-muted-foreground"
                  onClick={() => downloadIcs(state, today)}
                >
                  Export .ics
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="min-h-10"
                  onClick={addToSelected}
                >
                  <Plus aria-hidden />
                  Add to {shortDate(selected)}
                </Button>
              </div>
            </div>
          )}

          <Card className="p-3 sm:p-4">
            <FullCalendar
              ref={calendar}
              plugins={[
                dayGridPlugin,
                timeGridPlugin,
                multiMonthPlugin,
                interactionPlugin,
              ]}
              initialView={DAY_VIEW}
              headerToolbar={{
                left: "title",
                right: `today prev,next ${DAY_VIEW},${WEEK_VIEW},${MONTH_VIEW},${YEAR_VIEW}`,
              }}
              buttonText={{
                today: "Today",
                day: "Day",
                week: "Week",
                month: "Month",
                year: "Year",
              }}
              height={isTimed ? 720 : "auto"}
              slotMinTime={`${pad(hours.first)}:00:00`}
              slotMaxTime={`${pad(hours.last)}:00:00`}
              scrollTime={scrollPosition()}
              snapDuration="00:15:00"
              // Side by side, so a clash can be seen and both can still be read.
              slotEventOverlap={false}
              slotLabelContent={(arg) => formatClockTime(arg.date)}
              nowIndicator
              allDayText=""
              dayMaxEvents={3}
              multiMonthMaxColumns={4}
              multiMonthMinWidth={200}
              eventInteractive
              eventDisplay="block"
              editable
              droppable
              selectable={isTimed}
              selectMirror
              // A plain click stays a click, and only a real drag selects.
              selectMinDistance={5}
              selectAllow={(span: DateSpanApi) =>
                !span.allDay &&
                localToday(span.start) ===
                  localToday(new Date(span.end.getTime() - 1))
              }
              select={handleSelect}
              events={withPending}
              eventContent={eventContent}
              eventDidMount={eventDidMount}
              dayCellClassNames={dayClasses}
              dayCellContent={dayContent}
              dayHeaderClassNames={(info) =>
                shown.type === WEEK_VIEW ? selectedDay(info.date) : []
              }
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventDrop={handleEventDrop}
              eventResize={handleEventResize}
              drop={handleDrop}
              datesSet={handleDatesSet}
            />
          </Card>
          {creating && (
            <EventEditor
              key={`${creating.date}-${creating.start}-${creating.minutes}`}
              draft={creating}
              anchor={
                !isTimed || preview?.flexible || creating.flexible
                  ? dayAnchor
                  : pendingAnchor
              }
              onPreview={setPreview}
              onClose={closeCreating}
            />
          )}
          {opened && (
            <BlockPopover
              key={`${opened.block.refId}-${opened.block.date}`}
              block={opened.block}
              anchor={blockAnchor}
              onClose={closeOpened}
              onChangeDeadline={(taskId) => {
                const task = state.tasks.find((item) => item.id === taskId)
                if (task) setReplanning(task)
              }}
              onOpenRoutine={setEditingRoutine}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deadlineMove)}
        title="Change the deadline?"
        confirmLabel={
          deadlineMove
            ? `Change it to ${shortDate(deadlineMove.date)}`
            : "Change it"
        }
        cancelLabel="Keep the deadline"
        onCancel={() => setDeadlineMove(null)}
        onConfirm={() => {
          if (deadlineMove) {
            dispatch({
              type: "set-deadline",
              id: deadlineMove.task.id,
              at: nowIso(),
              deadline: deadlineMove.date,
            })
          }
          setDeadlineMove(null)
        }}
      >
        <p>
          “{deadlineMove?.task.title}” is due{" "}
          {deadlineMove?.task.deadline && shortDate(deadlineMove.task.deadline)}
          . Only change this if the deadline itself has really moved.
        </p>
        <button
          type="button"
          onClick={() => {
            if (deadlineMove) {
              dispatch({
                type: "add-planned",
                at: nowIso(),
                session: {
                  id: newId(),
                  taskId: deadlineMove.task.id,
                  date: deadlineMove.date,
                  time: null,
                  minutes: 25,
                  label: "",
                  done: false,
                },
              })
            }
            setDeadlineMove(null)
          }}
          className="mt-3 min-h-11 rounded-md text-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Plan work on {deadlineMove && shortDate(deadlineMove.date)} instead
        </button>
      </ConfirmDialog>

      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />

      <Dialog.Root
        open={Boolean(askingScope)}
        onOpenChange={(next) => !next && setAskingScope(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-ink/25" />
          <Dialog.Popup
            style={{ background: "var(--card)" }}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 bot-card p-5 outline-none"
          >
            <Dialog.Title className="sr-only">
              Change which occurrences
            </Dialog.Title>
            {askingScope && (
              <ScopeChoice
                question={`Change which “${askingScope.title}”?`}
                onCancel={() => setAskingScope(null)}
                onChoose={(scope) => {
                  dispatch({
                    type: "edit-event",
                    id: askingScope.id,
                    key: askingScope.key,
                    scope,
                    patch: askingScope.patch,
                    newId: newId(),
                  })
                  setAskingScope(null)
                }}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
