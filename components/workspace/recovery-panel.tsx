"use client"

import { useState } from "react"
import {
  ArrowLeft,
  Calendar,
  FlaskConical,
  Pencil,
  Play,
  Shuffle,
  Sparkles,
  UserRound,
} from "lucide-react"

import { Card, LoadingNotice } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DurationChips,
  TaskCombobox,
} from "@/components/workspace/calendar-overlays"
import { useStartFocus } from "@/components/workspace/focus-view"
import { DeadlineChip, TaskLink } from "@/components/workspace/parts"
import { RealityGapTool } from "@/components/workspace/reality-gap"
import { RescheduleForm } from "@/components/workspace/reschedule-form"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { SupportNotice } from "@/components/workspace/support-notice"
import { useCaseAssist } from "@/components/workspace/use-case-assist"
import type { Assist } from "@/components/workspace/use-case-assist"
import { isCrisisText } from "@/lib/guards"
import {
  RELEASE_CAUTION,
  deriveTitle,
  isConsequential,
  pathGuidance,
  pathLabel,
  suggestBlocker,
} from "@/lib/recovery/case-engine"
import { shortDate } from "@/lib/workspace/dates"
import {
  RECOVERY_REASONS,
  RECOVERY_REASON_LABEL,
  REASON_BLOCKER,
} from "@/lib/workspace/schemas"
import type {
  Recovery,
  RecoveryPath,
  RecoveryReason,
  Task,
} from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const quiet = "min-h-11 justify-start text-muted-foreground"
const PLAN_MINUTES = [2, 5, 10, 15]

function Back({
  onClick,
  children,
}: {
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {children}
    </button>
  )
}

function OriginNote({ origin }: { origin: "live" | "demo" | "user" }) {
  const { Icon, text } =
    origin === "live"
      ? { Icon: Sparkles, text: "Suggested by AI. It can be wrong." }
      : origin === "user"
        ? { Icon: UserRound, text: "Your own step" }
        : { Icon: FlaskConical, text: "Built-in suggestion, not AI" }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {text}
    </p>
  )
}

/** "I've been avoiding something": no block needed, only a few words. */
function ChooseResponsibility() {
  const { state, dispatch } = useStore()
  const [concern, setConcern] = useState(false)
  const [picked, setPicked] = useState<Task | null>(null)
  const text = state.intakeDraft

  function proceed() {
    const value = text.trim()
    if (!value) return
    setConcern(false)
    const at = nowIso()
    const existing =
      picked ??
      state.tasks.find(
        (task) =>
          task.status !== "completed" &&
          task.status !== "released" &&
          task.title.toLowerCase() === value.toLowerCase()
      )
    if (existing) {
      dispatch({ type: "set-intake-draft", text: "" })
      dispatch({
        type: "enter-recovery",
        at,
        taskId: existing.id,
        source: "avoidance",
      })
      return
    }
    const id = newId()
    dispatch({
      type: "start-case",
      id,
      at,
      input: value,
      title: deriveTitle(value),
      suggestedBlocker: suggestBlocker(value),
    })
    dispatch({ type: "enter-recovery", at, taskId: id, source: "avoidance" })
  }

  if (concern) {
    return (
      <SupportNotice onBack={() => setConcern(false)} onContinue={proceed} />
    )
  }
  return (
    <Card className="space-y-3 p-6 sm:p-8">
      <h2 className="font-heading text-[1.625rem] leading-tight">
        What have you been avoiding?
      </h2>
      <p className="text-[15px] text-muted-foreground">
        Messy is fine. It doesn’t need a date or a plan.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (isCrisisText(text)) setConcern(true)
          else proceed()
        }}
      >
        <TaskCombobox
          label="What you’ve been avoiding"
          placeholder="Find a task, or say it in your own words"
          value={text}
          maxLength={2000}
          onChange={(value) =>
            dispatch({ type: "set-intake-draft", text: value })
          }
          onPick={setPicked}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="xl" disabled={!text.trim()}>
            Continue
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            className={quiet}
            onClick={() => dispatch({ type: "exit-recovery" })}
          >
            Never mind
          </Button>
        </div>
      </form>
    </Card>
  )
}

function ReasonList({
  task,
  recovery,
  assist,
}: {
  task: Task
  recovery: Recovery
  assist: Assist
}) {
  const { dispatch } = useStore()
  const start = useStartFocus({ stay: true })
  const [scheduling, setScheduling] = useState(false)
  const recoveryCase = task.recoveryCase

  function choose(reason: RecoveryReason) {
    const blocker = REASON_BLOCKER[reason]
    dispatch({ type: "recovery-reason", reason })
    dispatch({
      type: "case-set-blocker",
      id: task.id,
      at: nowIso(),
      blocker,
    })
    // "No time" asks how to handle it first, so nothing is chosen for them.
    if (reason !== "no-time" || recoveryCase?.path) {
      assist.run("initial", {
        overrides: {
          blocker,
          tried: recoveryCase?.current
            ? [...recoveryCase.tried, recoveryCase.current.text]
            : (recoveryCase?.tried ?? []),
        },
      })
    }
  }

  const suggested = recoveryCase?.suggestedBlocker
  return (
    <Card className="space-y-4 p-6 sm:p-8">
      <div>
        <p className="text-sm font-medium break-words text-sage">
          {task.title}
        </p>
        <div className="mt-0.5">
          <DeadlineChip task={task} />
        </div>
        <h2
          id="reason-question"
          className="mt-2 font-heading text-[1.625rem] leading-tight"
        >
          What’s making this difficult right now?
        </h2>
      </div>
      {scheduling ? (
        <RescheduleForm
          fromRecovery
          task={task}
          onDone={() => setScheduling(false)}
          onSaved={() => dispatch({ type: "exit-recovery" })}
        />
      ) : (
        <>
          <div
            role="group"
            aria-labelledby="reason-question"
            className="grid gap-2"
          >
            {RECOVERY_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => choose(reason)}
                className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-left text-[15px] transition-colors outline-none hover:border-primary/50 hover:bg-sage-soft focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <span className="min-w-0">{RECOVERY_REASON_LABEL[reason]}</span>
                {suggested === REASON_BLOCKER[reason] && (
                  <span className="text-xs text-muted-foreground">
                    Closest to what you wrote
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            This only decides what to offer next. It isn’t a diagnosis.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {recovery.source === "avoidance" && (
              <>
                <Button
                  type="button"
                  size="xl"
                  onClick={() => start(task.id, 5, undefined, true)}
                >
                  <Play aria-hidden />
                  Do 5 minutes now
                </Button>
                <Button
                  type="button"
                  size="xl"
                  variant="ghost"
                  className={quiet}
                  onClick={() => setScheduling(true)}
                >
                  <Calendar aria-hidden />
                  Schedule it
                </Button>
              </>
            )}
            <Back onClick={() => dispatch({ type: "exit-recovery" })}>
              Not now
            </Back>
          </div>
        </>
      )}
    </Card>
  )
}

/** Plan B: one action to do, for a small editable time. Never just advice. */
function PlanB({
  task,
  recovery,
  assist,
  footnote,
}: {
  task: Task
  recovery: Recovery
  assist: Assist
  footnote?: React.ReactNode
}) {
  const { dispatch } = useStore()
  const start = useStartFocus({ stay: true })
  const recoveryCase = task.recoveryCase!
  const current = recoveryCase.current
  const [minutes, setMinutes] = useState(5)
  // Only when asked. A plan that's still arriving isn't something to edit yet.
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(current?.text ?? "")
  const [scheduling, setScheduling] = useState(false)
  const [revealed, setRevealed] = useState(0)

  if (assist.pending) {
    return <LoadingNotice>Working out a next step...</LoadingNotice>
  }

  const save = () => {
    const value = text.trim()
    if (!value) return
    dispatch({
      type: "case-write-action",
      id: task.id,
      at: nowIso(),
      text: value,
    })
    setEditing(false)
  }

  const next = recoveryCase.queue.slice(0, revealed)

  return (
    <section aria-labelledby="plan-b-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h3
          id="plan-b-heading"
          className="font-sans text-sm font-medium tracking-normal text-sage"
        >
          Plan B
        </h3>
        {current && <OriginNote origin={current.origin} />}
      </div>
      {recoveryCase.adaptationNote && (
        <p className="rounded-xl bg-indigo-soft p-3 text-sm text-indigo">
          {recoveryCase.adaptationNote}
        </p>
      )}
      {assist.fellBack && (
        <p
          role="status"
          className="rounded-xl bg-sand-soft p-3 text-sm text-sand"
        >
          Live AI couldn’t answer, so this is a built-in suggestion instead.
        </p>
      )}
      {editing || !current ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <label htmlFor="plan-b-action" className="block text-sm font-medium">
            What’s one thing you could do?
          </label>
          <div className="flex gap-2">
            <Input
              id="plan-b-action"
              autoFocus
              value={text}
              maxLength={300}
              onChange={(event) => setText(event.target.value)}
              className="h-11 flex-1"
            />
            <Button
              type="submit"
              size="xl"
              variant="outline"
              disabled={!text.trim()}
            >
              Save
            </Button>
          </div>
          {recoveryCase.missingDetail && (
            <p className="text-sm text-muted-foreground">
              {recoveryCase.missingDetail}
            </p>
          )}
        </form>
      ) : (
        <div>
          <div className="flex items-start gap-1">
            <p
              data-testid="plan-b-action"
              className="min-w-0 flex-1 font-heading text-[1.5rem] leading-snug break-words"
            >
              {current.text}
            </p>
            <button
              type="button"
              aria-label="Change this step"
              title="Change this step"
              onClick={() => {
                setText(current.text)
                setEditing(true)
              }}
              className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          </div>
          {current.why && (
            <p className="mt-1 text-sm text-muted-foreground">{current.why}</p>
          )}
        </div>
      )}
      {recovery.reason === "dont-know-start" && current && (
        <div className="text-sm">
          {next.length > 0 && (
            <ol className="mb-1 space-y-1 text-muted-foreground">
              {next.map((step, index) => (
                <li key={step}>
                  Then {index + 1}: {step}
                </li>
              ))}
            </ol>
          )}
          {revealed < recoveryCase.queue.length && (
            <button
              type="button"
              onClick={() => setRevealed(revealed + 1)}
              className="min-h-11 rounded-md font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              Show the next step
            </button>
          )}
        </div>
      )}
      {scheduling ? (
        <RescheduleForm
          fromRecovery
          task={task}
          minutes={minutes}
          plannedId={recovery.plannedId}
          onDone={() => setScheduling(false)}
          onSaved={() => dispatch({ type: "exit-recovery" })}
        />
      ) : (
        <>
          {current && (
            <DurationChips
              value={minutes}
              onChange={setMinutes}
              options={PLAN_MINUTES}
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              size="xl"
              disabled={!current}
              onClick={() => {
                // The plan is what's next, ahead of any older note.
                if (task.resumeNote) {
                  dispatch({
                    type: "edit-task",
                    id: task.id,
                    at: nowIso(),
                    patch: { resumeNote: "" },
                  })
                }
                start(task.id, minutes, recovery.plannedId ?? undefined, true)
              }}
            >
              <Play aria-hidden />
              Start
            </Button>
            {current && (
              <Button
                type="button"
                size="xl"
                variant="ghost"
                className={quiet}
                onClick={() => assist.run("another")}
              >
                <Shuffle aria-hidden />
                Try something else
              </Button>
            )}
            <Button
              type="button"
              size="xl"
              variant="ghost"
              className={quiet}
              onClick={() => setScheduling(true)}
            >
              <Calendar aria-hidden />
              Schedule it
            </Button>
            <TaskLink task={task} className="px-2" />
          </div>
        </>
      )}
      {footnote}
    </section>
  )
}

const PATH_TEXT: Record<Exclude<RecoveryPath, "release">, string> = {
  finish:
    "Keep going toward the original requirement, with a session that fits.",
  reduce:
    "Do a smaller thing now. The original task and its deadline don’t change.",
}

/** Finish, Reduce, or Release. Nothing is chosen for them, and none are equal. */
function NoTimeChoices({ task, assist }: { task: Task; assist: Assist }) {
  const { dispatch } = useStore()
  const recoveryCase = task.recoveryCase!
  const [releasing, setReleasing] = useState(false)
  const text = `${task.title} ${recoveryCase.originalInput}`
  const consequential = isConsequential(text)

  function choose(path: Exclude<RecoveryPath, "release">) {
    setReleasing(false)
    const at = nowIso()
    dispatch({ type: "case-set-path", id: task.id, at, path })
    dispatch({ type: "recovery-action", at, taskId: task.id })
    assist.run("path", {
      overrides: {
        path,
        tried: recoveryCase.current
          ? [...recoveryCase.tried, recoveryCase.current.text]
          : recoveryCase.tried,
      },
    })
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-heading text-xl">
          How do you want to handle this?
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {pathGuidance(text, null)}
        </p>
      </div>
      <div role="group" aria-label="Recovery path" className="grid gap-2">
        {(["finish", "reduce"] as const).map((path) => (
          <button
            key={path}
            type="button"
            aria-pressed={recoveryCase.path === path}
            onClick={() => choose(path)}
            className={cn(
              "min-h-12 rounded-xl border bg-card px-4 py-3 text-left transition-colors outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/30",
              recoveryCase.path === path
                ? "border-primary bg-sage-soft"
                : "border-border"
            )}
          >
            <span className="block font-medium">{pathLabel(path)}</span>
            <span className="block text-sm text-muted-foreground">
              {PATH_TEXT[path]}
            </span>
          </button>
        ))}
        <button
          type="button"
          aria-expanded={releasing}
          onClick={() => setReleasing(!releasing)}
          className="min-h-12 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span className="block font-medium">Release</span>
          <span className="block text-sm text-muted-foreground">
            Consciously defer or let go of this, here in BackOnTrack.
          </span>
        </button>
      </div>
      {releasing && (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-sand-soft p-3.5 text-sm text-sand"
        >
          <p>
            This only changes BackOnTrack. It doesn’t cancel anything outside
            this app, and nobody else is told.
          </p>
          <p>
            <strong className="font-semibold">If you stop:</strong> unknown.
            BackOnTrack can’t tell what would happen.
          </p>
          {consequential && <p>{RELEASE_CAUTION}</p>}
          {task.deadline && (
            <p>
              The original deadline stays on record: {shortDate(task.deadline)}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-11"
              onClick={() =>
                dispatch({
                  type: "release-task",
                  at: nowIso(),
                  id: task.id,
                  mode: "defer",
                })
              }
            >
              Set it aside for now
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-11"
              onClick={() =>
                dispatch({
                  type: "release-task",
                  at: nowIso(),
                  id: task.id,
                  mode: "release",
                })
              }
            >
              Yes, release it
            </Button>
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-11"
              onClick={() => setReleasing(false)}
            >
              Keep it
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReasonWork({
  task,
  recovery,
  assist,
}: {
  task: Task
  recovery: Recovery
  assist: Assist
}) {
  const { dispatch } = useStore()
  const recoveryCase = task.recoveryCase!
  const reason = recovery.reason!
  const changeReason = (
    <Back onClick={() => dispatch({ type: "recovery-reason", reason: null })}>
      Choose a different reason
    </Back>
  )
  const header = (
    <div>
      <h2 className="font-sans text-sm font-medium tracking-normal break-words text-sage">
        {task.title}
      </h2>
      <div className="mt-0.5">
        <DeadlineChip task={task} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {RECOVERY_REASON_LABEL[reason]}
      </p>
    </div>
  )

  if (reason === "worried") {
    return (
      <div className="space-y-4">
        <Card className="space-y-4 p-6 sm:p-8">
          {header}
          <PlanB task={task} recovery={recovery} assist={assist} />
          {changeReason}
        </Card>
        <RealityGapTool task={task} />
      </div>
    )
  }

  if (reason === "no-time") {
    return (
      <Card className="space-y-5 p-6 sm:p-8">
        {header}
        <NoTimeChoices task={task} assist={assist} />
        {recoveryCase.path && (
          <PlanB
            key={recoveryCase.path}
            task={task}
            recovery={recovery}
            assist={assist}
            footnote={
              recoveryCase.path === "reduce" ? (
                <p className="text-sm text-muted-foreground">
                  Finishing this smaller thing won’t mark the original task
                  done.
                </p>
              ) : undefined
            }
          />
        )}
        {changeReason}
      </Card>
    )
  }

  return (
    <Card className="space-y-4 p-6 sm:p-8">
      {header}
      <PlanB task={task} recovery={recovery} assist={assist} />
      {changeReason}
    </Card>
  )
}

function WithTask({ task, recovery }: { task: Task; recovery: Recovery }) {
  const { dispatch } = useStore()
  const assist = useCaseAssist(task)
  if (assist.concern) {
    return (
      <SupportNotice
        onBack={() => {
          assist.clearConcern()
          dispatch({ type: "exit-recovery" })
        }}
      />
    )
  }
  return recovery.reason ? (
    <ReasonWork task={task} recovery={recovery} assist={assist} />
  ) : (
    <ReasonList task={task} recovery={recovery} assist={assist} />
  )
}

/** Recovery, right where the next action would be. Never a separate place. */
export function RecoveryPanel({
  task,
  recovery,
}: {
  task: Task | null
  recovery: Recovery
}) {
  return task ? (
    <WithTask key={task.id} task={task} recovery={recovery} />
  ) : (
    <ChooseResponsibility />
  )
}
