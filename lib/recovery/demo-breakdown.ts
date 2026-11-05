import { similarity } from "@/lib/guards"
import { categorize } from "@/lib/recovery/categorize"
import { prepStepFor } from "@/lib/recovery/concrete"
import type {
  TaskBreakdownRequest,
  TaskBreakdownResult,
  TaskContext,
} from "@/lib/schemas"

/**
 * Pulls likely requirements out of pasted instructions with simple text rules:
 * list items, and sentences saying what must be done. It's not AI, so it can miss
 * things, and the interface says so.
 */
export function extractRequirements(text: string, limit = 6) {
  const clean = (line: string) =>
    line
      .replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
  const lines = text.split(/\r?\n/)
  const isListItem = (line: string) =>
    /^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+\S/i.test(line)
  const listed = lines.filter(isListItem).map(clean)
  // Sentences come only from prose, so a list isn't read back as one long line.
  const sentences = lines
    .filter((line) => !isListItem(line))
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+/))
    .filter((sentence) =>
      /\b(must|should|required|requirement|submit|include|due|deliverables?|graded|write|create|answer|complete|train|build|implement|design|analy[sz]e|discuss|explain|compare|report)\b/i.test(
        sentence
      )
    )
    .map(clean)
  const seen = new Set<string>()
  return [...listed, ...sentences]
    .filter((item) => {
      const key = item.toLowerCase()
      if (item.length < 8 || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((item) => (item.length > 160 ? `${item.slice(0, 157)}...` : item))
    .slice(0, limit)
}

function templateSteps(task: TaskContext, today: string): string[] {
  const { title, deadline } = task
  const missed = Boolean(deadline && deadline < today)
  const category = categorize(`${title} ${task.description}`)

  if (category === "academic" && missed) {
    return [
      "Search the syllabus for the late-work policy",
      "Write down what's finished and what's missing",
      "Draft a short message asking about late submission",
      "Finish the most important missing part",
      "Check it against the instructions",
      "Submit it, or record what you decided",
    ]
  }
  if (category === "academic") {
    return [
      "Paste the assignment instructions into this task",
      "List what you have to hand in",
      "Write a rough outline in your working document",
      "Complete the first section",
      "Check your work against the grading criteria",
      "Prepare the submission",
    ]
  }
  if (category === "job") {
    return [
      "Choose one company and role to apply to",
      "Save the job posting link and any closing date",
      "Update your résumé for this role",
      "Write a short cover note",
      "Submit the application",
      "Record it, and choose the next role",
    ]
  }
  if (category === "message") {
    return [
      "Open the message and note what it's asking",
      "Write a two-sentence reply in your working document",
      "Add any detail they need",
      "Send it",
    ]
  }
  if (category === "admin") {
    return [
      "Find where this gets done: website, office, or phone",
      "List the documents or details you'll need",
      "Gather the first item on that list",
      "Complete the form or make the call",
      "Save the confirmation",
    ]
  }
  return [
    `Write what “done” looks like for “${title}”`,
    "List everything you need to open or find",
    "Do the smallest piece",
    "Do the next piece",
    "Check it, and call it done",
  ]
}

/** Builds a breakdown from fixed templates and the user's own instructions. */
export function demoBreakdown(
  request: TaskBreakdownRequest
): TaskBreakdownResult {
  const { task, today, rejected } = request
  const requirements = extractRequirements(task.instructions)
  const stuck =
    task.obstacles.length > 0 ||
    task.attempts.length > 0 ||
    task.focusSessions.at(-1)?.outcome === "stuck"

  let steps = requirements.length
    ? [
        "Read through the instructions once",
        ...requirements,
        "Check your work against the instructions",
      ]
    : templateSteps(task, today)

  // Starting smaller is the point after something hasn't worked.
  if (stuck) {
    steps = ["Open your working document and write one rough line", ...steps]
  }
  if (rejected.length) {
    steps = [
      "Start with the part you already know how to do",
      ...steps.slice(1).reverse(),
    ]
  }

  // A big first task gets a smaller step in front of it.
  const firstBig = steps.findIndex((step) => prepStepFor(step))
  if (firstBig >= 0) {
    const prep = prepStepFor(steps[firstBig])!
    if (!steps.includes(prep)) steps.splice(firstBig, 0, prep)
  }

  const finished = task.completedActions.map((item) =>
    item.replace(/^Completed:\s*/, "")
  )
  steps = steps.filter(
    (step) => !finished.some((done) => similarity(step, done) >= 0.6)
  )

  const notes = [
    requirements.length
      ? "These steps were pulled from your instructions with simple text rules, so check that nothing is missing."
      : "",
    finished.length
      ? `Your ${finished.length} finished steps stay as they are.`
      : "",
  ]

  return {
    note: notes.filter(Boolean).join(" "),
    steps: steps.slice(0, 9),
    ambiguities: [],
  }
}
