"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  Check,
  Clock,
  ExternalLink,
  HelpCircle,
  Play,
  Plus,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EventEditor, ScopeChoice } from "@/components/workspace/event-editor"
import { startLabel, useStartFocus } from "@/components/workspace/focus-view"
import { TaskLink } from "@/components/workspace/parts"
import {
  nowIso,
  useEnterRecovery,
  useStore,
} from "@/components/workspace/store"
import {
  formatDuration,
  formatTimeRange,
  occurrenceOutcome,
  placePopover,
} from "@/lib/calendar/derived"
import type { RoutineOutcome } from "@/lib/calendar/derived"
import { occurrenceAt, plannedSession } from "@/lib/calendar/model"
import { shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

export const DURATION_CHIPS = [15, 30, 45, 60, 90]

const SHEET_BELOW_PX = 640

/**
 * Stays attached to what it's about. It reads the anchor's real position, again
 * whenever anything scrolls, so the time it shows always matches where it sits.
 */
export function Floating({
  anchor,
  label,
  onClose,
  children,
  wide = false,
  sheetWhenNarrow = false,
}: {
  anchor: () => Element | null
  label: string
  onClose: () => void
  children: React.ReactNode
  /** Has a whole form in it, so it needs the room. */
  wide?: boolean
  /** On a phone it rises from the bottom, where a thumb can reach it. */
  sheetWhenNarrow?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{
    left: number
    top: number
    sheet?: boolean
  } | null>(null)
  const misses = useRef(0)

  const update = useCallback(() => {
    const element = anchor()
    const box = ref.current
    if (!box) return
    const size = { width: box.offsetWidth, height: box.offsetHeight }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const sheet = sheetWhenNarrow && viewport.width < SHEET_BELOW_PX
    if (!element && !sheet) {
      // A new block takes a moment to draw. If it never does, it's still usable.
      misses.current += 1
      if (misses.current > 2) {
        setPlace(
          (old) =>
            old ?? {
              left: (viewport.width - size.width) / 2,
              top: (viewport.height - size.height) / 3,
            }
        )
      }
      return
    }
    misses.current = 0
    const next = sheet
      ? { left: 0, top: 0, sheet }
      : placePopover(element!.getBoundingClientRect(), size, viewport)
    setPlace((old) =>
      old?.left === next.left && old?.top === next.top ? old : next
    )
  }, [anchor, sheetWhenNarrow])

  // It can't take focus while hidden, so this waits until it's been placed.
  const placed = place !== null
  useEffect(() => {
    if (!placed) return
    ref.current
      ?.querySelector<HTMLElement>("input, button")
      ?.focus({ preventScroll: true })
  }, [placed])

  // Also runs when its content grows, such as opening "Change time".
  useLayoutEffect(update)

  useEffect(() => {
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    // Also catches the calendar redrawing, which moves blocks without a scroll.
    const redraw = window.setInterval(update, 100)
    return () => {
      window.clearInterval(redraw)
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [update])

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", escape)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-sheet={place?.sheet ? "" : undefined}
      style={{
        // Solid, so the calendar's text can't show through what's being read.
        background: "var(--card)",
        ...(place?.sheet
          ? { left: 0, right: 0, bottom: 0, width: "100%", maxWidth: "none" }
          : { left: place?.left ?? 0, top: place?.top ?? 0 }),
        visibility: place ? "visible" : "hidden",
      }}
      className={cn(
        "fixed z-40 max-h-[calc(100svh-1rem)] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto bot-card p-3 text-foreground [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-11 [&_[data-slot=button]]:px-4 [&_[data-slot=button]]:whitespace-normal",
        wide ? "w-[22rem]" : "w-72"
      )}
    >
      {children}
    </div>,
    document.body
  )
}

/** 15, 25, 45, 60, 90, or a length of your own. */
export function DurationChips({
  value,
  onChange,
  options = DURATION_CHIPS,
}: {
  value: number
  onChange: (minutes: number) => void
  options?: number[]
}) {
  const [custom, setCustom] = useState(!options.includes(value))
  // Its own text, so the field can be cleared while typing a new number.
  const [typed, setTyped] = useState(String(value))
  const chip = (active: boolean) =>
    cn(
      "min-h-9 min-w-9 rounded-full border border-line px-2.5 text-xs font-medium transition-colors outline-none ",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-card hover:bg-brand-soft"
    )
  return (
    <div>
      <div role="group" aria-label="Length" className="flex flex-wrap gap-1">
        {options.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={!custom && value === minutes}
            onClick={() => {
              setCustom(false)
              onChange(minutes)
            }}
            className={chip(!custom && value === minutes)}
          >
            {minutes}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => {
            setTyped(String(value))
            setCustom(true)
          }}
          className={chip(custom)}
        >
          Custom
        </button>
      </div>
      {custom && (
        <label className="mt-1.5 flex items-center gap-2 text-xs font-medium">
          Minutes
          <Input
            type="number"
            min={5}
            step={5}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              const minutes = Number(event.target.value)
              if (minutes > 0) onChange(minutes)
            }}
            className="h-9 w-20"
          />
        </label>
      )}
    </div>
  )
}

/** How long they say they spent, starting from what was planned. */
export function ReportedMinutes({
  planned,
  onSave,
  onCancel,
  cancelLabel = "Cancel",
}: {
  planned: number
  onSave: (minutes: number) => void
  onCancel: () => void
  cancelLabel?: string
}) {
  const [minutes, setMinutes] = useState(planned)
  return (
    <div className="space-y-2">
      <DurationChips value={minutes} onChange={setMinutes} />
      <p className="text-xs text-muted-foreground">
        About how long? This is saved as what you reported, not as timed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-11"
          onClick={() => onSave(minutes)}
        >
          Save {formatDuration(minutes)}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="min-h-11"
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}

/** Type to find an open task, or to make a new one with that name. */
export function TaskCombobox({
  value,
  onChange,
  onPick,
  label = "Task for this time",
  placeholder = "Find a task, or name a new one",
  maxLength = 200,
  quiet = false,
}: {
  value: string
  onChange: (text: string) => void
  onPick: (task: Task | null) => void
  label?: string
  placeholder?: string
  maxLength?: number
  /** Stays closed until something is typed, so a form isn't pushed down. */
  quiet?: boolean
}) {
  const { state } = useStore()
  const [open, setOpen] = useState(!quiet)
  const [active, setActive] = useState(-1)
  const text = value.trim().toLowerCase()
  const matches = state.tasks
    .filter(isActive)
    .filter((task) => task.title.toLowerCase().includes(text))
    .slice(0, 6)
  const exact = matches.some((task) => task.title.toLowerCase() === text)
  const options: { id: string; label: string; task: Task | null }[] = [
    ...matches.map((task) => ({ id: task.id, label: task.title, task })),
    ...(text && !exact
      ? [{ id: "new", label: `Create “${value.trim()}”`, task: null }]
      : []),
  ]
  const choose = (option: (typeof options)[number]) => {
    onChange(option.task?.title ?? value.trim())
    onPick(option.task)
    setOpen(false)
    setActive(-1)
  }
  const showing = open && options.length > 0
  return (
    <div>
      <Input
        autoFocus
        role="combobox"
        aria-label={label}
        aria-expanded={showing}
        aria-controls="calendar-task-options"
        aria-autocomplete="list"
        aria-activedescendant={
          showing && options[active]
            ? `calendar-task-${options[active].id}`
            : undefined
        }
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value)
          onPick(null)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={(event) => {
          if (!showing) return
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setActive((active + 1) % options.length)
          } else if (event.key === "ArrowUp") {
            event.preventDefault()
            setActive((active - 1 + options.length) % options.length)
          } else if (event.key === "Enter" && options[active]) {
            event.preventDefault()
            choose(options[active])
          }
        }}
        className="h-11"
      />
      {showing && (
        <ul
          id="calendar-task-options"
          role="listbox"
          aria-label="Tasks"
          className="mt-1 rounded-2xl border border-line bg-card py-1"
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`calendar-task-${option.id}`}
              role="option"
              aria-selected={index === active}
              // Keeps focus in the field, so the list isn't closed by the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className={cn(
                "flex min-h-9 cursor-pointer items-center gap-1.5 px-2.5 py-1 text-sm break-words",
                index === active && "bg-brand-soft"
              )}
            >
              {!option.task && (
                <Plus className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0">{option.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type BlockRef = {
  kind: "deadline" | "planned" | "focused" | "routine" | "buffer"
  /** The event, the deadline's task, or the focus session. */
  refId: string
  /** Which occurrence, by the date it's stored under. */
  occurrence?: string
  taskId: string | null
  title: string
  /** The local date of the occurrence that was clicked. */
  date: string
  start: Date | null
  end: Date | null
}

/** Start focus, Done, Edit, Open: what each means depends on the block. */
export function BlockPopover({
  block,
  anchor,
  onClose,
  onChangeDeadline,
  onOpenRoutine,
}: {
  block: BlockRef
  anchor: () => Element | null
  onClose: () => void
  onChangeDeadline: (taskId: string) => void
  onOpenRoutine: (eventId: string) => void
}) {
  const { state, dispatch, navigate } = useStore()
  const startFocus = useStartFocus()
  const enterRecovery = useEnterRecovery()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const task = state.tasks.find((item) => item.id === block.taskId)
  const event = state.events.find((item) => item.id === block.refId)
  const session =
    block.kind === "planned" ? plannedSession(state, block.refId) : undefined
  const key = block.occurrence ?? block.date
  const reported =
    block.kind === "focused" &&
    state.focusSessions.find((item) => item.id === block.refId)?.reported
  const isRoutine = block.kind === "routine" && Boolean(event)
  const occurrence = event ? occurrenceAt(event, key) : null

  const routineResult =
    isRoutine && event ? occurrenceOutcome(event, key) : null
  const done = session
    ? session.done
    : isRoutine
      ? routineResult !== null
      : task
        ? !isActive(task)
        : false

  function toggleDone() {
    if (session) dispatch({ type: "toggle-planned", id: session.id })
    else if (task) {
      dispatch({
        type: "set-status",
        id: task.id,
        at: nowIso(),
        status: isActive(task) ? "completed" : "in-progress",
      })
    }
    onClose()
  }

  function setOutcome(outcome: RoutineOutcome) {
    if (!event) return
    dispatch({ type: "occurrence-outcome", id: event.id, key, outcome })
    onClose()
  }

  const open = () => {
    onClose()
    if (isRoutine && event) onOpenRoutine(event.id)
    else if (task) navigate({ view: "task", id: task.id })
  }

  const blockMinutes =
    block.start && block.end
      ? (block.end.getTime() - block.start.getTime()) / 60_000
      : null
  const focusMinutes = Math.round(
    session?.minutes ?? blockMinutes ?? occurrence?.minutes ?? 25
  )
  const canStart = block.kind !== "focused" && !done
  const canEdit = block.kind !== "focused" && !done

  if (editing && event) {
    return <EventEditor event={event} occurrence={key} anchor={anchor} onClose={onClose} />
  }

  return (
    <Floating anchor={anchor} label={block.title} onClose={onClose}>
      <p className="text-[15px] font-medium break-words">{block.title}</p>
      <p className="mb-2 text-xs text-muted-foreground">
        {shortDate(block.date)}
        {block.start &&
          block.end &&
          `, ${formatTimeRange(block.start, block.end)}`}
        {blockMinutes !== null && ` · ${formatDuration(blockMinutes)}`}
        {isRoutine && occurrence?.adjusted && " · adjusted"}
        {reported && " · you said you did this"}
      </p>
      {deleting && event?.repeat ? (
        <ScopeChoice
          question="Delete which ones?"
          onChoose={(scope) => {
            dispatch({ type: "delete-event", id: event.id, key, scope })
            onClose()
          }}
          onCancel={() => setDeleting(false)}
        />
      ) : (
        <div className="grid gap-1">
          {canStart && (
            <Button
              type="button"
              size="lg"
              className="min-h-10 justify-start"
              onClick={() => {
                onClose()
                startFocus(block.taskId, focusMinutes, session?.id)
              }}
            >
              <Play aria-hidden />
              {state.timer
                ? startLabel(state.timer, focusMinutes)
                : "Start focus"}
            </Button>
          )}
          {isRoutine && event && (
            <div className="space-y-1 pb-1">
              {event.minimum && (
                <p className="text-xs text-muted-foreground">
                  Minimum: {event.minimum}
                </p>
              )}
              <div
                role="group"
                aria-label="How it went"
                className="flex flex-wrap gap-1"
              >
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  aria-pressed={routineResult === "full"}
                  className="min-h-10 flex-1"
                  onClick={() =>
                    setOutcome(routineResult === "full" ? null : "full")
                  }
                >
                  ● Full
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  aria-pressed={routineResult === "minimum"}
                  className="min-h-10 flex-1"
                  onClick={() =>
                    setOutcome(routineResult === "minimum" ? null : "minimum")
                  }
                >
                  ◐ Minimum
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  aria-pressed={routineResult === "skipped"}
                  className="min-h-10 flex-1"
                  onClick={() =>
                    setOutcome(routineResult === "skipped" ? null : "skipped")
                  }
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
          {block.kind !== "focused" && !isRoutine && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-10 justify-start"
              onClick={toggleDone}
            >
              <Check aria-hidden />
              {done ? "Not done yet" : "Done"}
            </Button>
          )}
          {canEdit && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-10 justify-start"
              onClick={() => {
                if (block.kind === "deadline" && block.taskId) {
                  onClose()
                  onChangeDeadline(block.taskId)
                } else setEditing(true)
              }}
            >
              <Clock aria-hidden />
              {block.kind === "deadline" ? "Change date" : "Edit"}
            </Button>
          )}
          {task && <TaskLink task={task} className="px-3" />}
          {(task || isRoutine) && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-10 justify-start"
              onClick={open}
            >
              <ExternalLink aria-hidden />
              Open
            </Button>
          )}
          {session && !done && task && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-10 justify-start text-muted-foreground"
              onClick={() => {
                onClose()
                enterRecovery(task.id, session.id)
              }}
            >
              <HelpCircle aria-hidden />
              I’m stuck
            </Button>
          )}
          {reported && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-10 justify-start text-muted-foreground"
              onClick={() => {
                dispatch({
                  type: "undo-reported-session",
                  at: nowIso(),
                  sessionId: block.refId,
                })
                onClose()
              }}
            >
              <Trash2 aria-hidden />I didn’t actually do this
            </Button>
          )}
          {(session || isRoutine) && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-10 justify-start text-muted-foreground"
              onClick={() => {
                if (session) {
                  dispatch({
                    type: "remove-planned",
                    at: nowIso(),
                    id: session.id,
                  })
                  onClose()
                } else if (event?.repeat) {
                  setDeleting(true)
                } else if (event) {
                  dispatch({
                    type: "delete-event",
                    id: event.id,
                    key,
                    scope: "all",
                  })
                  onClose()
                }
              }}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          )}
        </div>
      )}
    </Floating>
  )
}
