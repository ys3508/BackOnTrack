import { categorize } from "@/lib/recovery/demo-plan"
import { extractRequirements } from "@/lib/recovery/demo-breakdown"
import type {
  WritingAction,
  WritingAssistRequest,
  WritingAssistResult,
} from "@/lib/schemas"

const DEMO_NOTE =
  "Demo Mode: a fixed template filled in from your task, not AI."

function outline(request: WritingAssistRequest): WritingAssistResult {
  const { task } = request
  const requirements = extractRequirements(task.instructions, 8)
  if (requirements.length) {
    return {
      title: "Outline from your instructions",
      note: "Demo Mode: pulled from your instructions with simple text rules, not AI. Check that nothing is missing.",
      content: [
        `# ${task.title}`,
        "",
        ...requirements.flatMap((item) => [`## ${item}`, "- [your notes]", ""]),
      ]
        .join("\n")
        .trim(),
    }
  }
  const sections: Record<ReturnType<typeof categorize>, string[]> = {
    academic: [
      "What the assignment asks",
      "My approach",
      "Main work",
      "What to check before submitting",
    ],
    job: [
      "The role",
      "Why I fit",
      "One example from my experience",
      "What's still needed",
    ],
    message: ["What they asked", "My answer", "What happens next"],
    admin: ["What's required", "What I have", "What's missing", "Who to ask"],
    general: [
      "What done looks like",
      "First piece",
      "Next piece",
      "Open questions",
    ],
  }
  return {
    title: "A starting outline",
    note: DEMO_NOTE,
    content: [
      `# ${task.title}`,
      "",
      ...sections[categorize(`${task.title} ${task.description}`)].flatMap(
        (heading) => [`## ${heading}`, "- [your notes]", ""]
      ),
    ]
      .join("\n")
      .trim(),
  }
}

function explain(request: WritingAssistRequest): WritingAssistResult {
  const { selection, task } = request
  const words = selection
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 4)
  const related = task.instructions
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) =>
      words.some((word) => sentence.toLowerCase().includes(word))
    )
    .slice(0, 3)
  return {
    title: "Related lines from your instructions",
    note: "Demo Mode can’t explain text. Live AI can. This only finds lines in your instructions that share words with your selection.",
    content: related.length
      ? related.map((line) => `- ${line}`).join("\n")
      : "No related lines were found in your instructions. Questions to bring to whoever set this:\n\n- What would a good answer to this look like?\n- [your question]",
  }
}

function starter(request: WritingAssistRequest): WritingAssistResult {
  const { task } = request
  const topic = task.currentStep || task.title
  return {
    title: "Three ways to start",
    note: `${DEMO_NOTE} Fill in the brackets, and change anything.`,
    content: [
      `1. This section covers ${topic}, and focuses on [the main point you want to make].`,
      `2. The main question here is [your question]. To answer it, I [what you did or will do].`,
      `3. [One specific fact or example you already know] shows why ${topic} needs [what it needs].`,
    ].join("\n"),
  }
}

function split(request: WritingAssistRequest): WritingAssistResult {
  const target =
    request.selection.trim() || request.task.currentStep || request.task.title
  const short = target.length > 80 ? `${target.slice(0, 77)}...` : target
  return {
    title: "Smaller steps",
    note: DEMO_NOTE,
    content: [
      `- [ ] Write down what “${short}” has to include`,
      "- [ ] Add a rough first line for each part",
      "- [ ] Fill in the part you know best",
      "- [ ] Read it through once, and mark what's missing",
    ].join("\n"),
  }
}

function summarize(request: WritingAssistRequest): WritingAssistResult {
  const text = request.source.trim() || request.task.instructions.trim()
  const lines = extractRequirements(text, 6)
  const fallback = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 4)
  const picked = lines.length ? lines : fallback
  return {
    title: "Key lines from the source",
    note: "Demo Mode: these are lines copied from your text by simple rules. It isn’t a real summary, and may miss things.",
    content: picked.length
      ? picked.map((line) => `- ${line}`).join("\n")
      : "There’s no text to summarize yet. Paste some source material first.",
  }
}

function improve(request: WritingAssistRequest): WritingAssistResult {
  const tidied = request.selection
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(
      /(^|[.!?]\s+)([a-z])/g,
      (_, start, letter) => `${start}${letter.toUpperCase()}`
    )
    .trim()
  return {
    title: "Tidied text",
    note: "Demo Mode only fixes spacing and capital letters. Live AI can improve clarity.",
    content: tidied,
  }
}

const HANDLERS: Record<
  WritingAction,
  (request: WritingAssistRequest) => WritingAssistResult
> = { outline, explain, starter, split, summarize, improve }

export function demoWritingAssist(
  request: WritingAssistRequest
): WritingAssistResult {
  return HANDLERS[request.action](request)
}
