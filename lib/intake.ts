import { IntakeSchema, LIMITS } from "@/lib/schemas"
import type {
  Analysis,
  Intake,
  ObstacleChoice,
  StatusChoice,
} from "@/lib/schemas"

export const STATUS_LABEL: Record<StatusChoice, string> = {
  "not-started": "Haven’t started",
  "started-stopped": "Started, then stopped",
  "missed-deadline": "Missed the deadline",
  unsure: "Not sure where things stand",
}

export const OBSTACLE_LABEL: Record<ObstacleChoice, string> = {
  overwhelming: "It feels overwhelming",
  "where-to-start": "I don’t know where to start",
  "worried-outcome": "I’m worried about the outcome",
  "no-energy": "I don’t have the energy",
  unsure: "I’m not sure",
  "something-else": "Something else",
}

export const EMPTY_INTAKE: Intake = {
  responsibility: "",
  deadline: null,
  status: null,
  obstacle: null,
  obstacleOther: "",
  legacyNotes: "",
}

/**
 * Formats a stored YYYY-MM-DD date. The date is read and printed in UTC, so it
 * is the same calendar day in every time zone.
 */
export function formatDeadlineDate(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/** The user's answers in words. `null` means the question was not answered. */
export function describeDetails(intake: Intake) {
  const { deadline, status, obstacle, obstacleOther } = intake
  let obstacleText = obstacle && OBSTACLE_LABEL[obstacle]
  if (obstacle === "something-else" && obstacleOther) {
    obstacleText = `Something else: ${obstacleOther}`
  }
  return {
    deadline: !deadline
      ? null
      : deadline.type === "date"
        ? formatDeadlineDate(deadline.date)
        : deadline.type === "none"
          ? "No deadline"
          : "I’m not sure",
    status: status && STATUS_LABEL[status],
    obstacle: obstacleText,
  }
}

const MENTIONS_DEADLINE = /deadline|closing date|due date|\bdue\b/i

/**
 * Adds the user's explicit answers to the Reality Check, in both Live AI and
 * Demo Mode. Only real answers become facts. "Not sure" answers and a missing
 * deadline become unknowns, and other skipped questions add nothing.
 */
export function applyIntakeDetails(
  analysis: Analysis,
  intake: Intake
): Analysis {
  const known: string[] = []
  const unknown: string[] = []
  const { deadline, status, obstacle, obstacleOther, legacyNotes } = intake

  if (deadline?.type === "date") {
    known.push(`Your deadline: ${formatDeadlineDate(deadline.date)}.`)
  } else if (deadline?.type === "none") {
    known.push("You said there is no deadline.")
  } else if (deadline?.type === "unsure") {
    unknown.push("What the deadline is. You said you’re not sure.")
  }

  if (status === "unsure") {
    unknown.push("Where things currently stand. You said you’re not sure.")
  } else if (status) {
    known.push(`Current status you chose: ${STATUS_LABEL[status]}.`)
  }

  if (obstacle === "unsure") {
    unknown.push("What is getting in the way most. You said you’re not sure.")
  } else if (obstacle === "something-else") {
    if (obstacleOther) {
      known.push(`Main obstacle, in your words: "${obstacleOther}"`)
    } else {
      unknown.push(
        "What the main obstacle is. You chose “Something else” without details."
      )
    }
  } else if (obstacle) {
    known.push(`Main obstacle you chose: ${OBSTACLE_LABEL[obstacle]}.`)
  }

  if (legacyNotes) {
    known.push(
      `Details you gave earlier: ${legacyNotes}`.slice(0, LIMITS.listItem)
    )
  }

  const reality = analysis.realityCheck
  let unknowns = reality.unknowns

  if (deadline?.type === "date" || deadline?.type === "none") {
    // An explicit answer settles the question, so don't also list it as unknown.
    const remaining = unknowns.filter((item) => !MENTIONS_DEADLINE.test(item))
    if (remaining.length || unknown.length) unknowns = remaining
  } else if (!deadline) {
    const stated = [...known, ...reality.knownFacts, ...unknowns].join(" ")
    if (!MENTIONS_DEADLINE.test(stated)) {
      unknown.push("The exact deadline, if there is one.")
    }
  }

  return {
    ...analysis,
    realityCheck: {
      ...reality,
      knownFacts: [...known, ...reality.knownFacts],
      unknowns: [...unknown, ...unknowns],
    },
  }
}

function legacyText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Reads an intake saved by any version of the app. Older versions stored the
 * deadline, status and obstacle as free text. That text can't be mapped to the
 * new options without guessing, so it's kept in the user's own words instead.
 */
export function migrateIntake(raw: unknown): Intake {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >
  const shape = IntakeSchema.shape
  const deadline = shape.deadline.safeParse(data.deadline).data ?? null
  const status = shape.status.safeParse(data.status).data ?? null

  const notes = [legacyText(data.legacyNotes)]
  if (typeof data.deadline === "string" && data.deadline.trim()) {
    notes.push(`Original deadline: ${data.deadline.trim()}.`)
  }
  if (!status && legacyText(data.status)) {
    notes.push(`Current status: ${legacyText(data.status)}.`)
  }

  let obstacle = shape.obstacle.safeParse(data.obstacle).data ?? null
  let obstacleOther = legacyText(data.obstacleOther)
  if (!obstacle && legacyText(data.obstacle)) {
    obstacle = "something-else"
    obstacleOther = legacyText(data.obstacle)
  }

  return {
    responsibility: legacyText(data.responsibility),
    deadline,
    status,
    obstacle,
    obstacleOther: obstacleOther.slice(0, LIMITS.detail),
    legacyNotes: notes.filter(Boolean).join(" ").slice(0, LIMITS.legacyNotes),
  }
}
