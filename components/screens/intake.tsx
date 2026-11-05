"use client"

import { useState } from "react"
import { ArrowRight, ChevronDown } from "lucide-react"

import { ErrorNotice, LoadingNotice, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import { OBSTACLE_LABEL, STATUS_LABEL } from "@/lib/intake"
import { IntakeSchema, LIMITS, isCalendarDate } from "@/lib/schemas"
import type { Deadline, Intake } from "@/lib/schemas"
import type { Source } from "@/lib/session"
import { cn } from "@/lib/utils"

type DeadlineChoice = Deadline["type"]

const DEADLINE_OPTIONS: { value: DeadlineChoice; label: string }[] = [
  { value: "date", label: "Pick a date" },
  { value: "none", label: "No deadline" },
  { value: "unsure", label: "I’m not sure" },
]

const toOptions = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({
    value,
    label,
  }))

/**
 * A single-select group built on native radio buttons, so arrow keys and screen
 * readers work as expected. Nothing starts selected, and choosing the selected
 * option again clears it, because every one of these questions is optional.
 */
function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  className,
}: {
  legend: string
  name: string
  options: { value: T; label: string }[]
  value: T | null
  onChange: (value: T | null) => void
  className?: string
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className={cn("grid grid-cols-1 gap-2", className)}>
        {options.map((option) => {
          const selected = value === option.value
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[15px] leading-snug transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/30",
                selected
                  ? "border-primary bg-sage-soft"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                onClick={() => {
                  if (selected) onChange(null)
                }}
                onKeyUp={(event) => {
                  // Browsers send no click for Space on a checked radio.
                  if (event.key === " " && selected) {
                    event.preventDefault()
                    onChange(null)
                  }
                }}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  selected ? "border-primary" : "border-input"
                )}
              >
                {selected && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function IntakeScreen({
  initial,
  mode,
  modelReady,
  liveAvailable,
  busy,
  error,
  onSubmit,
  onUseDemo,
}: {
  initial: Intake
  mode: Source
  modelReady: boolean
  liveAvailable: boolean
  busy: boolean
  error: string | null
  onSubmit: (intake: Intake) => void
  onUseDemo?: () => void
}) {
  const [responsibility, setResponsibility] = useState(initial.responsibility)
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice | null>(
    initial.deadline?.type ?? null
  )
  const [deadlineDate, setDeadlineDate] = useState(
    initial.deadline?.type === "date" ? initial.deadline.date : ""
  )
  const [status, setStatus] = useState(initial.status)
  const [obstacle, setObstacle] = useState(initial.obstacle)
  const [obstacleOther, setObstacleOther] = useState(initial.obstacleOther)
  const [validation, setValidation] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(
    Boolean(initial.deadline || initial.status || initial.obstacle)
  )

  function buildIntake() {
    // "Pick a date" with no date chosen is not an answer, so it stays unanswered.
    let deadline: Intake["deadline"] = null
    if (deadlineChoice === "date") {
      if (isCalendarDate(deadlineDate)) {
        deadline = { type: "date", date: deadlineDate }
      }
    } else if (deadlineChoice) {
      deadline = { type: deadlineChoice }
    }
    return IntakeSchema.safeParse({
      responsibility,
      deadline,
      status,
      obstacle,
      obstacleOther: obstacle === "something-else" ? obstacleOther : "",
      legacyNotes: initial.legacyNotes,
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = buildIntake()
    if (!parsed.success) {
      setValidation(
        parsed.error.issues[0]?.message ?? "Please check your input."
      )
      return
    }
    setValidation(null)
    onSubmit(parsed.data)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-3 text-sm font-medium text-sage">
        When plans fall apart, find your way forward.
      </p>
      <ScreenHeading>What&rsquo;s been weighing on you?</ScreenHeading>
      <p className="mt-3 text-muted-foreground">
        A few words are enough. You can figure out the rest as you go.
      </p>

      {mode === "demo" && modelReady && (
        <p className="mt-5 rounded-xl bg-indigo-soft px-4 py-3 text-sm text-indigo">
          <strong className="font-semibold">Demo Mode.</strong> Responses are
          prewritten examples and are not generated by AI. Nothing leaves your
          browser.
          {!liveAvailable &&
            " Live AI turns on when an API key is configured on the server."}
        </p>
      )}

      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor="responsibility" className="sr-only">
            What&rsquo;s been weighing on you?
          </label>
          <Textarea
            id="responsibility"
            value={responsibility}
            onChange={(event) => {
              setResponsibility(event.target.value)
              setValidation(null)
            }}
            maxLength={LIMITS.responsibility}
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? "intake-error" : undefined}
            placeholder="e.g. I haven't replied to an important email..."
            className="min-h-36 p-4 text-[17px] leading-relaxed"
          />
          {validation && (
            <p
              id="intake-error"
              role="alert"
              className="mt-2 text-sm text-destructive"
            >
              {validation}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            Or try an example:
          </p>
          <div className="flex flex-wrap gap-2">
            {DEMO_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                onClick={() => {
                  setResponsibility(scenario.input)
                  setValidation(null)
                }}
                className="min-h-11 rounded-full border border-border bg-card px-3.5 py-2 text-left text-sm transition-colors outline-none hover:border-primary/50 hover:bg-sage-soft focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                {scenario.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button
            type="button"
            aria-expanded={showDetails}
            aria-controls="intake-details"
            onClick={() => setShowDetails(!showDetails)}
            className="flex min-h-11 items-center gap-1.5 rounded-md py-1 text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <ChevronDown
              aria-hidden
              className={`size-4 transition-transform ${showDetails ? "rotate-180" : ""}`}
            />
            Add details (optional)
          </button>
          {showDetails && (
            <div
              id="intake-details"
              className="mt-3 animate-in space-y-5 duration-200 fade-in"
            >
              <div>
                <ChoiceGroup
                  legend="Original deadline"
                  name="deadline"
                  options={DEADLINE_OPTIONS}
                  value={deadlineChoice}
                  onChange={setDeadlineChoice}
                  className="sm:grid-cols-3"
                />
                {deadlineChoice === "date" && (
                  <div className="mt-2 animate-in duration-200 fade-in">
                    <label
                      htmlFor="deadline-date"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      Deadline date
                    </label>
                    <Input
                      id="deadline-date"
                      type="date"
                      max="9999-12-31"
                      value={deadlineDate}
                      onChange={(event) => setDeadlineDate(event.target.value)}
                      className="h-12 sm:max-w-64"
                    />
                  </div>
                )}
              </div>

              <ChoiceGroup
                legend="Current status"
                name="status"
                options={toOptions(STATUS_LABEL)}
                value={status}
                onChange={setStatus}
                className="sm:grid-cols-2"
              />

              <div>
                <ChoiceGroup
                  legend="Main obstacle"
                  name="obstacle"
                  options={toOptions(OBSTACLE_LABEL)}
                  value={obstacle}
                  onChange={setObstacle}
                  className="sm:grid-cols-2"
                />
                {obstacle === "something-else" && (
                  <div className="mt-2 animate-in duration-200 fade-in">
                    <label
                      htmlFor="obstacle-other"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      What is it? (optional)
                    </label>
                    <Input
                      id="obstacle-other"
                      value={obstacleOther}
                      maxLength={LIMITS.detail}
                      onChange={(event) => setObstacleOther(event.target.value)}
                      className="h-12"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <ErrorNotice
            message={error}
            onRetry={() => {
              const parsed = buildIntake()
              if (parsed.success) onSubmit(parsed.data)
            }}
            onUseDemo={onUseDemo}
          />
        )}

        <div className="flex flex-col items-start gap-4 pt-2 sm:flex-row sm:items-center">
          <Button type="submit" size="xl" disabled={busy || !modelReady}>
            Help me restart
            <ArrowRight aria-hidden />
          </Button>
          {busy && <LoadingNotice>Looking at what you wrote...</LoadingNotice>}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          No account needed. Your session is saved only in this browser, and you
          can delete it at any time.
          {mode === "live" &&
            " In Live AI mode, what you enter is sent to the AI provider to generate responses, so please avoid sensitive personal details."}
        </p>
      </form>
    </div>
  )
}
