import type { WorkspaceSetupResult } from "@/lib/schemas"

export const REQUIREMENTS_HEADING = "What’s being asked"
export const QUESTIONS_HEADING = "Questions to answer"
export const OUTLINE_HEADING = "Outline"

type Parts = Pick<
  WorkspaceSetupResult,
  | "deliverables"
  | "questions"
  | "outline"
  | "firstSection"
  | "starter"
  | "firstAction"
>

/** The prepared document: structure to edit, not finished work or research. */
export function preparedDocument(parts: Parts) {
  const blocks = [
    `## ${REQUIREMENTS_HEADING}`,
    (parts.deliverables.length
      ? parts.deliverables
      : ["[What has to be handed in? Check the assignment.]"]
    )
      .map((item) => `- [ ] ${item}`)
      .join("\n"),
  ]
  if (parts.questions.length) {
    blocks.push(
      `## ${QUESTIONS_HEADING}`,
      parts.questions.map((item) => `- ${item} [your answer]`).join("\n")
    )
  }
  if (parts.outline.length) {
    blocks.push(
      `## ${OUTLINE_HEADING}`,
      parts.outline.map((item) => `- ${item}`).join("\n")
    )
  }
  blocks.push(`## ${parts.firstSection.title}`, parts.firstSection.content)
  if (parts.starter.kind === "code") {
    blocks.push(`## ${parts.starter.title}`, parts.starter.content)
  }
  return blocks.join("\n\n")
}

export type EntryPoint = { label: string; heading: string; nextAction: string }

/** The ways into a prepared document. Picking one puts the cursor there. */
export function entryPoints(parts: Parts): EntryPoint[] {
  const entries: EntryPoint[] = []
  if (parts.starter.kind === "code") {
    entries.push({
      label: "Start from the code",
      heading: parts.starter.title,
      nextAction: parts.firstAction,
    })
  }
  entries.push({
    label: "Edit the first section",
    heading: parts.firstSection.title,
    nextAction: `Edit the first section: ${parts.firstSection.title}`,
  })
  if (parts.questions.length) {
    entries.push({
      label: "Answer a question",
      heading: QUESTIONS_HEADING,
      nextAction: `Answer: ${parts.questions[0]}`,
    })
  }
  if (parts.outline.length) {
    entries.push({
      label: "Fill in the outline",
      heading: OUTLINE_HEADING,
      nextAction: `Fill in the outline, starting with: ${parts.outline[0]}`,
    })
  }
  return entries
}
