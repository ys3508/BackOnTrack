"use client"

import { useState } from "react"
import {
  CalendarClock,
  Check,
  History,
  LayoutList,
  LifeBuoy,
  Minimize2,
  Pencil,
  Play,
  Repeat2,
  Timer,
  X,
} from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Confetti, Orb, SunGlyph } from "@/components/workspace/aura"
import { NotStartedTray } from "@/components/workspace/calendar-sidebar"
import { useNow, useStartFocus } from "@/components/workspace/focus-view"
import {
  NowCard,
  RecoveryDoor,
  useMakeSmaller,
} from "@/components/workspace/now-card"
import { DeadlineChip, ExpandableList } from "@/components/workspace/parts"
import { QuickCapture } from "@/components/workspace/quick-capture"
import { ReturnView } from "@/components/workspace/return-view"
import { ReplanDialog } from "@/components/workspace/schedule"
import { nowIso, useEnterRecovery, useStore } from "@/components/workspace/store"
import { TodayTimeline } from "@/components/workspace/today-timeline"
import {
  formatClockTime,
  formatDuration,
  occurrenceOutcome,
  rangeStats,
  routineOccursOn,
  routineTime,
  trayItems,
} from "@/lib/calendar/derived"
import { taskColorVars } from "@/lib/calendar/task-colors"
import { caseContext, demoSmaller } from "@/lib/recovery/case-engine"
import {
  HEAVY_DAY_MINUTES,
  latestWin,
  nowState,
  plannedMinutesOn,
  restartsOn,
  sessionMinutes,
  splitTasks,
} from "@/lib/today/now"
import { addDays, formatDateTime } from "@/lib/workspace/dates"
import { returnSummary } from "@/lib/workspace/returning"
import { isActive } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"
import { startCue } from "@/lib/workspace/selectors"
import { cn } from "@/lib/utils"

const sectionTitle = "font-heading text-lg"

/** Done, edit, start, plan, shrink, or get unstuck, all without leaving the row. */
function TaskLine({
  task,
  inNow,
  onSchedule,
}: {
  task: Task
  inNow: boolean
  onSchedule: (task: Task) => void
}) {
  const { state, dispatch, navigate } = useStore()
  const start = useStartFocus({ stay: true })
  const enterRecovery = useEnterRecovery()
  const { makeSmaller } = useMakeSmaller(task)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const cue = startCue(task)

  const save = () => {
    const value = title.trim()
    if (value && value !== task.title) {
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        patch: { title: value },
      })
    }
    setEditing(false)
  }

  return (
    <li
      style={taskColorVars(task.id, task.focusTheme)}
      className="bot-task flex flex-wrap items-start gap-x-1 py-0.5 pr-1 pl-0.5"
    >
      <button
        type="button"
        aria-label={`Mark ${task.title} complete`}
        onClick={() =>
          dispatch({
            type: "set-status",
            id: task.id,
            at: nowIso(),
            status: "completed",
          })
        }
        className="group/check grid size-11 shrink-0 place-items-center rounded-full outline-none "
      >
        <span aria-hidden className="bot-check">
          <Check className="size-3.5" strokeWidth={3.5} />
        </span>
      </button>
      {editing ? (
        <form
          className="min-w-0 flex-1 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <label htmlFor={`title-${task.id}`} className="sr-only">
            Task title
          </label>
          <Input
            id={`title-${task.id}`}
            autoFocus
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTitle(task.title)
                setEditing(false)
              }
            }}
            className="h-9 px-2.5 font-semibold"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => navigate({ view: "task", id: task.id })}
          className="min-h-11 min-w-0 flex-1 basis-40 rounded-md py-1.5 text-left outline-none "
        >
          <span className="block text-[15px] leading-snug font-semibold break-words">
            {task.title}
          </span>
          {inNow ? (
            <span className="text-xs font-medium text-[var(--task-strong)]">
              In Now, above
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-2">
              <DeadlineChip task={task} />
              {cue && (
                <span className="text-xs break-words text-muted-foreground">
                  {cue.text}
                </span>
              )}
            </span>
          )}
        </button>
      )}
      {!editing && (
        <div className="bot-task-actions">
          {!state.timer && (
            <button
              type="button"
              aria-label={`Begin ${task.title}`}
              title="Start"
              className="bot-icon-action"
              onClick={() =>
                start(task.id, sessionMinutes(task, state.settings))
              }
            >
              <Play className="size-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            aria-label={`Rename ${task.title}`}
            title="Edit"
            className="bot-icon-action"
            onClick={() => {
              setTitle(task.title)
              setEditing(true)
            }}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Plan a time for ${task.title}`}
            title="Schedule"
            className="bot-icon-action"
            onClick={() => onSchedule(task)}
          >
            <CalendarClock className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Shrink ${task.title}`}
            title="Make it smaller"
            className="bot-icon-action"
            onClick={makeSmaller}
          >
            <Minimize2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Stuck on ${task.title}`}
            title="I’m stuck"
            className="bot-icon-action text-recover-ink"
            onClick={() => enterRecovery(task.id)}
          >
            <LifeBuoy className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </li>
  )
}

function RoutinesToday() {
  const { state, dispatch, today } = useStore()
  const regular = state.routines
    .filter((routine) => routineOccursOn(routine, today))
    .map((routine) => ({
      id: routine.id,
      routineId: routine.id,
      placementId: null as string | null,
      title: `${routine.emoji} ${routine.name}`.trim(),
      color: routine.color,
      time: routine.kind === "flexible" ? "" : routineTime(routine),
      minimum: routine.minimumVersion,
      outcome: occurrenceOutcome(routine, today),
    }))
  const placed = state.routinePlacements.flatMap((item) => {
    const routine = state.routines.find((r) => r.id === item.routineId)
    return routine && item.date === today
      ? [
          {
            id: item.id,
            routineId: routine.id,
            placementId: item.id as string | null,
            title: `${routine.emoji} ${routine.name}`.trim(),
            color: routine.color,
            time: item.time,
            minimum: routine.minimumVersion,
            outcome: item.result ?? (item.done ? "full" : null),
          },
        ]
      : []
  })
  const items = [...regular, ...placed].sort((a, b) =>
    a.time.localeCompare(b.time)
  )
  if (!items.length) return null
  return (
    <section
      aria-labelledby="routines-today"
      className="bot-card p-4 sm:p-5"
    >
      <h2 id="routines-today" className="mb-3 font-heading text-[2.25rem] leading-none">
        Routines today
      </h2>
      <ul className="space-y-2">
        {items.map((item) => {
          const set = (outcome: "full" | "minimum" | "skipped") =>
            dispatch({
              type: "routine-outcome",
              routineId: item.routineId,
              date: today,
              placementId: item.placementId,
              outcome: item.outcome === outcome ? null : outcome,
            })
          return (
            <li
              key={item.id}
              className="text-sm"
              style={{ "--routine": item.color } as React.CSSProperties}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 font-medium break-words">
                  {item.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.time
                    ? formatClockTime(new Date(`2000-01-15T${item.time}:00`))
                    : "Any time"}
                </span>
              </div>
              {item.minimum && (
                <p className="text-xs text-muted-foreground">
                  Minimum: {item.minimum}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={item.outcome === "full"}
                  aria-label={`Done in full: ${item.title}`}
                  onClick={() => set("full")}
                  data-outcome="full"
                  className="bot-outcome"
                >
                  ● Full
                </button>
                <button
                  type="button"
                  aria-pressed={item.outcome === "minimum"}
                  aria-label={`Minimum version: ${item.title}`}
                  onClick={() => set("minimum")}
                  data-outcome="minimum"
                  className="bot-outcome"
                >
                  ◐ Minimum
                </button>
                <button
                  type="button"
                  aria-pressed={item.outcome === "skipped"}
                  aria-label={`Skip: ${item.title}`}
                  onClick={() => set("skipped")}
                  data-outcome="skipped"
                  className="bot-outcome"
                >
                  Skip
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ParkedThoughts() {
  const { state, dispatch } = useStore()
  if (!state.parkingLot.length) return null
  return (
    <details>
      <summary className={cn(sectionTitle, "min-h-11 cursor-pointer py-2")}>
        Parked thoughts ({state.parkingLot.length})
      </summary>
      <ul className="space-y-1 text-sm">
        {[...state.parkingLot].reverse().map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">
              {item.text}
              <span className="block text-xs text-muted-foreground">
                {formatDateTime(item.at)}
              </span>
            </span>
            <button
              type="button"
              aria-label={`Clear: ${item.text}`}
              onClick={() => dispatch({ type: "remove-thought", id: item.id })}
              className="min-h-9 rounded-md px-1 text-xs font-medium text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              Clear
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function TasksColumn({ pickedId }: { pickedId: string | null }) {
  const { state, dispatch, today, navigate } = useStore()
  const avoid = () => {
    dispatch({
      type: "enter-recovery",
      at: nowIso(),
      taskId: null,
      source: "avoidance",
    })
    window.scrollTo?.({ top: 0 })
  }
  const [heavyHidden, setHeavyHidden] = useState(false)
  const [replanning, setReplanning] = useState<Task | null>(null)
  const lists = splitTasks(state, today)
  const planned = plannedMinutesOn(state, today)
  const now = useNow(true)
  const current = nowState(state, today, now, pickedId)
  const nowKind = current.kind
  const nowTaskId = "task" in current ? current.task?.id : undefined
  // The Now card already has this among its actions, so it isn't said twice.
  const cardOffersAvoiding = nowKind === "suggested" || nowKind === "upcoming"
  const pill =
    "bot-press inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-card px-3.5 text-sm font-semibold outline-none"
  return (
    <div className="min-w-0 space-y-5">
      {!cardOffersAvoiding && nowKind !== "recovering" && (
        <RecoveryDoor onClick={avoid} />
      )}
      <section
        aria-labelledby="tasks-today"
        className="bot-card space-y-3 p-4 sm:p-5"
      >
        <h2 id="tasks-today" className="font-heading text-[2.25rem] leading-none">
          Today’s tasks
          <span
            aria-hidden
            className="ml-2 inline-block translate-y-[-5px] rounded-full bg-white/80 px-2 py-0.5 font-sans text-xs tracking-normal"
          >
            {lists.today.length} open
          </span>
        </h2>
        <QuickCapture />
        <ExpandableList
          items={lists.today}
          limit={state.settings.homeListSize}
          label="tasks"
          render={(task) => (
            <TaskLine
              key={task.id}
              task={task}
              inNow={task.id === nowTaskId}
              onSchedule={setReplanning}
            />
          )}
        />
        {lists.later.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-muted-foreground">
              Other open tasks ({lists.later.length})
            </summary>
            <ExpandableList
              items={lists.later}
              limit={state.settings.homeListSize}
              label="tasks"
              render={(task) => (
                <TaskLine
                  key={task.id}
                  task={task}
                  inNow={task.id === nowTaskId}
                  onSchedule={setReplanning}
                />
              )}
            />
          </details>
        )}
        {planned > HEAVY_DAY_MINUTES && !heavyHidden && (
          <p className="rounded-2xl bg-butter p-3 text-sm">
            That’s {formatDuration(planned)} planned today. You could move
            something, if that feels like a lot.{" "}
            <button
              type="button"
              onClick={() => setHeavyHidden(true)}
              className="font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              It’s fine
            </button>
          </p>
        )}
      </section>
      <nav
        aria-label="More"
        className="flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          className={pill}
          onClick={() => navigate({ view: "tasks" })}
        >
          <LayoutList className="size-4" aria-hidden />
          All tasks
        </button>
        <button
          type="button"
          className={pill}
          onClick={() => navigate({ view: "focus" })}
        >
          <History className="size-4" aria-hidden />
          Focus history
        </button>
      </nav>
      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />
    </div>
  )
}

function DayColumn() {
  const { state, today } = useStore()
  const [replanning, setReplanning] = useState<Task | null>(null)
  const notStarted = trayItems(state, today).length
  return (
    <aside aria-label="Today’s items" className="min-w-0 space-y-5">
      <TodayTimeline />
      <RoutinesToday />
      {notStarted > 0 && (
        <details className="bot-card px-4 py-2 sm:px-5">
          <summary className={cn(sectionTitle, "min-h-11 cursor-pointer py-2")}>
            Not started yet ({notStarted})
          </summary>
          <NotStartedTray
            hideHeading
            onSchedule={(taskId) =>
              setReplanning(
                state.tasks.find((task) => task.id === taskId) ?? null
              )
            }
          />
        </details>
      )}
      <ParkedThoughts />
      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />
    </aside>
  )
}

/** The first screen: light on paper, and one line to write in. */
function EmptyStage() {
  const [text, setText] = useState("")
  // The sun rises a little with each word.
  const grown = 1 + Math.min(text.length, 40) * 0.004
  return (
    <div className="bot-hero bot-rise flex flex-col justify-center py-2 sm:py-4">
      <div
        aria-hidden
        className="absolute top-[-5rem] right-0 bottom-[-3rem] -z-10 w-[58%] max-md:top-[-4rem] max-md:bottom-auto max-md:h-[22rem] max-md:w-full max-md:opacity-60"
      >
        <Orb
          core="#a8cbea"
          mid="#cfe2f4"
          className="top-[-4%] right-[-4%] aspect-square w-[64%] max-md:w-[70%]"
        />
        <Orb
          core="#dcefa6"
          mid="#ebf6cc"
          className="bottom-[-6%] left-[-6%] aspect-square w-[62%] max-md:hidden"
        />
        <Orb
          edge
          at="26% 72%"
          core="#f7463c"
          mid="#fba598"
          className="top-[6%] left-[6%] aspect-square w-[60%] max-md:w-[66%]"
        />
        <Orb
          edge
          at="70% 18%"
          core="#fd8f24"
          mid="#fdc47e"
          className="bot-grow right-[2%] bottom-[4%] aspect-square w-[62%] max-md:top-[20%] max-md:bottom-auto"
          style={{ transform: `scale(${grown})` }}
        />
      </div>
      <h2 className="relative max-w-[13ch] text-[4rem] leading-[0.94] tracking-[-0.03em] sm:text-[6rem]">
        Everyone falls off. <em>Come back.</em>
      </h2>
      <p className="relative mt-5 max-w-md text-base text-foreground/80 sm:text-lg">
        Write down one thing. BackOnTrack finds the smallest way to begin, and a
        way back when the plan slips.
      </p>
      <div className="bot-hero-input relative mt-7 max-w-xl p-1.5">
        <QuickCapture
          id="now-capture"
          autoFocus
          variant="hero"
          onText={setText}
        />
      </div>
    </div>
  )
}

/** Recovery first, and two other real ways in. */
function EmptyDoors({ onAvoid }: { onAvoid: () => void }) {
  const { navigate } = useStore()
  const tile = (color: string) => ({ "--tile": color }) as React.CSSProperties
  return (
    <nav
      aria-label="More"
      className="bot-rise relative grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]"
    >
      <RecoveryDoor tall onClick={onAvoid} />
      <button
        type="button"
        style={tile("var(--glass-strong)")}
        className="bot-tile rounded-[2rem] px-5"
        onClick={() => navigate({ view: "focus" })}
      >
        <span className="bot-tile-glyph">
          <Timer className="size-4" aria-hidden />
        </span>
        Just focus for a bit
      </button>
      <button
        type="button"
        style={tile("var(--glass-strong)")}
        className="bot-tile rounded-[2rem] px-5"
        onClick={() => navigate({ view: "routines" })}
      >
        <span className="bot-tile-glyph">
          <Repeat2 className="size-4" aria-hidden />
        </span>
        Set up a routine
      </button>
    </nav>
  )
}

/**
 * The smaller version counts, and finishing feels like something. It floats, so
 * it's seen wherever on the page the thing was finished from.
 */
function WinMoment() {
  const { state } = useStore()
  const now = useNow(true)
  const win = latestWin(state, now)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const id = win ? `${win.type}:${win.at}` : null

  if (!win || state.timer || id === dismissed) return null
  const task = state.tasks.find((item) => item.id === win.taskId)
  const whole = win.type === "completed"
  return (
    <section
      key={id}
      role="status"
      aria-label={whole ? "Task finished" : "Minimum version done"}
      style={{
        background: whole ? "#f4fae3" : "#fff4df",
      }}
      className="bot-win bottom-24 left-1/2 flex md:bottom-5 w-[min(calc(100vw-2rem),34rem)] -translate-x-1/2 items-center gap-4 px-5 py-4 sm:px-6"
    >
      {whole && <Confetti />}
      <SunGlyph
        fill={whole ? "full" : "half"}
        className="size-12 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-[2rem] leading-tight">
          {whole ? "All of it. Done." : "The minimum counts."}
        </p>
        <p className="mt-0.5 text-sm font-medium break-words">
          {whole
            ? `You finished “${task?.title ?? "that task"}”, the whole thing.`
            : `You did the smaller version of “${task?.title ?? "that task"}”. The original stays open for when you want it.`}
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss this note"
        onClick={() => setDismissed(id)}
        className="grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-white "
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  )
}

function Summary() {
  const { state, today } = useStore()
  const { focusMinutes } = rangeStats(state, today, addDays(today, 1))
  const restarts = restartsOn(state, today)
  const parts = [
    focusMinutes >= 1 && `Focused ${formatDuration(focusMinutes)}`,
    restarts > 0 &&
      `Restarted ${restarts} ${restarts === 1 ? "time" : "times"}`,
  ].filter(Boolean)
  if (!parts.length) return null
  return (
    <p className="rounded-full bg-white/70 px-3.5 py-1.5 text-sm">
      {parts.join(" · ")}
    </p>
  )
}

function ResumePrompt({
  task,
  onChoose,
  onDismiss,
}: {
  task: Task
  onChoose: (intent?: "smaller" | "reconsider") => void
  onDismiss: () => void
}) {
  return (
    <Card className="space-y-3">
      <p className="font-heading text-2xl leading-snug">
        Last time, you were working on {task.title}. Would you like to continue,
        make the next step smaller, or reconsider the plan?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="xl" onClick={() => onChoose()}>
          Continue
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => onChoose("smaller")}
        >
          Make the next step smaller
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => onChoose("reconsider")}
        >
          Reconsider the plan
        </Button>
        <Button type="button" size="xl" variant="ghost" onClick={onDismiss}>
          Something else
        </Button>
      </div>
    </Card>
  )
}

export function TodayView() {
  const { state, today, returning, finishReturn, dispatch } = useStore()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const resume = state.tasks.find(
    (task) => task.recoveryCase && isActive(task) && task.status !== "paused"
  )
  const coming = returning && !resume ? returnSummary(state, today) : null
  if (coming) return <ReturnView summary={coming} />

  const avoid = () =>
    dispatch({
      type: "enter-recovery",
      at: nowIso(),
      taskId: null,
      source: "avoidance",
    })
  const hasDay =
    state.tasks.some(isActive) ||
    state.planned.length > 0 ||
    state.routines.length > 0
  const longDate = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  const now = (
    <section aria-label="Now">
      <NowCard
        pickedId={pickedId}
        setPickedId={setPickedId}
        empty={<EmptyStage />}
      />
    </section>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <ScreenHeading>
            Today
          </ScreenHeading>
          <p className="bot-accent text-2xl text-foreground/75 sm:text-[2.25rem]">
            {longDate}
          </p>
        </div>
        <Summary />
      </div>

      {!state.settings.storageNoticeSeen && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-muted-foreground">
          Everything you enter is saved in this browser only, on this device.
          Clearing browser data deletes it, and Settings can export a copy.
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "settings",
                patch: { storageNoticeSeen: true },
              })
            }
            className="min-h-9 rounded-md font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            Got it
          </button>
        </p>
      )}

      {returning && resume && (
        <ResumePrompt
          task={resume}
          onChoose={(intent) => {
            const at = nowIso()
            finishReturn()
            dispatch({ type: "case-resume", id: resume.id, at })
            if (intent === "reconsider") {
              dispatch({
                type: "enter-recovery",
                at,
                taskId: resume.id,
                source: "avoidance",
              })
              dispatch({ type: "recovery-reason", reason: "no-time" })
            } else if (intent === "smaller" && resume.recoveryCase?.current) {
              const plan = demoSmaller(
                caseContext(resume),
                resume.recoveryCase.current.text
              )
              dispatch({ type: "case-apply-plan", id: resume.id, at, plan })
            }
          }}
          onDismiss={finishReturn}
        />
      )}

      <WinMoment />

      {hasDay ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            {now}
            <TasksColumn pickedId={pickedId} />
          </div>
          <DayColumn />
        </div>
      ) : (
        <div
          className={
            state.recovery
              ? undefined
              : "space-y-6"
          }
        >
          {now}
          {!state.recovery && <EmptyDoors onAvoid={avoid} />}
        </div>
      )}
    </div>
  )
}
