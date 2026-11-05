"use client"

import { useState } from "react"
import { Check, Clock, CornerDownRight, RefreshCw } from "lucide-react"

import {
  Card,
  ErrorNotice,
  LoadingNotice,
  ScreenHeading,
  SourceBadge,
} from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { LIMITS } from "@/lib/schemas"
import type { StepOutcome } from "@/lib/schemas"
import { consecutiveFailures } from "@/lib/session"
import type { CurrentStep, Session } from "@/lib/session"
import { STRATEGY_LABEL } from "@/lib/summary"

const STUCK_REASONS = [
  "I don't know where to begin",
  "It still feels too big",
  "I'm missing information",
  "I just can't face it right now",
]

const CHANGE_REASONS = [
  "It doesn't fit my situation",
  "I've already done this",
  "I'd rather do something else first",
]

function planLabel(failures: number) {
  return `Plan ${String.fromCharCode(65 + Math.min(failures, 25))}`
}

export function ActionWorkspace({
  session,
  busy,
  error,
  onResolve,
  onRetry,
  onUseDemo,
  onRethink,
  onFinish,
}: {
  session: Session
  busy: boolean
  error: string | null
  onResolve: (outcome: StepOutcome, userText: string, note: string) => void
  onRetry: () => void
  onUseDemo?: () => void
  onRethink: () => void
  onFinish: () => void
}) {
  const completedCount = session.steps.filter(
    (step) => step.outcome === "completed"
  ).length
  const failures = consecutiveFailures(session.steps)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {session.strategy && `${STRATEGY_LABEL[session.strategy]} path`}
          {completedCount > 0 && ` · ${completedCount} done`}
        </span>
        {session.current && <SourceBadge source={session.current.source} />}
      </div>

      {session.current ? (
        <StepCard
          key={session.current.action.instruction}
          step={session.current}
          failures={failures}
          onResolve={onResolve}
          busy={busy}
        />
      ) : busy ? (
        <Card className="py-10">
          <LoadingNotice>Finding one realistic step...</LoadingNotice>
        </Card>
      ) : error ? (
        <ErrorNotice
          message={error}
          onRetry={onRetry}
          onUseDemo={onUseDemo}
          extra={
            <Button type="button" variant="ghost" size="lg" onClick={onFinish}>
              Go to my summary
            </Button>
          }
        />
      ) : session.pathComplete ? (
        <Card>
          <ScreenHeading className="text-[1.75rem] sm:text-[2rem]">
            That&rsquo;s a good place to pause.
          </ScreenHeading>
          <p className="mt-3 text-muted-foreground">
            {session.closingNote ||
              `You marked ${completedCount} ${completedCount === 1 ? "step" : "steps"} as completed. Your summary shows what happened and what is still open.`}
          </p>
          <Button type="button" size="xl" className="mt-5" onClick={onFinish}>
            See my summary
          </Button>
        </Card>
      ) : (
        <Card>
          <p className="text-muted-foreground">
            Your next step isn&rsquo;t loaded yet.
          </p>
          <Button type="button" size="xl" className="mt-4" onClick={onRetry}>
            Get my next step
          </Button>
        </Card>
      )}

      {!session.pathComplete && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={busy}
            onClick={onFinish}
          >
            Finish for now
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={busy}
            onClick={onRethink}
          >
            Rethink my decision
          </Button>
        </div>
      )}
    </div>
  )
}

function StepCard({
  step,
  failures,
  busy,
  onResolve,
}: {
  step: CurrentStep
  failures: number
  busy: boolean
  onResolve: (outcome: StepOutcome, userText: string, note: string) => void
}) {
  const [text, setText] = useState("")
  const [panel, setPanel] = useState<"stuck" | "change" | null>(null)
  const [note, setNote] = useState("")

  const { action } = step
  const isPlanB = step.origin === "stuck"
  const isChanged = step.origin === "change"

  function pressStuck() {
    // The first time, adapt straight away. After that, ask what's in the way.
    if (failures === 0) {
      onResolve("stuck", text, "")
    } else {
      setNote("")
      setPanel("stuck")
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      {(isPlanB || isChanged) && (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-indigo-soft p-3.5 text-sm leading-relaxed text-indigo">
          <CornerDownRight className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">
              {isPlanB ? planLabel(failures) : "A different step"}.
            </strong>{" "}
            {step.adaptationNote ||
              "The last step didn't work, so this one takes a different approach."}
          </p>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-sm font-medium text-sage">
        Just this one thing
        <span className="flex items-center gap-1 font-normal text-muted-foreground">
          <span aria-hidden>·</span>
          <Clock className="size-3.5" aria-hidden />
          about {action.minutes} min
        </span>
      </p>

      <ScreenHeading className="mt-2 text-[1.625rem] leading-tight sm:text-[2rem]">
        {action.instruction}
      </ScreenHeading>
      {action.why && (
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {action.why}
        </p>
      )}

      <div className="mt-5">
        <label
          htmlFor="step-input"
          className="mb-1.5 block text-sm font-medium"
        >
          {action.inputLabel}
        </label>
        <Textarea
          id="step-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={LIMITS.stepText}
          placeholder={action.inputPlaceholder}
          className="min-h-24"
        />
      </div>

      {step.suggestWrapUp && !panel && (
        <p className="mt-3 text-sm text-muted-foreground">
          After this could be a reasonable place to stop for today, if you like.
        </p>
      )}

      {panel ? (
        <ReasonPanel
          title={
            panel === "stuck"
              ? "What's getting in the way? This is optional."
              : "What should be different? This is optional."
          }
          reasons={panel === "stuck" ? STUCK_REASONS : CHANGE_REASONS}
          note={note}
          busy={busy}
          onNote={setNote}
          onCancel={() => setPanel(null)}
          onSubmit={() =>
            onResolve(panel === "stuck" ? "stuck" : "changed", text, note)
          }
        />
      ) : (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            size="xl"
            disabled={busy}
            onClick={() => onResolve("completed", text, "")}
          >
            <Check aria-hidden />
            Completed
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xl"
            disabled={busy}
            onClick={pressStuck}
          >
            I&rsquo;m Still Stuck
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xl"
            disabled={busy}
            onClick={() => {
              setNote("")
              setPanel("change")
            }}
          >
            <RefreshCw aria-hidden />
            Change This Step
          </Button>
        </div>
      )}
    </Card>
  )
}

function ReasonPanel({
  title,
  reasons,
  note,
  busy,
  onNote,
  onCancel,
  onSubmit,
}: {
  title: string
  reasons: string[]
  note: string
  busy: boolean
  onNote: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <div className="mt-5 animate-in rounded-xl bg-secondary p-4 duration-200 fade-in">
      <label htmlFor="reason-note" className="block text-sm font-medium">
        {title}
      </label>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {reasons.map((reason) => (
          <button
            key={reason}
            type="button"
            aria-pressed={note === reason}
            onClick={() => onNote(note === reason ? "" : reason)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 ${
              note === reason
                ? "border-primary bg-sage-soft"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            {reason}
          </button>
        ))}
      </div>
      <Textarea
        id="reason-note"
        value={note}
        maxLength={LIMITS.note}
        onChange={(event) => onNote(event.target.value)}
        placeholder="Or say it in your own words"
        className="mt-2.5 min-h-16"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="xl" disabled={busy} onClick={onSubmit}>
          Try another approach
        </Button>
        <Button type="button" variant="ghost" size="xl" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  )
}
