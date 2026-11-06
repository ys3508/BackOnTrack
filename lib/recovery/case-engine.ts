/**
 * The deterministic side of a recovery case. Demo Mode uses it for every
 * suggestion, and Live AI falls back on it. These are wording rules and
 * templates, so they can be wrong, and the interface says they aren't AI. Nothing
 * here may state a policy, deadline, or consequence the user didn't give.
 */
import { isHighStakesText, similarity } from "@/lib/guards"
import type {
  Blocker,
  RealityCheckAnswers,
  RealityGap,
  RecoveryCase,
  RecoveryPath,
  StuckReason,
  Task,
} from "@/lib/workspace/schemas"

/* ---------- Reading what the user wrote ---------- */

/** Words that say this is more than a simple errand. */
const SOMETHING_HARDER =
  /\b(can'?t|cannot|couldn'?t|won'?t|avoid\w*|afraid|worried|scared|anxious|nervous|fear\w*|stuck|behind|missed|overdue|late|deadline|haven'?t|hasn'?t|didn'?t|keep|putting off|put off|procrastinat\w*|supposed to|mess|overwhelm\w*|important|weeks?|months?|years?|consequences?|fail\w*|don'?t know|no idea|difficult|hard|struggl\w*)\b/i

const ERRAND_VERB =
  /^(please\s+)?(buy|get|grab|pick up|drop off|order|return|take out|water|feed|charge|print|post|mail|book|text|call|email|pay|wash|make|cook|send|renew|refill|find)\b/i

const NORMALIZE = (text: string) => text.replace(/[’‘]/g, "'").trim()

/** A short, ordinary errand doesn't need a recovery workflow. */
export function isSimpleErrand(text: string) {
  const value = NORMALIZE(text)
  const words = value.split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 6) return false
  if (SOMETHING_HARDER.test(value) || isHighStakesText(value)) return false
  return ERRAND_VERB.test(value)
}

const WORRIED =
  /\b(afraid|worried|worry|scared|terrified|anxious|nervous|fear\w*|consequences?|fail me|get fired|be fired|in trouble|what if|angry at me|mad at me|kick\w* me out)\b/i
const BEHIND =
  /\b(behind|missed|overdue|supposed to|was going to|meant to|planned to|plan (didn'?t|did not|fell|failed)|fell through|too late|past due)\b/i
const LOST =
  /\b(don'?t know (where|how|what)|no idea|where (to|do i) (begin|start)|a mess|so much|too much|overwhelm\w*|everything|complicated)\b/i
const CANT_START =
  /\b(can'?t (get myself to |make myself |seem to |bring myself to )?(start|begin|do it)|can'?t get myself|can'?t make myself|can'?t bring myself|keep (avoiding|putting|delaying|procrastinating)|avoiding|putting (it )?off|procrastinat\w*)\b/i

/** A suggestion only. The user always confirms or changes it. */
export function suggestBlocker(text: string): Blocker | null {
  const value = NORMALIZE(text)
  if (WORRIED.test(value)) return "worried"
  if (BEHIND.test(value)) return "behind"
  if (LOST.test(value)) return "dont-know-start"
  if (CANT_START.test(value)) return "cant-start"
  return null
}

const capitalize = (text: string) =>
  text ? text[0].toUpperCase() + text.slice(1) : text

const LEAD_INS =
  /^(i('m| am) (trying|supposed|meant) to|i was (supposed|meant|going) to|i (really )?(need|have|want|ought|planned|meant) to|i should( really)?|i must|i've got to|i have been putting off|i've been putting off|i've been avoiding|i keep avoiding|i keep putting off|i'm avoiding|i am avoiding)\s+/i
const TRAILING_TIME =
  /\s+(yesterday|today|tonight|last (night|week|month)|this (morning|week|month)|for (days|weeks|months)|in (days|weeks|months|ages))$/i
/** Text that describes the difficulty only, with no responsibility named. */
const ONLY_THE_BLOCK =
  /^(i know what (to do|i need to do)|i can'?t (start|begin|do (it|this))|i don'?t know (where to (start|begin)|what to do)|i just can'?t|i'?m stuck)\b/i

export function namesNoResponsibility(text: string) {
  const value = NORMALIZE(text)
  const first = value.split(/(?<=[.!?])\s+/)[0]
  return (
    ONLY_THE_BLOCK.test(first) && !/\b(essay|call|email|clean)\b/i.test(value)
  )
}

export function deriveTitle(text: string) {
  const value = NORMALIZE(text)
  if (namesNoResponsibility(value))
    return "Something I’ve been struggling to start"
  const first = value.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "")
  const clause = first.split(
    /,\s+(?:but|and|so|because)\b|\s+(?:but|because|so)\s+|\s+and\s+i('|\s)|,\s*$/i
  )[0]
  const title = capitalize(
    clause.replace(LEAD_INS, "").replace(TRAILING_TIME, "").trim()
  )
  return (
    title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title
  ).replace(/\s+/g, " ")
}

/* ---------- Topics ---------- */

export type Topic =
  "clean" | "exercise" | "contact" | "school" | "job" | "money" | "general"

export function topicOf(text: string): Topic {
  const value = NORMALIZE(text).toLowerCase()
  if (
    /\b(assignment|homework|essay|paper|thesis|exam|midterm|quiz|class|course|professor|teacher|syllabus|lab report|study)\b/.test(
      value
    )
  ) {
    return "school"
  }
  if (
    /\b(clean\w*|tidy\w*|mess|messy|dishes|laundry|apartment|room|kitchen|garage|declutter\w*|vacuum\w*)\b/.test(
      value
    )
  ) {
    return "clean"
  }
  if (
    /\b(exercis\w*|workout|work out|gym|run|running|jog\w*|yoga|walk)\b/.test(
      value
    )
  ) {
    return "exercise"
  }
  if (
    /\b(job|resume|résumé|cover letter|interview|boss|manager|work project)\b/.test(
      value
    )
  ) {
    return "job"
  }
  if (
    /\b(tax(es)?|bills?|rent|loans?|debts?|insurance|bank|forms?|paperwork|visa)\b/.test(
      value
    )
  ) {
    return "money"
  }
  if (
    /\b(call|phone|email|e-mail|message|reply|respond|text back|apologi[sz]e)\b/.test(
      value
    )
  ) {
    return "contact"
  }
  return "general"
}

type Ladder = {
  /** One-step breakdown, from the first thing to the later ones. */
  steps: string[]
  /** The lowest-effort ways in, for when starting is the hard part. */
  micro: string[]
}

function ladderFor(topic: Topic, title: string): Ladder {
  const named = `“${title}”`
  switch (topic) {
    case "clean":
      return {
        steps: [
          "Choose one small area, such as your desk or kitchen counter.",
          "Throw away only the trash from that area.",
          "Put away five things from that area.",
          "Wipe that one surface.",
          "Pick the next small area, or stop here.",
        ],
        micro: [
          "Pick up one piece of trash and throw it away.",
          "Get a trash bag and put it in the room.",
          "Stand in the room and put one thing where it belongs.",
        ],
      }
    case "exercise":
      return {
        steps: [
          "Choose the easiest kind of movement you’d accept today.",
          "Get your shoes and clothes out.",
          "Do five minutes of it, then decide whether to go on.",
        ],
        micro: [
          "Put on your workout shoes.",
          "Fill a water bottle and put it by the door.",
          "Stand up and stretch for 30 seconds.",
        ],
      }
    case "contact":
      return {
        steps: [
          "Find the phone number or address you need, and put it here in your notes.",
          "Write the one thing you need to say, in one sentence.",
          "Send the message, or make the call.",
        ],
        micro: [
          "Open your phone or email to the person you need to reach. Don’t send anything yet.",
          "Write only their name at the top of a blank message.",
          "Write the first sentence you’d say, in your notes.",
        ],
      }
    case "school":
      return {
        steps: [
          "Find the instructions and open them, even if you don’t read them yet.",
          "Copy what’s being asked for into your notes.",
          "Write a rough first line, or the first thing you’d need to find out.",
          "Work on just that part for ten minutes.",
        ],
        micro: [
          "Open the document or course page, and do nothing else.",
          "Write the title at the top of a blank page.",
          "Write one bad sentence about it. It can be deleted later.",
        ],
      }
    case "job":
      return {
        steps: [
          "Open the one document or message this depends on.",
          "Write down the next thing it needs, in one sentence.",
          "Work on only that for ten minutes.",
        ],
        micro: [
          "Open the file or message, and do nothing else.",
          "Write one rough line in your notes about what it needs.",
          "Put the one thing you need in front of you.",
        ],
      }
    case "money":
      return {
        steps: [
          "Find the letter, form, or account page this is about.",
          "Write down what it’s asking for, in your own words.",
          "Do the first line of it, or write down who could answer your question.",
        ],
        micro: [
          "Find the letter, form, or login page, and just put it in front of you.",
          "Open the envelope or page. You don’t need to read it all.",
          "Write down one number or date from it in your notes.",
        ],
      }
    default:
      return {
        steps: [
          `Write down the smallest part of ${named} you can see from here.`,
          "Gather the one thing you’d need for that part.",
          "Work on just that part for ten minutes.",
          "Write down what’s left, in one line.",
        ],
        micro: [
          `Put the one thing you’d need for ${named} in front of you.`,
          `Write one rough sentence about ${named} in your notes.`,
          `Set a 2-minute timer and only look at ${named}.`,
        ],
      }
  }
}

/** Ways to shrink any step, for when its own ladder has run out. */
const SHRINK = [
  "Do only the first minute of it, then stop if you want to.",
  "Just get what you’d need for it, and put it where you can see it.",
  "Write one line in your notes saying what the very first movement would be.",
]

/* ---------- Plans ---------- */

export type CasePlan = {
  action: { text: string; why: string } | null
  queue: string[]
  alternatives: string[]
  realityGap?: RealityGap
  messageDraft?: string
  missingDetail: string
  note: string
  openTools?: ("reality-gap" | "paths")[]
  /** True when there's nothing better to offer, so the current step stays. */
  keepCurrent?: boolean
  /** True when this only swaps the current step, so later steps still stand. */
  keepQueue?: boolean
  source: "live" | "demo"
  usedFallback?: boolean
  /** The text described a safety crisis, so the normal workflow stops. */
  supportConcern?: boolean
  /** Only from understanding the first message. */
  title?: string
  suggestedBlocker?: Blocker | null
}

export type CaseContext = {
  originalInput: string
  title: string
  blocker: Blocker | null
  path: RecoveryPath | null
  completed: string[]
  /** Everything already suggested, so nothing is repeated. */
  tried: string[]
  realityGap: RealityGap | null
  realityCheck: RealityCheckAnswers | null
}

const REPEAT = 0.6
const isRepeat = (text: string, seen: string[]) =>
  seen.some(
    (item) =>
      item.trim().toLowerCase() === text.trim().toLowerCase() ||
      similarity(item, text) >= REPEAT
  )

const unseen = (items: string[], seen: string[]) => {
  const kept: string[] = []
  for (const item of items) {
    if (!isRepeat(item, [...seen, ...kept])) kept.push(item)
  }
  return kept
}

const knownText = (context: CaseContext) => [
  ...context.completed,
  ...context.tried,
]

const WORRY_CLAUSE =
  /\b(afraid|worried|worry|scared|terrified|anxious|nervous|fear\w*|what if|might|may|could|probably|consequences?)\b/i
const WORRY_LEAD =
  /^(and\s+)?(i'?m|i am|i feel|i)\s*(so |really |very )?(afraid|worried|scared|terrified|anxious|nervous)( that| about| of)?\s*/i

function splitClauses(text: string) {
  return NORMALIZE(text)
    .split(/(?<=[.!?])\s+|,?\s+(?:and|but)\s+(?=i\b|i'|my\b|the\b)/i)
    .map((part) => part.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean)
}

const contactNeeded = (text: string) =>
  /\b(professor|teacher|boss|manager|landlord|doctor|client|lawyer|advisor|adviser|office|call|email|phone|tell|ask|message)\b/i.test(
    text
  )

function unknownsFor(topic: Topic, text: string) {
  const person = text.match(
    /\b(professor|teacher|boss|manager|landlord|doctor|client|advisor|adviser)\b/i
  )?.[0]
  if (topic === "school") {
    return [
      "Whether late submissions or partial credit are still allowed.",
      `What ${person ? `my ${person.toLowerCase()}` : "the instructor"} would actually do. I haven’t asked yet.`,
    ]
  }
  if (topic === "money") {
    return [
      "What the actual deadline or penalty is, in writing.",
      "Whether there’s an extension, payment plan, or someone I could ask.",
    ]
  }
  if (topic === "job") {
    return [
      `What ${person ? `my ${person.toLowerCase()}` : "the other person"} actually expects now.`,
      "Whether the date or the scope can still change.",
    ]
  }
  return [
    "What would actually happen next. I’m guessing right now.",
    "Who could tell me for sure.",
  ]
}

function optionsFor(topic: Topic, text: string) {
  const person = text.match(
    /\b(professor|teacher|boss|manager|landlord|doctor|client|advisor|adviser)\b/i
  )?.[0]
  if (topic === "school") {
    return [
      "Check the course policy or syllabus for what it says about late work.",
      `Contact ${person ? `the ${person.toLowerCase()}` : "the instructor"} and ask what’s still possible.`,
    ]
  }
  if (topic === "money") {
    return [
      "Find the letter or page, and write down what date and amount it really says.",
      "Contact the office or company and ask what your options are.",
    ]
  }
  if (person) {
    return [
      `Write down the one question you’d want to ask the ${person.toLowerCase()}.`,
      `Contact the ${person.toLowerCase()} and ask what’s still possible.`,
    ]
  }
  return [
    "Write down the one question that would settle most of this.",
    "Find one person or place that could answer it.",
  ]
}

/** Sorts the user's own sentences. Nothing is added to what they call known. */
export function draftRealityGap(text: string): RealityGap {
  const topic = topicOf(text)
  const known: string[] = []
  const worried: string[] = []
  for (const clause of splitClauses(text)) {
    if (WORRY_CLAUSE.test(clause)) {
      const cleaned = clause
        .replace(WORRY_LEAD, "")
        .replace(/\bwill\b/gi, "might")
        .replace(/\bwould\b/gi, "might")
        .trim()
      // "I'm afraid of the consequences" still says what's feared.
      worried.push(capitalize(cleaned || clause))
    } else {
      known.push(capitalize(clause))
    }
  }
  return {
    known,
    worried,
    unknown: unknownsFor(topic, text),
    can: optionsFor(topic, text),
  }
}

export function messageDraftFor(title: string, text: string) {
  const person = text.match(
    /\b(professor|teacher|boss|manager|landlord|doctor|client|advisor|adviser)\b/i
  )?.[0]
  const greeting = person
    ? `Hi [${person.toLowerCase()}’s name],`
    : "Hi [name],"
  return `${greeting}\n\nI’m writing about this: ${title.toLowerCase()}. I know I’m behind on it. Could you tell me what’s still possible, and what you’d need from me?\n\n[Add anything true that would help them answer.]\n\nThank you,\n[Your name]`
}

export function shouldOfferMessage(
  recovery: Pick<RecoveryCase, "originalInput">
) {
  return contactNeeded(recovery.originalInput)
}

const PATH_LABEL: Record<RecoveryPath, string> = {
  finish: "Finish",
  reduce: "Reduce",
  release: "Release",
}

export function pathLabel(path: RecoveryPath) {
  return PATH_LABEL[path]
}

export function isConsequential(text: string) {
  return (
    isHighStakesText(text) ||
    /\b(boss|manager|job|work|employer|client|landlord|court|fine|penalty|deadline)\b/i.test(
      text
    )
  )
}

/** What's honestly known about the choice. No option is presented as equal. */
export function pathGuidance(
  text: string,
  answers: RealityCheckAnswers | null
): string {
  if (answers?.opportunity === "no") {
    return "You said there’s no real chance left to do this as planned. Finish may not be possible, so Reduce or Release are probably closer to the truth."
  }
  if (isConsequential(text)) {
    return "This may have consequences that BackOnTrack can’t see. Finish or Reduce keep more options open until you know what stopping would mean."
  }
  if (answers?.opportunity === "unsure") {
    return "You’re not sure whether there’s still time. Reduce keeps the most valuable part while you find out."
  }
  return "Reduce is often the most realistic, because it keeps what matters most. This is your call."
}

export const RELEASE_CAUTION =
  "This may involve a legal, financial, academic, or work obligation. BackOnTrack doesn’t know the actual rules, or what stopping would cost. It could close options you can’t get back. Before you release it, check with the person or office responsible."

function pathPlan(context: CaseContext): CasePlan {
  const { title, path, originalInput } = context
  const seen = knownText(context)
  const lower = title.charAt(0).toLowerCase() + title.slice(1)
  const options: Record<RecoveryPath, { steps: string[]; why: string }> = {
    finish: {
      steps: [
        `Write down exactly what’s left for “${title}”, in one or two lines.`,
        "Choose the very next piece, and work on only that for ten minutes.",
        "Write down what’s left now.",
      ],
      why: "You chose to keep going. This shows what’s really left before you spend more time on it.",
    },
    reduce: {
      steps: [
        `Write the smallest version of “${title}” that would still count.`,
        "Cross out everything else for now, in your notes.",
        "Work on the smallest version for ten minutes.",
      ],
      why: "You chose a smaller goal. Naming it first keeps the part that matters most.",
    },
    release: {
      steps: isConsequential(originalInput)
        ? [
            `Ask the person or office responsible what would happen if you stop ${lower}.`,
            "Write down what they said in your notes.",
            "Decide again, now that you know.",
          ]
        : [
            `Write one line about why you’re letting go of “${title}”.`,
            "Tell anyone who’s expecting it, if anyone is.",
          ],
      why: isConsequential(originalInput)
        ? "You’re considering stopping. First, this finds out what that would really mean."
        : "Letting go on purpose is different from avoiding it. One line makes it a decision.",
    },
  }
  const chosen = path ?? "reduce"
  const steps = unseen(options[chosen].steps, seen)
  const shrink = unseen(SHRINK, seen)
  return {
    action: steps[0]
      ? { text: steps[0], why: options[chosen].why }
      : { text: shrink[0] ?? "Write your own next step.", why: "" },
    queue: steps.slice(1),
    alternatives: shrink.slice(1),
    missingDetail: "",
    note: "",
    source: "demo",
  }
}

/** The first plan for a blocker, or the next one after it changes. */
export function demoInitialPlan(context: CaseContext): CasePlan {
  const { originalInput, title, blocker } = context
  const topic = topicOf(`${title} ${originalInput}`)
  const ladder = ladderFor(topic, title)
  const seen = knownText(context)
  const missingDetail = namesNoResponsibility(originalInput)
    ? "What is the thing you can’t start? A few words will make the next step more specific."
    : /\b(several|many|lots of|a lot of|everything)\b.*\b(responsibilit\w+|things|tasks|stuff)\b/i.test(
          originalInput
        )
      ? "Which one is weighing on you most? A few words are enough."
      : topic === "general" && originalInput.trim().split(/\s+/).length < 3
        ? "These suggestions are general because BackOnTrack doesn’t know much yet. What does this involve?"
        : ""
  const base = { missingDetail, note: "", source: "demo" as const }

  if (blocker === "dont-know-start") {
    const steps = unseen(ladder.steps, seen)
    return {
      ...base,
      action: steps[0]
        ? {
            text: steps[0],
            why: "You don’t need the whole plan. This is only the first thing.",
          }
        : null,
      queue: steps.slice(1),
      alternatives: unseen(ladder.micro, seen),
    }
  }
  if (blocker === "cant-start") {
    const micro = unseen(ladder.micro, seen)
    return {
      ...base,
      action: micro[0]
        ? {
            text: micro[0],
            why: "It’s small on purpose. It only has to begin.",
          }
        : null,
      queue: unseen(ladder.steps, [...seen, ...micro]).slice(0, 2),
      alternatives: micro.slice(1),
    }
  }
  if (blocker === "worried") {
    const gap = context.realityGap ?? draftRealityGap(originalInput)
    const options = unseen(gap.can, seen)
    return {
      ...base,
      realityGap: context.realityGap ? undefined : gap,
      messageDraft: contactNeeded(originalInput)
        ? messageDraftFor(title, originalInput)
        : undefined,
      action: options[0]
        ? {
            text: options[0],
            why: "This turns one guess into something you actually know.",
          }
        : null,
      queue: [],
      alternatives: options.slice(1),
    }
  }
  if (blocker === "behind") {
    if (context.path) return { ...pathPlan(context), missingDetail }
    return { ...base, action: null, queue: [], alternatives: [] }
  }
  return { ...base, action: null, queue: [], alternatives: [] }
}

export function demoPathPlan(context: CaseContext): CasePlan {
  return pathPlan(context)
}

/** A smaller version of the step, never one already offered. */
export function demoSmaller(context: CaseContext, current: string): CasePlan {
  const topic = topicOf(`${context.title} ${context.originalInput}`)
  const { micro } = ladderFor(topic, context.title)
  const seen = [...knownText(context), current]
  const options = unseen([...micro, ...SHRINK], seen)
  return {
    action: options[0]
      ? { text: options[0], why: "A smaller way in. It still counts." }
      : null,
    queue: [],
    alternatives: options.slice(1),
    missingDetail: options[0]
      ? ""
      : "BackOnTrack is out of built-in ways to make this smaller. What would feel possible in one minute?",
    note: options[0] ? "Made it smaller." : "",
    keepCurrent: !options[0],
    source: "demo",
  }
}

export type StuckInput = { reason: StuckReason; detail: string }

/** Plan B. Each answer changes the approach, and earlier work stays put. */
export function demoPlanB(
  context: CaseContext,
  current: string,
  { reason, detail }: StuckInput
): CasePlan {
  const seen = [...knownText(context), current]
  const topic = topicOf(`${context.title} ${context.originalInput}`)
  const { micro } = ladderFor(topic, context.title)
  const base = {
    queue: [],
    alternatives: [] as string[],
    missingDetail: "",
    source: "demo" as const,
  }
  const trimmed = detail.trim()

  if (reason === "too-big") {
    return {
      ...demoSmaller(context, current),
      note: "That step was too big, so this one is smaller.",
    }
  }

  if (reason === "dont-know-how") {
    const options = unseen(
      [
        trimmed
          ? `Find one place that could explain this: ${trimmed}`
          : "Write down the one thing you’d need to know to do this, as a question.",
        "Find one person or page that could answer that question.",
        "Look for one example of this that someone else has done.",
      ],
      seen
    )
    return {
      ...base,
      action: options[0]
        ? {
            text: options[0],
            why: "The missing piece is information, so the next step is finding it.",
          }
        : null,
      alternatives: options.slice(1),
      keepCurrent: !options[0],
      note: "You need information more than effort, so this finds out what’s missing.",
      missingDetail: options[0]
        ? ""
        : "BackOnTrack is out of built-in suggestions here. What’s the part you don’t know?",
    }
  }

  if (reason === "worried") {
    const gap = context.realityGap ?? draftRealityGap(context.originalInput)
    const options = unseen(
      [
        "In “What I’m worried about”, write down the outcome you’re picturing.",
        ...gap.can,
      ],
      seen
    )
    return {
      ...base,
      realityGap: context.realityGap ? undefined : gap,
      messageDraft: contactNeeded(context.originalInput)
        ? messageDraftFor(context.title, context.originalInput)
        : undefined,
      action: options[0]
        ? {
            text: options[0],
            why: "Separating what you know from what you fear makes it easier to judge.",
          }
        : null,
      alternatives: options.slice(1),
      keepCurrent: !options[0],
      openTools: ["reality-gap"],
      note: "Worry is in the way, so Reality Gap is open below. Your earlier work is still here.",
    }
  }

  if (reason === "low-energy") {
    const options = unseen(
      [
        ...micro,
        "Write one line in your notes saying where to pick this up next time.",
        ...SHRINK,
      ],
      seen
    )
    return {
      ...base,
      action: options[0]
        ? {
            text: options[0],
            why: "This takes very little. Stopping here on purpose is also fine.",
          }
        : null,
      alternatives: options.slice(1),
      keepCurrent: !options[0],
      note: "With little time or energy, this is the lowest-effort step. You can also pause on purpose.",
    }
  }

  if (
    reason === "not-viable" ||
    /\b(no longer|too late|won'?t work|not possible|impossible|can'?t anymore)\b/i.test(
      NORMALIZE(trimmed)
    )
  ) {
    return {
      ...base,
      action: null,
      openTools: ["paths"],
      note: "The original plan may not hold anymore, so choose how you want to handle this: Finish, Reduce, or Release.",
    }
  }

  // "Something else": the honest answer is that a template can't know enough.
  const options = unseen(
    [
      trimmed
        ? `Write one line about what you could do despite this: ${trimmed}`
        : "Write one line saying what got in the way.",
      ...SHRINK,
    ],
    seen
  )
  return {
    ...base,
    action: options[0]
      ? { text: options[0], why: "This keeps your reason in view." }
      : null,
    alternatives: options.slice(1),
    keepCurrent: !options[0],
    note: "BackOnTrack can’t work out much from a template here, so you may have a better next step than this. You can edit it.",
  }
}

/** Another way in without asking anything. Says so when it has run out. */
export function demoAnother(
  context: CaseContext,
  current: string,
  alternatives: string[]
): CasePlan {
  const topic = topicOf(`${context.title} ${context.originalInput}`)
  const { micro, steps } = ladderFor(topic, context.title)
  const seen = [...knownText(context), current]
  const options = unseen([...alternatives, ...micro, ...steps, ...SHRINK], seen)
  return {
    action: options[0]
      ? { text: options[0], why: "A different way in." }
      : null,
    queue: [],
    alternatives: options.slice(1),
    missingDetail: options[0]
      ? ""
      : "BackOnTrack is out of built-in ideas for this. What would you try, if it only had to take a minute?",
    note: "",
    keepCurrent: !options[0],
    source: "demo",
  }
}

/* ---------- Describing a case ---------- */

export const CASE_STATUS_LABEL = {
  choosing: "Choosing what’s in the way",
  ready: "Next step ready",
  working: "In progress",
  stuck: "Finding another way in",
  paused: "Paused",
  finished: "Finished",
  released: "Released",
} as const

export type CaseStatus = keyof typeof CASE_STATUS_LABEL

/** One status, worked out from the task, so it can't disagree with Tasks. */
export function caseStatus(task: Task): CaseStatus {
  const recovery = task.recoveryCase
  if (task.status === "completed") return "finished"
  if (task.status === "released") return "released"
  if (task.status === "paused") return "paused"
  if (!recovery?.blocker) return "choosing"
  if (task.status === "needs-recovery") return "stuck"
  if (task.status === "in-progress" || recovery.completed.length) {
    return "working"
  }
  return "ready"
}

export function suggestedNext(task: Task) {
  const recovery = task.recoveryCase
  if (!recovery) return task.nextAction
  if (!recovery.blocker) return "Say what’s making this difficult."
  if (recovery.current) return recovery.current.text
  if (recovery.blocker === "behind" && !recovery.path) {
    return "Choose Finish, Reduce, or Release."
  }
  return "Choose your next step."
}

export function caseContext(task: Task): CaseContext {
  const recovery = task.recoveryCase!
  return {
    originalInput: recovery.originalInput,
    title: task.title,
    blocker: recovery.blocker,
    path: recovery.path,
    completed: recovery.completed.map((item) => item.text),
    tried: recovery.tried,
    realityGap: recovery.realityGap,
    realityCheck: recovery.realityCheck,
  }
}

/** The tools on screen: one set for the blocker, plus any a Plan B opened. */
export function toolsFor(recovery: RecoveryCase) {
  const tools = new Set(recovery.openTools)
  if (recovery.blocker === "worried") tools.add("reality-gap")
  if (recovery.blocker === "behind") tools.add("paths")
  return tools
}

export function emptyRealityCheck(
  text: string,
  title: string
): RealityCheckAnswers {
  const value = NORMALIZE(text)
  const planned =
    /\b(supposed to|meant to|was going to|planned to|deadline)\b/i.test(value)
  return {
    expected: planned ? title : "",
    happened: planned ? "" : value,
    done: "",
    opportunity: null,
    constraints: "",
  }
}

/* ---------- One entry point, used by Demo Mode and as Live AI's fallback ---------- */

export type CasePurpose =
  "understand" | "initial" | "path" | "smaller" | "another" | "stuck"

export type CaseRequestShape = CaseContext & {
  purpose: CasePurpose
  current: string
  alternatives: string[]
  stuckReason: StuckReason | null
  stuckDetail: string
}

export function demoCasePlan(request: CaseRequestShape): CasePlan {
  // Swapping a step doesn't change what comes after it, unless the plan is gone.
  const swapped = (plan: CasePlan): CasePlan => ({
    ...plan,
    keepQueue: request.stuckReason !== "not-viable",
  })
  switch (request.purpose) {
    case "understand":
      return {
        action: null,
        queue: [],
        alternatives: [],
        missingDetail: "",
        note: "",
        keepCurrent: true,
        source: "demo",
        title: deriveTitle(request.originalInput),
        suggestedBlocker: suggestBlocker(request.originalInput),
      }
    case "path":
      return demoPathPlan(request)
    case "smaller":
      return swapped(demoSmaller(request, request.current))
    case "another":
      return swapped(
        demoAnother(request, request.current, request.alternatives)
      )
    case "stuck":
      return swapped(
        demoPlanB(request, request.current, {
          reason: request.stuckReason ?? "other",
          detail: request.stuckDetail,
        })
      )
    default:
      return demoInitialPlan(request)
  }
}
