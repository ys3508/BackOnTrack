import { LIMITS } from "@/lib/schemas"
import type {
  ActionStep,
  Analysis,
  HistoryEntry,
  Intake,
  NextStepOutput,
} from "@/lib/schemas"

/* ---------- Safety ---------- */

const HIGH_STAKES =
  /\b(court|lawsuit|legal|lawyer|subpoena|contract|tax(es)?|irs|visa|immigration|loans?|debts?|mortgage|rent|eviction|bills?|insurance|medical|doctor|surgery|medication|prescription|diagnosis|exams?|assignments?|thesis|dissertation|degree|tuition|scholarship|professor|finals?)\b/i

const CRISIS =
  /(kill(ing)? myself|suicid|end(ing)? my life|want to die|self[- ]?harm|hurt(ing)? myself|no reason to live)/i

export const DEFAULT_CAUTION =
  "This looks like it may involve a legal, financial, medical or academic obligation. Before dropping it, check with the person or office responsible what stopping would actually mean."

function intakeText(intake: Intake) {
  return [
    intake.responsibility,
    intake.deadline,
    intake.status,
    intake.obstacle,
  ].join(" ")
}

export function detectHighStakes(intake: Intake) {
  return HIGH_STAKES.test(intakeText(intake))
}

export function detectSupportConcern(intake: Intake) {
  return CRISIS.test(intakeText(intake))
}

/**
 * Applies the rules that must hold regardless of what generated the analysis:
 * RELEASE is never the recommendation for a high-stakes obligation.
 */
export function applySafetyGuards(
  analysis: Analysis,
  intake: Intake
): Analysis {
  const highStakes = analysis.decision.highStakes || detectHighStakes(intake)
  const decision = { ...analysis.decision, highStakes }

  if (highStakes) {
    decision.caution = decision.caution.trim() || DEFAULT_CAUTION
    if (decision.recommended === "RELEASE") {
      decision.recommended = "REDUCE"
      decision.reasoning = `${decision.reasoning} Because this may be an important obligation, BackOnTrack suggests reducing it rather than releasing it until you have confirmed the consequences. Releasing it remains your choice.`
    }
  }

  return {
    ...analysis,
    decision,
    supportConcern: analysis.supportConcern || detectSupportConcern(intake),
  }
}

/* ---------- Normalizing model output ---------- */

function cleanList(items: string[], max: number) {
  return items
    .map((item) => item.trim().slice(0, LIMITS.listItem))
    .filter(Boolean)
    .slice(0, max)
}

export class InvalidModelOutputError extends Error {}

/** Enforces the bounds the JSON schema leaves out. Throws if unusable. */
export function normalizeAnalysis(raw: Analysis): Analysis {
  const reality = raw.realityCheck
  const normalized: Analysis = {
    ...raw,
    acknowledgement: raw.acknowledgement.trim(),
    realityCheck: {
      knownFacts: cleanList(reality.knownFacts, 6),
      assumptions: cleanList(reality.assumptions, 5),
      unknowns: cleanList(reality.unknowns, 5),
      consequences: reality.consequences
        .map((item) => ({
          ...item,
          text: item.text.trim().slice(0, LIMITS.listItem),
        }))
        .filter((item) => item.text)
        .slice(0, 4),
    },
  }

  if (
    !normalized.realityCheck.knownFacts.length ||
    !normalized.realityCheck.unknowns.length ||
    !raw.decision.reasoning.trim()
  ) {
    throw new InvalidModelOutputError("Analysis is missing required content.")
  }
  return normalized
}

export function normalizeNextStep(raw: NextStepOutput): NextStepOutput {
  const instruction = raw.action.instruction.trim()
  if (!instruction) {
    throw new InvalidModelOutputError("Step has no instruction.")
  }
  const minutes = Number.isFinite(raw.action.minutes) ? raw.action.minutes : 2
  return {
    ...raw,
    adaptationNote: raw.adaptationNote.trim(),
    action: {
      ...raw.action,
      instruction,
      why: raw.action.why.trim(),
      inputLabel: raw.action.inputLabel.trim() || "Your answer",
      minutes: Math.min(Math.max(Math.round(minutes), 1), 15),
    },
  }
}

/* ---------- Failure-aware step selection ---------- */

const STOPWORDS = new Set(
  "a an and any at be by for from in into is it its just of on one or that the then this to up with you your".split(
    " "
  )
)

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word && !STOPWORDS.has(word))
  )
}

/** Jaccard similarity of meaningful words, from 0 (unrelated) to 1 (same). */
export function similarity(a: string, b: string) {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0
  const shared = [...left].filter((word) => right.has(word)).length
  return shared / (left.size + right.size - shared)
}

const REPEAT_THRESHOLD = 0.6

/**
 * A step is a repeat if it closely matches anything already tried, or if it
 * reuses the approach of the step that just failed. Rewording the same advice,
 * or staying on the approach that did not work, does not count as adapting.
 */
export function findRepeatReason(
  action: ActionStep,
  history: HistoryEntry[]
): string | null {
  for (const entry of history) {
    if (similarity(action.instruction, entry.instruction) >= REPEAT_THRESHOLD) {
      return `It closely repeats an earlier step: "${entry.instruction}"`
    }
  }
  const latest = history.at(-1)
  if (latest && latest.outcome !== "completed") {
    if (action.approach === latest.approach) {
      return `It reuses the "${latest.approach}" approach, which just did not work.`
    }
  }
  return null
}

const FALLBACK_STEPS: ActionStep[] = [
  {
    instruction:
      'Finish this sentence in your own words: "The moment I try to start, what happens is..."',
    why: "Naming the exact point where it stalls gives you something specific to work with.",
    inputLabel: "What happens",
    inputPlaceholder: "The moment I try to start...",
    minutes: 1,
    approach: "name-the-obstacle",
  },
  {
    instruction:
      "Write the smallest version of this you could do in one minute, even if it feels too small to count.",
    why: "A step that seems almost too small is often the one that can actually begin.",
    inputLabel: "One-minute version",
    inputPlaceholder: "In one minute I could...",
    minutes: 1,
    approach: "shrink-scope",
  },
  {
    instruction:
      "Type the first name of one person who could sit with you for ten minutes, or the word 'nobody'.",
    why: "Some tasks start more easily with someone else nearby. 'Nobody' is a fine answer too.",
    inputLabel: "A person",
    inputPlaceholder: "A name, or nobody",
    minutes: 1,
    approach: "ask-someone",
  },
  {
    instruction:
      "Write one sentence for future you: when would be a more realistic moment to come back to this?",
    why: "Stopping on purpose, with a note, is different from avoiding it.",
    inputLabel: "A note to future you",
    inputPlaceholder: "A better moment would be...",
    minutes: 1,
    approach: "decide",
  },
]

/** Returns a built-in step not yet tried, or null when all have been used. */
export function pickFallbackStep(history: HistoryEntry[]): ActionStep | null {
  return (
    FALLBACK_STEPS.find((step) => findRepeatReason(step, history) === null) ??
    null
  )
}
