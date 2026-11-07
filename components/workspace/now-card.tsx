"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowRight,
  Clock,
  HelpCircle,
  Inbox,
  Maximize2,
  Minus,
  Minimize2,
  Pause,
  Pencil,
  Play,
  Shuffle,
  Square,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReportedMinutes } from "@/components/workspace/calendar-overlays"
import { ParkingLot } from "@/components/workspace/parking-lot"
import { AuraStar, FocusOrb } from "@/components/workspace/aura"
import {
  FinishedPanel,
  StopChoice,
  ThemePicker,
  useFocusRoomLock,
  useNow,
  useStartFocus,
} from "@/components/workspace/focus-view"
import { DeadlineChip, TaskLink } from "@/components/workspace/parts"
import { RecoveryPanel } from "@/components/workspace/recovery-panel"
import { RescheduleForm } from "@/components/workspace/reschedule-form"
import {
  newId,
  nowIso,
  useEnterRecovery,
  useStore,
} from "@/components/workspace/store"
import { formatClockTime, formatDuration } from "@/lib/calendar/derived"
import { taskColorVars } from "@/lib/calendar/task-colors"
import { caseContext, demoSmaller } from "@/lib/recovery/case-engine"
import type { CaseContext } from "@/lib/recovery/case-engine"
import {
  elapsedMs,
  formatClock,
  formatMinutes,
  remainingSeconds,
} from "@/lib/focus/timer"
import { chooseBuffer } from "@/lib/today/buffer"
import type { BufferSlot } from "@/lib/today/buffer"
import { shortDate } from "@/lib/workspace/dates"
import {
  blockHasEnded,
  firstStepOf,
  minimumMet,
  nowState,
  pickAnother,
  sessionMinutes,
} from "@/lib/today/now"
import type { NowState } from "@/lib/today/now"
import type { PlannedSession, Task, TimerState } from "@/lib/workspace/schemas"
import { startCue } from "@/lib/workspace/selectors"
import { cn } from "@/lib/utils"

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="bot-eyebrow">{children}</h2>
}

/** The way into recovery, sitting where the next action is. */
export function RecoveryDoor({
  onClick,
  tall = false,
}: {
  onClick: () => void
  /** For the empty day, where it's one of the main things on the page. */
  tall?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("bot-door", tall && "bot-door-tall")}
    >
      <AuraStar className="bot-door-mark size-11 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-2xl leading-tight">
          I’ve been avoiding something
        </span>
        <span className="block text-[13px]">
          Say it messy. We’ll find a smaller way in.
        </span>
      </span>
      <ArrowRight className="bot-door-arrow size-5 shrink-0" aria-hidden />
    </button>
  )
}

/** One step, which can always be rewritten in the user's own words. */
function StepLine({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const cue = startCue(task)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(cue?.text ?? "")
  const label =
    cue?.source === "resume"
      ? "Pick up here"
      : cue?.source === "step"
        ? "Next step"
        : "What you’ll do first"

  if (editing) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const value = text.trim()
          // It goes back where it came from, so nothing else is overwritten.
          const patch =
            cue?.source === "resume"
              ? { resumeNote: value }
              : task.recoveryCase || cue?.source === "step"
                ? { nextAction: value }
                : { firstStep: value }
          dispatch({ type: "edit-task", id: task.id, at: nowIso(), patch })
          setEditing(false)
        }}
      >
        <label htmlFor="now-step" className="sr-only">
          {cue ? label : "What will you do first?"}
        </label>
        <Input
          id="now-step"
          autoFocus
          value={text}
          maxLength={300}
          placeholder="What will you do first?"
          onChange={(event) => setText(event.target.value)}
          className="h-11 flex-1"
        />
        <Button type="submit" size="xl" variant="outline">
          Save
        </Button>
      </form>
    )
  }
  if (!cue) {
    const save = () => {
      const value = text.trim()
      if (!value) return
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        patch: task.recoveryCase ? { nextAction: value } : { firstStep: value },
      })
    }
    return (
      <div>
        <label htmlFor="now-first-step" className="sr-only">
          What will you do first?
        </label>
        <Input
          id="now-first-step"
          value={text}
          maxLength={300}
          placeholder="e.g. open the assignment page"
          onChange={(event) => setText(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          className="h-11 px-3.5"
        />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "flex items-start gap-1 text-[15px]",
        cue.source === "resume" && "rounded-2xl border border-line bg-card p-3"
      )}
    >
      <p className="min-w-0 flex-1 break-words">
        <span
          className={
            cue.source === "resume"
              ? "block text-sm font-medium text-[var(--task-strong)]"
              : "font-semibold"
          }
        >
          {label}
          {cue.source === "resume" ? "" : ": "}
        </span>
        {cue.text}
      </p>
      <button
        type="button"
        aria-label="Edit this step"
        title="Edit this step"
        onClick={() => {
          setText(cue.text)
          setEditing(true)
        }}
        className="-mt-1.5 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** A quiet line: the smaller version counted, and the task itself is still open. */
function MinimumNote({ task }: { task: Task }) {
  const { state } = useStore()
  if (task.status === "completed" || !minimumMet(state, task.id)) return null
  return (
    <p className="text-sm text-muted-foreground">
      ◐ Minimum version done. The original task is still open.
    </p>
  )
}

/** A smaller version of the step, from templates, and shorter time to go with it. */
export function useMakeSmaller(task: Task) {
  const { dispatch } = useStore()
  const [tried, setTried] = useState<string[]>([])
  const [made, setMade] = useState(false)
  const [outOfIdeas, setOutOfIdeas] = useState(false)

  const makeSmaller = () => {
    const current = firstStepOf(task) ?? task.title
    const context: CaseContext = task.recoveryCase
      ? caseContext(task)
      : {
          originalInput: `${task.title} ${task.description}`.trim(),
          title: task.title,
          blocker: null,
          path: null,
          completed: [],
          tried: [],
          realityGap: null,
          realityCheck: null,
        }
    const plan = demoSmaller(
      { ...context, tried: [...context.tried, ...tried] },
      current
    )
    if (!plan.action) {
      setOutOfIdeas(true)
      return
    }
    setTried([...tried, current])
    setMade(true)
    if (task.recoveryCase) {
      dispatch({ type: "case-apply-plan", id: task.id, at: nowIso(), plan })
    } else {
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        // The smaller step is what's next now, ahead of an older note.
        patch: { nextAction: plan.action.text, resumeNote: "" },
      })
    }
  }
  return { makeSmaller, made, outOfIdeas }
}

function ReadyControls({
  task,
  session,
  minutes,
  label,
  extra,
  header,
}: {
  task: Task
  session?: PlannedSession
  minutes: number
  label: string
  extra?: React.ReactNode
  header: React.ReactNode
}) {
  const { dispatch } = useStore()
  const start = useStartFocus({ stay: true })
  const smaller = useMakeSmaller(task)
  const [changing, setChanging] = useState(false)
  // A scheduled block keeps its own length, even after making the step smaller.
  const length = smaller.made && !session ? 5 : minutes

  if (changing) {
    return (
      <>
        {header}
        <RescheduleForm
          task={task}
          session={session}
          minutes={minutes}
          onDone={() => setChanging(false)}
        />
      </>
    )
  }
  return (
    <>
      <div className="flex items-start gap-3 sm:gap-5">
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          className="bot-start bg-primary"
          onClick={() => start(task.id, length, session?.id)}
        >
          Start
        </button>
      </div>
      <div className="space-y-1.5">
        <StepLine task={task} />
        <MinimumNote task={task} />
        {smaller.made && (
          <p className="text-xs">
            A smaller way in, from a built-in suggestion, not AI. It’s yours to
            change.
          </p>
        )}
        {smaller.outOfIdeas && (
          <p className="text-sm font-medium">
            BackOnTrack is out of built-in ways to shrink this. What would feel
            possible in one minute? You can write it above.
          </p>
        )}
        <p className="text-sm">
          {label} · {formatDuration(length)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="lg"
          variant="soft"
          onClick={smaller.makeSmaller}
        >
          <Minimize2 aria-hidden />
          Make it smaller
        </Button>
        <Button
          type="button"
          size="lg"
          variant="soft"
          onClick={() => setChanging(true)}
        >
          <Clock aria-hidden />
          Change time
        </Button>
        {extra}
        <TaskLink task={task} className="px-2" />
      </div>
      <RecoveryDoor
        onClick={() =>
          dispatch({
            type: "enter-recovery",
            at: nowIso(),
            taskId: null,
            source: "avoidance",
          })
        }
      />
    </>
  )
}

/**
 * The session, on Today. Pressing Start opens it as a whole-screen room in the
 * task's colour. It's the same element, so nothing about the timer moves.
 */
function SessionCard({
  timer,
  task,
  paused,
}: {
  timer: TimerState
  task: Task | null
  paused: boolean
}) {
  const {
    dispatch,
    focusRoomOpen: immersive,
    setFocusRoomOpen: setImmersive,
  } = useStore()
  const now = useNow(!paused)
  const [stopping, setStopping] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const isBreak = timer.kind === "break"
  const elapsed = Math.floor(elapsedMs(timer, now) / 1000)
  const remaining = remainingSeconds(timer, now)
  const title = isBreak ? "Break" : (task?.title ?? "Focus session")

  const stepOut = useCallback(() => setImmersive(false), [setImmersive])
  useFocusRoomLock(immersive, stepOut)

  const end = () =>
    isBreak ? dispatch({ type: "timer-cancel" }) : setStopping(true)

  const dial = (
    <FocusOrb
      fraction={timer.plannedSeconds ? remaining / timer.plannedSeconds : 0}
      running={!paused}
      className={
        !immersive
          ? "w-44 shrink-0 sm:w-48"
          : stopping
            ? "w-[min(26svh,52vw)] shrink-0"
            : "w-[min(46svh,82vw,30rem)] shrink-0"
      }
    >
      <span
        role="timer"
        aria-label={`${formatClock(remaining)} remaining`}
        className={cn(
          "font-heading leading-none tracking-[-0.04em] tabular-nums",
          immersive && !stopping
            ? "text-[clamp(4rem,min(15svh,22vw),9rem)]"
            : "text-[clamp(2.5rem,7svh,3.5rem)]"
        )}
      >
        {formatClock(remaining)}
      </span>
    </FocusOrb>
  )

  const controls = adjusting && task ? (
    <RescheduleForm
      task={task}
      minutes={timer.plannedSeconds / 60}
      onDone={() => setAdjusting(false)}
    />
  ) : stopping ? (
    <StopChoice
      timer={timer}
      task={task ?? undefined}
      onCancel={() => setStopping(false)}
    />
  ) : (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        immersive && "justify-center"
      )}
    >
      {paused ? (
        <Button
          type="button"
          size="xl"
          onClick={() => dispatch({ type: "timer-resume", now: Date.now() })}
        >
          <Play aria-hidden />
          Resume
        </Button>
      ) : (
        <Button
          type="button"
          size="xl"
          onClick={() => dispatch({ type: "timer-pause", now: Date.now() })}
        >
          <Pause aria-hidden />
          Pause
        </Button>
      )}
      {!immersive && (
        <Button
          type="button"
          size="xl"
          variant="soft"
          onClick={() => setImmersive(true)}
        >
          <Maximize2 aria-hidden />
          Enter Focus Mode
        </Button>
      )}
      <Button type="button" size="xl" variant="soft" onClick={end}>
        <Square aria-hidden />
        {isBreak ? "End break" : "End session"}
      </Button>
      {paused && task && !isBreak && (
        <Button
          type="button"
          size="xl"
          variant="soft"
          onClick={() => setAdjusting(true)}
        >
          <Clock aria-hidden />
          Adjust plan
        </Button>
      )}
      {task && !isBreak && <TaskLink task={task} className="px-2" />}
      {!paused && !isBreak && <ParkingLot taskId={timer.taskId} />}
    </div>
  )

  const summary = (
    <p className="text-sm">
      {paused
        ? `${formatMinutes(elapsed)} so far, with ${formatClock(remaining)} left. Your place is saved.`
        : `${formatMinutes(elapsed)} in, ${formatClock(remaining)} left`}
    </p>
  )

  const vars = taskColorVars(
    isBreak ? "break" : (task?.id ?? "focus"),
    isBreak ? "mint-garden" : task?.focusTheme
  )

  if (!immersive) {
    return (
      <div
        style={vars}
        className={cn(
          "bot-stage bot-rise space-y-4 p-5 sm:p-6",
          paused && "bot-stage-paused"
        )}
      >
        <Label>{paused ? "Paused" : isBreak ? "On a break" : "Working on"}</Label>
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          {dial}
          <div className="w-full min-w-0 flex-1 space-y-2">
            <p className="bot-stage-title">{title}</p>
            {summary}
            {task && !isBreak && <StepLine task={task} />}
            {task && !isBreak && <MinimumNote task={task} />}
          </div>
        </div>
        {controls}
      </div>
    )
  }

  return (
    <div
      style={vars}
      role="group"
      aria-label="Focus"
      className={cn("bot-immersive", paused && "is-paused")}
    >
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-center gap-[1.6svh] px-4 py-3 text-center sm:py-4">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="lg"
            variant="soft"
            className="h-11"
            onClick={() => setImmersive(false)}
          >
            <Minus aria-hidden />
            Back to Today
          </Button>
          {task && !isBreak && (
            <ThemePicker
              compact
              task={task}
              onChange={(focusTheme) =>
                dispatch({
                  type: "edit-task",
                  id: task.id,
                  at: nowIso(),
                  patch: { focusTheme },
                })
              }
            />
          )}
        </div>
        <div className="my-auto flex w-full flex-col items-center gap-[1.6svh]">
          <div className={paused ? "bot-paused-tag" : undefined}>
            <Label>
              {paused ? "Paused" : isBreak ? "On a break" : "Working on"}
            </Label>
          </div>
          <p className="font-heading text-[clamp(2.25rem,7svh,4.5rem)] leading-[1] tracking-[-0.025em] break-words">
            {title}
          </p>
          {dial}
          {summary}
          {task && !isBreak && !stopping && (
            <div className="bot-paper w-full max-w-lg rounded-2xl px-3.5 py-2.5 text-left">
              <StepLine task={task} />
              <MinimumNote task={task} />
            </div>
          )}
          <div className={cn("w-full", stopping && "bot-paper rounded-3xl p-4 text-left")}>
            {controls}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A short time they say they spent, for when no timer was running. */
function WorkedOnThis({ session }: { session: PlannedSession }) {
  const { dispatch } = useStore()
  const [confirming, setConfirming] = useState(false)
  const answer = (outcome: "did" | "didnt", minutes?: number) =>
    dispatch({
      type: "planned-outcome",
      at: nowIso(),
      id: session.id,
      outcome,
      sessionId: newId(),
      minutes,
    })
  return (
    <div className="space-y-2 bot-paper rounded-2xl p-3.5 text-sm shadow-none">
      <p id="worked-question" className="font-medium">
        Did you work on this?
      </p>
      {confirming ? (
        <ReportedMinutes
          planned={session.minutes}
          onSave={(minutes) => answer("did", minutes)}
          onCancel={() => setConfirming(false)}
          cancelLabel="Back"
        />
      ) : (
        <div
          role="group"
          aria-labelledby="worked-question"
          className="flex flex-wrap gap-2"
        >
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="min-h-11"
            onClick={() => setConfirming(true)}
          >
            Yes
          </Button>
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="min-h-11"
            onClick={() => answer("didnt")}
          >
            Not yet
          </Button>
        </div>
      )}
    </div>
  )
}

function bufferLabel(slot: BufferSlot, today: string) {
  const time = formatClockTime(new Date(`${slot.date}T${slot.time}:00`))
  return slot.date === today
    ? `Today, ${time}`
    : `${shortDate(slot.date)}, ${time}`
}

function MissedCard({
  task,
  session,
  now,
}: {
  task: Task
  session: PlannedSession
  now: number
}) {
  const { state, dispatch, today } = useStore()
  const start = useStartFocus({ stay: true })
  const enterRecovery = useEnterRecovery()
  const [changing, setChanging] = useState(false)
  const [choosing, setChoosing] = useState<{
    slots: BufferSlot[]
    needed: number
  } | null>(null)
  const when = formatClockTime(new Date(`${session.date}T${session.time}:00`))

  useEffect(() => {
    dispatch({
      type: "recovery-shown",
      at: nowIso(),
      taskId: task.id,
      plannedId: session.id,
    })
  }, [dispatch, task.id, session.id])

  function moveTo(slot: BufferSlot, minutes: number) {
    const at = nowIso()
    dispatch({
      type: "move-planned",
      at,
      id: session.id,
      date: slot.date,
      time: slot.time,
    })
    if (minutes !== session.minutes) {
      dispatch({ type: "resize-planned", at, id: session.id, minutes })
    }
    dispatch({ type: "recovery-action", at, taskId: task.id })
  }

  function moveToBuffer() {
    const choice = chooseBuffer(state, session, today, now)
    if (choice.kind === "fits") moveTo(choice.slot, session.minutes)
    else setChoosing({ slots: choice.slots, needed: choice.needed })
  }

  return (
    <div
      style={taskColorVars(task.id, task.focusTheme)}
      className="bot-stage bot-stage-missed bot-rise space-y-4 p-5 sm:p-6"
    >
      <div>
        <Label>Still here when you’re ready</Label>
        <p className="bot-stage-title mt-3">{task.title}</p>
        <p className="bot-paper mt-3 inline-block rounded-2xl px-3 py-1.5 text-[15px] font-medium shadow-none">
          You planned to start this at {when}, but haven’t started yet.
        </p>
        <div className="mt-1">
          <DeadlineChip task={task} />
        </div>
      </div>
      {changing ? (
        <RescheduleForm
          fromRecovery
          task={task}
          session={session}
          minutes={session.minutes}
          onDone={() => setChanging(false)}
        />
      ) : choosing ? (
        <div className="space-y-2 bot-paper rounded-2xl p-3.5 text-sm shadow-none">
          {choosing.slots.length ? (
            <>
              <p>
                This is planned for {formatDuration(choosing.needed)}, and no
                buffer left today has that much room. Nothing has moved. You
                could:
              </p>
              <ul className="space-y-1.5">
                {choosing.slots.map((slot) => {
                  const shorter = slot.minutes < choosing.needed
                  return (
                    <li key={`${slot.date}-${slot.time}`}>
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        className="h-auto min-h-11 py-1.5 text-left whitespace-normal"
                        onClick={() =>
                          moveTo(slot, Math.min(slot.minutes, choosing.needed))
                        }
                      >
                        {shorter
                          ? `Use a shorter session: ${formatDuration(slot.minutes)}, ${bufferLabel(slot, today)}`
                          : `Choose another buffer: ${bufferLabel(slot, today)}`}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p>There’s no free buffer today or tomorrow. Nothing has moved.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setChoosing(null)
                setChanging(true)
              }}
            >
              Reschedule manually
            </Button>
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-11"
              onClick={() => setChoosing(null)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Button
            type="button"
            size="xl"
            className="h-14 w-full text-base sm:w-auto"
            onClick={() => start(task.id, 5, session.id, true)}
          >
            <Play aria-hidden />
            Do 5 minutes now
          </Button>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              style={{ "--tile": "var(--glass-strong)" } as React.CSSProperties}
              className="bot-tile"
              onClick={moveToBuffer}
            >
              <span className="bot-tile-glyph">
                <Inbox className="size-4" aria-hidden />
              </span>
              Move to buffer
            </button>
            <button
              type="button"
              style={{ "--tile": "var(--glass-strong)" } as React.CSSProperties}
              className="bot-tile"
              onClick={() => setChanging(true)}
            >
              <span className="bot-tile-glyph">
                <Clock className="size-4" aria-hidden />
              </span>
              Reschedule
            </button>
            <button
              type="button"
              style={{ "--tile": "var(--recover-soft)" } as React.CSSProperties}
              className="bot-tile"
              onClick={() => enterRecovery(task.id, session.id)}
            >
              <span className="bot-tile-glyph">
                <HelpCircle className="size-4" aria-hidden />
              </span>
              I’m stuck
            </button>
          </div>
          {blockHasEnded(session, now) && <WorkedOnThis session={session} />}
        </>
      )}
    </div>
  )
}

function StuckLink({
  taskId,
  plannedId,
}: {
  taskId: string
  plannedId: string
}) {
  const enterRecovery = useEnterRecovery()
  return (
    <button
      type="button"
      onClick={() => enterRecovery(taskId, plannedId)}
      className="min-h-10 rounded-2xl bot-press bg-white/70 px-4 text-sm font-medium outline-none"
    >
      I’m stuck
    </button>
  )
}

/** Exactly one thing to do next, with one main button. */
export function NowCard({
  empty,
  pickedId,
  setPickedId,
}: {
  empty: React.ReactNode
  pickedId: string | null
  setPickedId: (id: string | null) => void
}) {
  const { state, today, settings } = useNowStore()
  const now = useNow(true)
  const [kept, setKept] = useState<string | null>(null)
  const current: NowState = nowState(state, today, now, pickedId)

  if (current.kind === "active" || current.kind === "paused") {
    return (
      <SessionCard
        key={current.timer.id}
        timer={current.timer}
        task={current.task}
        paused={current.kind === "paused"}
      />
    )
  }
  if (current.kind === "finished") {
    return <FinishedPanel session={current.session} onTask wrapOnly />
  }
  if (current.kind === "recovering") {
    return <RecoveryPanel task={current.task} recovery={current.recovery} />
  }
  if (current.kind === "missed") {
    return (
      <MissedCard
        key={current.session.id}
        task={current.task}
        session={current.session}
        now={now}
      />
    )
  }
  if (current.kind === "empty") return <>{empty}</>

  const { task } = current
  const session = current.kind === "upcoming" ? current.session : undefined
  const label = session
    ? `At ${formatClockTime(new Date(`${session.date}T${session.time}:00`))}`
    : "Suggested for now"
  return (
    <div
      style={taskColorVars(task.id, task.focusTheme)}
      className="bot-stage bot-rise space-y-3.5 p-5 sm:p-6"
    >
      <ReadyControls
        key={task.id}
        task={task}
        session={session}
        minutes={session?.minutes ?? sessionMinutes(task, settings)}
        label={label}
        header={
          <>
            <Label>{session ? "Coming up" : "You could start with"}</Label>
            <p className="bot-stage-title mt-2.5">{task.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3">
              <DeadlineChip task={task} />
              {current.kind === "suggested" &&
                current.reason &&
                !(task.deadline && current.reason.startsWith("Due")) && (
                  <span className="text-xs font-medium">{current.reason}</span>
                )}
            </div>
          </>
        }
        extra={
          session ? (
            <StuckLink taskId={task.id} plannedId={session.id} />
          ) : (
            current.kind === "suggested" && (
              <Button
                type="button"
                size="lg"
                variant="soft"
                onClick={() => {
                  const next = pickAnother(state, today, task.id)
                  setPickedId(next.id)
                  setKept(next.keptBecause)
                }}
              >
                <Shuffle aria-hidden />
                Pick one for me
              </Button>
            )
          )
        }
      />
      {kept && (
        <p role="status" className="text-sm text-muted-foreground">
          {kept}
        </p>
      )}
    </div>
  )
}

function useNowStore() {
  const { state, today } = useStore()
  return { state, today, settings: state.settings }
}
