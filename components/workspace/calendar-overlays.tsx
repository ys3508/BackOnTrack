"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ExternalLink, Clock, Play, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { startLabel, useStartFocus } from "@/components/workspace/focus-view"
import { nowIso, useStore } from "@/components/workspace/store"
import { formatDuration, routineTime } from "@/lib/calendar/derived"
import { shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"

export type Point = { x: number; y: number }

/** Floats over the calendar at the place that was clicked. */
function Floating({
  at,
  label,
  onClose,
  children,
}: {
  at: Point
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(at.x)

  useEffect(() => {
    const parent = ref.current?.parentElement
    const width = ref.current?.offsetWidth ?? 0
    // Stays inside the calendar when opened near its right edge.
    const room = (parent?.clientWidth ?? at.x + width) - width - 8
    const timer = window.setTimeout(
      () => setLeft(Math.max(8, Math.min(at.x, room))),
      0
    )
    return () => window.clearTimeout(timer)
  }, [at.x])

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

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ left, top: at.y }}
      className="absolute z-20 w-72 max-w-[calc(100%-1rem)] rounded-2xl border border-border bg-card p-3 shadow-lg"
    >
      {children}
    </div>
  )
}

/** Type a title, press Enter. Nothing else is required to put it on the calendar. */
export function InlineCreate({
  at,
  label,
  placeholder,
  suggestTasks,
  onCreate,
  onClose,
}: {
  at: Point
  label: string
  placeholder: string
  /** Offers open tasks, so time can be set aside for one without retyping it. */
  suggestTasks?: boolean
  onCreate: (title: string) => void
  onClose: () => void
}) {
  const { state } = useStore()
  const [title, setTitle] = useState("")
  return (
    <Floating at={at} label={label} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const value = title.trim()
          if (value) onCreate(value)
        }}
      >
        <label
          htmlFor="calendar-inline"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
        <Input
          id="calendar-inline"
          autoFocus
          value={title}
          maxLength={200}
          placeholder={placeholder}
          list={suggestTasks ? "calendar-open-tasks" : undefined}
          onChange={(event) => setTitle(event.target.value)}
          className="h-11"
        />
        {suggestTasks && (
          <datalist id="calendar-open-tasks">
            {state.tasks.filter(isActive).map((task) => (
              <option key={task.id} value={task.title} />
            ))}
          </datalist>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter to add, Esc to cancel.
        </p>
      </form>
    </Floating>
  )
}

export type BlockRef = {
  kind: "deadline" | "planned" | "focused" | "routine" | "routine-placement"
  refId: string
  taskId: string | null
  title: string
  /** The local date of the occurrence that was clicked. */
  date: string
}

function ChangeTime({
  date,
  time,
  minutes,
  allowNoTime,
  onSave,
  onCancel,
}: {
  date: string
  time: string | null
  minutes?: number
  allowNoTime?: boolean
  onSave: (date: string, time: string | null, minutes?: number) => void
  onCancel: () => void
}) {
  const [day, setDay] = useState(date)
  const [clock, setClock] = useState(time ?? "")
  const [length, setLength] = useState(minutes ?? 25)
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (day && (clock || allowNoTime)) {
          onSave(day, clock || null, length)
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2 block">
          <span className="mb-0.5 block text-xs font-medium">Day</span>
          <Input
            type="date"
            value={day}
            max="9999-12-31"
            onChange={(event) => setDay(event.target.value)}
            className="h-10"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs font-medium">Time</span>
          <Input
            type="time"
            value={clock}
            onChange={(event) => setClock(event.target.value)}
            className="h-10"
          />
        </label>
        {minutes !== undefined && (
          <label className="block">
            <span className="mb-0.5 block text-xs font-medium">Minutes</span>
            <Input
              type="number"
              min={5}
              step={5}
              value={length}
              onChange={(event) => setLength(Number(event.target.value))}
              className="h-10"
            />
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="min-h-10">
          Save
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="min-h-10"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Start focus, Done, Change time, Open: what each means depends on the block. */
export function BlockPopover({
  block,
  at,
  onClose,
  onChangeDeadline,
  onOpenRoutine,
}: {
  block: BlockRef
  at: Point
  onClose: () => void
  onChangeDeadline: (taskId: string) => void
  onOpenRoutine: (routineId: string) => void
}) {
  const { state, dispatch, navigate } = useStore()
  const startFocus = useStartFocus()
  const [changing, setChanging] = useState(false)

  const task = state.tasks.find((item) => item.id === block.taskId)
  const session =
    block.kind === "planned"
      ? state.planned.find((item) => item.id === block.refId)
      : undefined
  const placement =
    block.kind === "routine-placement"
      ? state.routinePlacements.find((item) => item.id === block.refId)
      : undefined
  const routine = state.routines.find(
    (item) => item.id === (placement?.routineId ?? block.refId)
  )
  const isRoutine =
    block.kind === "routine" || block.kind === "routine-placement"

  const done = session
    ? session.done
    : placement
      ? placement.done
      : block.kind === "routine"
        ? Boolean(routine?.doneDates.includes(block.date))
        : task
          ? !isActive(task)
          : false

  function toggleDone() {
    if (session) dispatch({ type: "toggle-planned", id: session.id })
    else if (placement) dispatch({ type: "toggle-placement", id: placement.id })
    else if (block.kind === "routine") {
      dispatch({
        type: "toggle-routine-done",
        routineId: block.refId,
        date: block.date,
      })
    } else if (task) {
      dispatch({
        type: "set-status",
        id: task.id,
        at: nowIso(),
        status: isActive(task) ? "completed" : "in-progress",
      })
    }
    onClose()
  }

  const open = () => {
    onClose()
    if (isRoutine && routine) onOpenRoutine(routine.id)
    else if (task) {
      navigate(
        task.recoveryCase
          ? { view: "case", id: task.id }
          : { view: "task", id: task.id }
      )
    }
  }

  const focusMinutes = session?.minutes ?? routine?.duration ?? 25
  const canStart = block.kind !== "focused" && !done
  const canChange = block.kind !== "focused" && !done

  return (
    <Floating at={at} label={block.title} onClose={onClose}>
      <p className="mb-1 text-[15px] font-medium break-words">{block.title}</p>
      <p className="mb-2 text-xs text-muted-foreground">
        {shortDate(block.date)}
        {session && ` · ${formatDuration(session.minutes)}`}
        {isRoutine && routine && ` · ${formatDuration(routine.duration)}`}
      </p>
      {changing ? (
        session ? (
          <ChangeTime
            date={session.date}
            time={session.time}
            minutes={session.minutes}
            allowNoTime
            onCancel={() => setChanging(false)}
            onSave={(date, time, minutes) => {
              const stamp = nowIso()
              dispatch({
                type: "move-planned",
                at: stamp,
                id: session.id,
                date,
                time,
              })
              if (minutes) {
                dispatch({
                  type: "resize-planned",
                  at: stamp,
                  id: session.id,
                  minutes,
                })
              }
              onClose()
            }}
          />
        ) : (
          routine && (
            <ChangeTime
              date={block.date}
              time={placement?.time ?? routineTime(routine)}
              onCancel={() => setChanging(false)}
              onSave={(date, time) => {
                if (!time) return
                if (placement) {
                  dispatch({
                    type: "move-placement",
                    id: placement.id,
                    date,
                    time,
                  })
                } else {
                  dispatch({
                    type: "move-routine-occurrence",
                    routineId: routine.id,
                    fromDate: block.date,
                    placement: {
                      id: crypto.randomUUID(),
                      routineId: routine.id,
                      date,
                      time,
                      done: false,
                    },
                  })
                }
                onClose()
              }}
            />
          )
        )
      ) : (
        <div className="grid gap-1">
          {canStart && (
            <Button
              type="button"
              size="lg"
              className="min-h-10 justify-start"
              onClick={() => {
                onClose()
                startFocus(block.taskId, focusMinutes)
              }}
            >
              <Play aria-hidden />
              {state.timer
                ? startLabel(state.timer, focusMinutes)
                : "Start focus"}
            </Button>
          )}
          {block.kind !== "focused" && (
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
          {canChange && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-10 justify-start"
              onClick={() => {
                if (block.kind === "deadline" && block.taskId) {
                  onClose()
                  onChangeDeadline(block.taskId)
                } else setChanging(true)
              }}
            >
              <Clock aria-hidden />
              {block.kind === "deadline" ? "Change date" : "Change time"}
            </Button>
          )}
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
          {(session || placement) && (
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
                } else if (placement) {
                  dispatch({ type: "remove-placement", id: placement.id })
                }
                onClose()
              }}
            >
              <Trash2 aria-hidden />
              Remove from calendar
            </Button>
          )}
        </div>
      )}
    </Floating>
  )
}
