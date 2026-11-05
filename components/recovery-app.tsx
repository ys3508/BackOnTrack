"use client"

import { useCallback, useEffect, useReducer, useState } from "react"
import { Trash2 } from "lucide-react"

import { ActionWorkspace } from "@/components/screens/action-workspace"
import { DecisionScreen } from "@/components/screens/decision"
import { IntakeScreen } from "@/components/screens/intake"
import { RealityCheckScreen } from "@/components/screens/reality-check"
import { SummaryScreen } from "@/components/screens/summary"
import { Button } from "@/components/ui/button"
import {
  fetchLiveStatus,
  requestAnalysis,
  requestNextStep,
} from "@/lib/recovery-client"
import type { Intake, StepEvent, StepOutcome, Strategy } from "@/lib/schemas"
import {
  clearSession,
  loadSession,
  saveSession,
  sessionReducer,
} from "@/lib/session"
import type { Screen, Session, Source, StepRecord } from "@/lib/session"
import { cn } from "@/lib/utils"

const STAGES: { screen: Screen; label: string }[] = [
  { screen: "intake", label: "Describe" },
  { screen: "reality", label: "Reality Check" },
  { screen: "decision", label: "Decide" },
  { screen: "action", label: "One Step" },
  { screen: "summary", label: "Summary" },
]

export function RecoveryApp({
  embedded = false,
  modeOverride,
  onSaveAsTask,
}: {
  /** Hides the page frame when shown inside the workspace. */
  embedded?: boolean
  modeOverride?: Source
  onSaveAsTask?: (session: Session) => void
} = {}) {
  const [session, dispatch] = useReducer(sessionReducer, undefined, loadSession)
  const [status, setStatus] = useState<{
    checked: boolean
    live: boolean
    model: string | null
  }>({ checked: false, live: false, model: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchLiveStatus().then((result) => {
      if (active) setStatus({ checked: true, ...result })
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    saveSession(session)
  }, [session])

  const mode: Source =
    modeOverride ??
    (status.live && session.modePreference !== "demo" ? "live" : "demo")

  const analyze = useCallback(
    async (intake: Intake, useMode: Source = mode) => {
      setBusy(true)
      setError(null)
      try {
        const analysis = await requestAnalysis(useMode, intake)
        dispatch({ type: "analysis-ready", intake, analysis, source: useMode })
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Something went wrong."
        )
      } finally {
        setBusy(false)
      }
    },
    [mode]
  )

  const fetchNextStep = useCallback(
    async (
      base: Session,
      strategy: Strategy,
      steps: StepRecord[],
      event: StepEvent,
      note: string,
      useMode: Source = mode
    ) => {
      if (!base.analysis) return
      setBusy(true)
      setError(null)
      try {
        const result = await requestNextStep(useMode, {
          stage: "next-step",
          intake: base.intake,
          knownFacts: base.analysis.realityCheck.knownFacts,
          unknowns: base.analysis.realityCheck.unknowns,
          strategy,
          event,
          note,
          history: steps.map((step) => ({
            instruction: step.instruction,
            approach: step.approach,
            outcome: step.outcome,
            userText: step.userText,
            note: step.note,
          })),
        })
        dispatch({
          type: "step-ready",
          closingNote: result.action ? "" : result.adaptationNote,
          step: result.action
            ? {
                action: result.action,
                adaptationNote: result.adaptationNote,
                suggestWrapUp: result.suggestWrapUp,
                origin: event,
                source: useMode,
              }
            : null,
        })
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Something went wrong."
        )
      } finally {
        setBusy(false)
      }
    },
    [mode]
  )

  function chooseStrategy(strategy: Strategy) {
    dispatch({ type: "choose-strategy", strategy })
    fetchNextStep(session, strategy, session.steps, "start", "")
  }

  function resolveStep(outcome: StepOutcome, userText: string, note: string) {
    if (!session.current || !session.strategy) return
    dispatch({ type: "resolve-step", outcome, userText, note })
    const record: StepRecord = {
      instruction: session.current.action.instruction,
      approach: session.current.action.approach,
      outcome,
      userText: userText.trim(),
      note: note.trim(),
      source: session.current.source,
    }
    const event: StepEvent = outcome === "changed" ? "change" : outcome
    fetchNextStep(
      session,
      session.strategy,
      [...session.steps, record],
      event,
      note.trim()
    )
  }

  function retryStep(useMode: Source = mode) {
    if (!session.strategy) return
    fetchNextStep(
      session,
      session.strategy,
      session.steps,
      session.lastEvent ?? "start",
      session.lastNote,
      useMode
    )
  }

  function switchToDemo() {
    dispatch({ type: "set-mode", mode: "demo" })
    setError(null)
  }

  function reset() {
    clearSession()
    dispatch({ type: "reset" })
    setError(null)
  }

  const stageIndex = STAGES.findIndex(
    (stage) => stage.screen === session.screen
  )
  const hasData = Boolean(session.intake.responsibility)

  return (
    <div className={embedded ? "flex flex-col" : "flex min-h-svh flex-col"}>
      {!embedded && (
        <header className="border-b border-border/70">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
            <div className="flex items-center gap-2.5">
              <Logo />
              <span className="font-heading text-xl">BackOnTrack</span>
            </div>
            <div className="flex items-center gap-2">
              <ModeSwitch
                mode={mode}
                liveAvailable={status.live}
                checked={status.checked}
                onChange={(next) => dispatch({ type: "set-mode", mode: next })}
              />
              {hasData && (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={reset}
                  className="px-2.5 text-muted-foreground sm:px-4"
                  aria-label="Delete my data and start over"
                >
                  <Trash2 aria-hidden />
                  <span className="hidden sm:inline">Delete my data</span>
                </Button>
              )}
            </div>
          </div>
        </header>
      )}

      <nav
        aria-label="Progress"
        className="mx-auto w-full max-w-4xl px-5 pt-6 sm:px-6"
      >
        <ol className="flex gap-1.5">
          {STAGES.map((stage, index) => (
            <li
              key={stage.screen}
              aria-current={index === stageIndex ? "step" : undefined}
              className="min-w-0 flex-1"
            >
              <span
                className={cn(
                  "block h-1 rounded-full transition-colors duration-300",
                  index <= stageIndex ? "bg-primary" : "bg-border"
                )}
              />
              <span
                className={cn(
                  "mt-2 hidden truncate text-xs sm:block",
                  index === stageIndex
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {stage.label}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs font-medium sm:hidden">
          Step {stageIndex + 1} of {STAGES.length}: {STAGES[stageIndex].label}
        </p>
      </nav>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 pt-8 pb-16 sm:px-6 sm:pt-10">
        <div
          key={session.screen}
          className="animate-in duration-300 fade-in slide-in-from-bottom-1"
        >
          {session.screen === "intake" && (
            <IntakeScreen
              key={JSON.stringify(session.intake)}
              initial={session.intake}
              mode={mode}
              modelReady={status.checked}
              liveAvailable={status.live}
              busy={busy}
              error={error}
              onSubmit={(intake) => analyze(intake)}
              onUseDemo={mode === "live" ? switchToDemo : undefined}
            />
          )}
          {session.screen === "reality" && session.analysis && (
            <RealityCheckScreen
              analysis={session.analysis}
              source={session.analysisSource}
              onBack={() => dispatch({ type: "go", screen: "intake" })}
              onContinue={() => dispatch({ type: "go", screen: "decision" })}
            />
          )}
          {session.screen === "decision" && session.analysis && (
            <DecisionScreen
              analysis={session.analysis}
              source={session.analysisSource}
              initialChoice={session.strategy}
              onBack={() => dispatch({ type: "go", screen: "reality" })}
              onChoose={chooseStrategy}
            />
          )}
          {session.screen === "action" && (
            <ActionWorkspace
              session={session}
              busy={busy}
              error={error}
              onResolve={resolveStep}
              onRetry={() => retryStep()}
              onUseDemo={
                mode === "live"
                  ? () => {
                      switchToDemo()
                      retryStep("demo")
                    }
                  : undefined
              }
              onRethink={() => dispatch({ type: "go", screen: "decision" })}
              onFinish={() => {
                setError(null)
                dispatch({ type: "go", screen: "summary" })
              }}
            />
          )}
          {session.screen === "summary" && (
            <SummaryScreen
              session={session}
              onBack={
                session.strategy
                  ? () => dispatch({ type: "go", screen: "action" })
                  : undefined
              }
              onReset={reset}
              onSaveAsTask={
                onSaveAsTask ? () => onSaveAsTask(session) : undefined
              }
            />
          )}
        </div>
      </main>

      {!embedded && (
        <footer className="border-t border-border/70 px-6 py-4 text-center text-xs text-muted-foreground">
          BackOnTrack offers suggestions and can be wrong. It is not medical,
          legal, or financial advice.
        </footer>
      )}
    </div>
  )
}

function ModeSwitch({
  mode,
  liveAvailable,
  checked,
  onChange,
}: {
  mode: Source
  liveAvailable: boolean
  checked: boolean
  onChange: (mode: Source) => void
}) {
  const options: { value: Source; label: string }[] = [
    { value: "live", label: "Live AI" },
    { value: "demo", label: "Demo" },
  ]
  return (
    <div
      role="group"
      aria-label="Response source"
      className="flex rounded-lg bg-secondary p-0.5 text-xs font-medium"
    >
      {options.map((option) => {
        const unavailable = option.value === "live" && !liveAvailable
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            disabled={unavailable || !checked}
            title={
              unavailable && checked
                ? "Live AI needs an API key on the server"
                : undefined
            }
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-8 rounded-md px-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === option.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
              unavailable && "cursor-not-allowed"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M8 22c5 0 4-12 9-12 3 0 3.500 4 7 4"
        fill="none"
        stroke="white"
        strokeWidth="2.600"
        strokeLinecap="round"
      />
      <circle cx="8" cy="22" r="2.300" fill="white" />
    </svg>
  )
}
