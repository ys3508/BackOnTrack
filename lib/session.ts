import { EMPTY_INTAKE, migrateIntake } from "@/lib/intake"
import { ActionStepSchema, AnalysisSchema } from "@/lib/schemas"
import type {
  ActionStep,
  Analysis,
  HistoryEntry,
  Intake,
  StepEvent,
  StepOutcome,
  Strategy,
} from "@/lib/schemas"

export type Screen = "intake" | "reality" | "decision" | "action" | "summary"
export type Source = "live" | "demo"

export type CurrentStep = {
  action: ActionStep
  adaptationNote: string
  suggestWrapUp: boolean
  origin: StepEvent
  source: Source
}

export type StepRecord = HistoryEntry & { source: Source }

export type Session = {
  version: 1
  screen: Screen
  modePreference: Source | null
  intake: Intake
  analysis: Analysis | null
  analysisSource: Source | null
  strategy: Strategy | null
  steps: StepRecord[]
  current: CurrentStep | null
  /** Set when a step source reports it has nothing further to suggest. */
  pathComplete: boolean
  /** The latest message from the step source when there is no current step. */
  closingNote: string
  /** The latest resolved event, so a failed request can be retried. */
  lastEvent: StepEvent | null
  lastNote: string
}

export const initialSession: Session = {
  version: 1,
  screen: "intake",
  modePreference: null,
  intake: EMPTY_INTAKE,
  analysis: null,
  analysisSource: null,
  strategy: null,
  steps: [],
  current: null,
  pathComplete: false,
  closingNote: "",
  lastEvent: null,
  lastNote: "",
}

export type SessionAction =
  | { type: "set-mode"; mode: Source }
  | { type: "go"; screen: Screen }
  | {
      type: "analysis-ready"
      intake: Intake
      analysis: Analysis
      source: Source
    }
  | { type: "choose-strategy"; strategy: Strategy }
  | {
      type: "resolve-step"
      outcome: StepOutcome
      userText: string
      note: string
    }
  | {
      type: "step-ready"
      step: CurrentStep | null
      closingNote: string
    }
  | { type: "reset" }

function eventFor(outcome: StepOutcome): StepEvent {
  return outcome === "changed" ? "change" : outcome
}

export function sessionReducer(state: Session, action: SessionAction): Session {
  switch (action.type) {
    case "set-mode":
      return { ...state, modePreference: action.mode }
    case "go":
      return { ...state, screen: action.screen }
    case "analysis-ready":
      return {
        ...initialSession,
        modePreference: state.modePreference,
        screen: "reality",
        intake: action.intake,
        analysis: action.analysis,
        analysisSource: action.source,
      }
    case "choose-strategy":
      return {
        ...state,
        strategy: action.strategy,
        screen: "action",
        current: null,
        pathComplete: false,
        closingNote: "",
        lastEvent: "start",
        lastNote: "",
      }
    case "resolve-step": {
      // The step is recorded as soon as the user reports it, so an outcome is
      // never lost when the request for the next step fails.
      if (!state.current) return state
      const record: StepRecord = {
        instruction: state.current.action.instruction,
        approach: state.current.action.approach,
        outcome: action.outcome,
        userText: action.userText.trim(),
        note: action.note.trim(),
        source: state.current.source,
      }
      return {
        ...state,
        steps: [...state.steps, record],
        current: null,
        lastEvent: eventFor(action.outcome),
        lastNote: action.note.trim(),
      }
    }
    case "step-ready":
      return {
        ...state,
        current: action.step,
        pathComplete: action.step === null,
        closingNote: action.closingNote,
      }
    case "reset":
      return initialSession
  }
}

/* ---------- Browser storage ---------- */

const SCREENS: Screen[] = ["intake", "reality", "decision", "action", "summary"]

/**
 * Turns whatever was saved into a usable session. Older intake formats are
 * migrated, and anything unusable falls back to a safe screen instead of crashing.
 */
export function restoreSession(raw: unknown): Session {
  if (!raw || typeof raw !== "object") return initialSession
  const saved = raw as Partial<Session> & { version?: unknown }
  if (saved.version !== 1) return initialSession

  const analysis = AnalysisSchema.safeParse(saved.analysis).success
    ? (saved.analysis as Analysis)
    : null
  const current =
    saved.current && ActionStepSchema.safeParse(saved.current.action).success
      ? saved.current
      : null
  const strategy = saved.strategy ?? null

  let screen: Screen = SCREENS.includes(saved.screen as Screen)
    ? (saved.screen as Screen)
    : "intake"
  if (!analysis) screen = "intake"
  else if (!strategy && (screen === "action" || screen === "summary")) {
    screen = "decision"
  }

  return {
    ...initialSession,
    ...saved,
    version: 1,
    screen,
    intake: migrateIntake(saved.intake),
    analysis,
    strategy: analysis ? strategy : null,
    steps: analysis && Array.isArray(saved.steps) ? saved.steps : [],
    current: analysis ? current : null,
  }
}

const STORAGE_KEY = "backontrack.session.v1"

export function loadSession(): Session {
  if (typeof window === "undefined") return initialSession
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialSession
    return restoreSession(JSON.parse(raw))
  } catch {
    return initialSession
  }
}

export function saveSession(session: Session) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Storage may be full or blocked. The app still works for this visit.
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/** How many steps in a row have failed, counting back from the latest. */
export function consecutiveFailures(steps: HistoryEntry[]) {
  const lastCompleted = steps.findLastIndex(
    (step) => step.outcome === "completed"
  )
  return steps.length - lastCompleted - 1
}
