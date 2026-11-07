"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DurationChips } from "@/components/workspace/calendar-overlays"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { endOf, formatClockTime } from "@/lib/calendar/derived"
import { shortDate } from "@/lib/workspace/dates"
import type { PlannedSession, Task } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const pad = (value: number) => String(value).padStart(2, "0")

type When = "time" | "anytime" | NonNullable<PlannedSession["window"]>

const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: "time", label: "A set time" },
  { value: "anytime", label: "Any time that day" },
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
]

function nextQuarter(now: number) {
  const date = new Date(now + 15 * 60_000)
  return `${pad(date.getHours())}:${pad(Math.floor(date.getMinutes() / 15) * 15)}`
}

/**
 * A new time, a part of the day, or another day. It only moves the work, so the
 * form says so: a hard deadline can't change from here.
 */
export function RescheduleForm({
  task,
  session,
  plannedId,
  minutes,
  onDone,
  onSaved,
  fromRecovery = false,
}: {
  task: Task
  session?: PlannedSession
  /** A block to move instead of adding another, when only its id is known. */
  plannedId?: string | null
  minutes?: number
  onDone: () => void
  onSaved?: () => void
  /** Counts as a recovery action, which ordinary rescheduling doesn't. */
  fromRecovery?: boolean
}) {
  const { state, dispatch, today } = useStore()
  const block =
    session ?? state.planned.find((item) => item.id === plannedId) ?? undefined
  const [now] = useState(() => Date.now())
  const [date, setDate] = useState(block?.date ?? today)
  const [when, setWhen] = useState<When>(
    block && !block.time ? (block.window ?? "anytime") : "time"
  )
  const [time, setTime] = useState(block?.time ?? nextQuarter(now))
  const [length, setLength] = useState(minutes ?? block?.minutes ?? 25)
  const ready = date && (when !== "time" || time) && length > 0

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        const at = nowIso()
        const chosenTime = when === "time" ? time : null
        const window = when === "time" || when === "anytime" ? null : when
        if (block) {
          dispatch({
            type: "move-planned",
            at,
            id: block.id,
            date,
            time: chosenTime,
            window,
          })
          dispatch({
            type: "resize-planned",
            at,
            id: block.id,
            minutes: length,
          })
          dispatch({ type: "settings", patch: { lastSessionMinutes: length } })
        } else {
          dispatch({
            type: "add-planned",
            at,
            session: {
              id: newId(),
              taskId: task.id,
              date,
              time: chosenTime,
              window,
              minutes: length,
              label: "",
              done: false,
            },
          })
        }
        if (fromRecovery) {
          dispatch({ type: "recovery-action", at, taskId: task.id })
        }
        onSaved?.()
        onDone()
      }}
    >
      <div role="group" aria-label="When" className="flex flex-wrap gap-1.5">
        {WHEN_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={when === option.value}
            onClick={() => setWhen(option.value)}
            className={cn(
              "min-h-11 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              when === option.value
                ? "border-transparent bg-primary font-medium text-primary-foreground font-medium"
                : "border-border bg-card"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="block">
          <span className="mb-0.5 block text-xs font-medium">Day</span>
          <Input
            type="date"
            value={date}
            max="9999-12-31"
            onChange={(event) => setDate(event.target.value)}
            className="h-10 w-auto"
          />
        </label>
        {when === "time" && (
          <label className="block">
            <span className="mb-0.5 block text-xs font-medium">Start</span>
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="h-10 w-auto"
            />
          </label>
        )}
      </div>
      <DurationChips value={length} onChange={setLength} />
      <p className="text-xs text-muted-foreground">
        {when === "time" && date && time
          ? `Ends ${formatClockTime(endOf(date, time, length))}. `
          : ""}
        {task.deadline
          ? `The deadline stays ${shortDate(task.deadline)}.`
          : "This only moves when you work."}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="xl" disabled={!ready}>
          Save
        </Button>
        <Button type="button" size="xl" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
