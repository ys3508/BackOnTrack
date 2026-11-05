import { applySafetyGuards } from "@/lib/guards"
import { similarity } from "@/lib/guards"
import { categorize } from "@/lib/recovery/categorize"
import { concreteStep } from "@/lib/recovery/concrete"
import type { Category } from "@/lib/recovery/categorize"
import { extractRequirements } from "@/lib/recovery/demo-breakdown"
import { contextIntake, taskFacts } from "@/lib/recovery/context"
import type {
  Analysis,
  Approach,
  RecoveryPlan,
  Strategy,
  TaskRecoveryRequest,
  TaskRecoveryResult,
} from "@/lib/schemas"
import { addDays, shortDate } from "@/lib/workspace/dates"

/**
 * Demo Mode's recovery engine. It fills in fixed templates from the task's own
 * data, so it's useful without an API key, but it isn't AI and doesn't claim to be.
 */

type Template = {
  smallerSteps?: string[]
  choices?: string[]
  headline: string
  instruction: string
  why: string
  minutes: number
  approach: Approach
  kind: RecoveryPlan["artifact"]["kind"]
  artifactTitle: string
  body: string
  steps: string[]
}

/** Plans built from the user's real progress, tried before the general ones. */
function adaptiveTemplates(request: TaskRecoveryRequest): Template[] {
  const { task, obstacle } = request
  const list: Template[] = []
  const reported = [obstacle, ...task.obstacles].join(" ")
  const requirements = extractRequirements(task.instructions, 8)

  const confused =
    /understand|unclear|confus|not sure what|don.t know what|what .* wants/i.test(
      reported
    ) || /review|read .*instructions/i.test(task.currentStep)
  if (requirements.length && confused) {
    list.push({
      headline: "Pull out what’s actually being asked",
      instruction:
        "Read this checklist of what your instructions ask for, and mark anything unclear with a question mark.",
      why: "It turns the instructions into a short list. These lines were pulled out with simple text rules, so check them against the original.",
      minutes: 5,
      approach: "gather-information",
      kind: "checklist",
      artifactTitle: "What the instructions ask for",
      body: [
        "What's being asked:",
        ...requirements.map((item) => `- [ ] ${item}`),
        "",
        "What I'd ask about:",
        "- [anything unclear]",
      ].join("\n"),
      steps: [
        "Mark anything unclear",
        "Choose the checklist item you understand best",
      ],
    })
  }

  // A coding step, or one that's already resisted a plan, gets made smaller.
  if (task.currentStep) {
    const concrete = concreteStep(task.currentStep)
    const different = similarity(concrete.firstAction, task.currentStep) < 0.8
    if (
      different &&
      (concrete.starter.kind === "code" || task.stuckOnStep > 0)
    ) {
      list.push({
        headline: `Make “${task.currentStep}” smaller`,
        instruction: concrete.firstAction,
        why: concrete.why,
        minutes: 5,
        approach: "shrink-scope",
        kind: concrete.starter.kind === "code" ? "code" : "checklist",
        artifactTitle: concrete.starter.title,
        body: concrete.starter.content,
        // Its steps replace the current one, so they aren't also added at the end.
        steps: [],
        smallerSteps: concrete.smallerSteps,
      })
    }
  }

  const writing = /writ|draft|introduc|paragraph|outline|section/i.test(
    task.currentStep
  )
  if (writing) {
    const subject = requirements[0] ?? "[your topic]"
    list.push({
      headline: "Pick an opening, and change it",
      instruction:
        "Choose one of these openings to put in your document, then change anything you like.",
      why: "Editing something on the page is easier than facing a blank one. These are templates for you to finish, and you stay the author.",
      minutes: 5,
      approach: "write-in-app",
      kind: "note",
      artifactTitle: `Openings: ${task.title}`,
      body: `Notes for this section of ${task.title}:
[what you want to say]`,
      steps: ["Insert one opening", "Fill in its brackets"],
      choices: [
        `This section covers: ${subject.replace(/\.$/, "")}. My main point is [your main point].`,
        `I first looked at [what you looked at], and found [what you found].`,
        `The question here is [your question], and my answer is [your answer] because [your reason].`,
      ],
    })
  }

  const lastLine = task.document.trim().split("\n").filter(Boolean).at(-1)
  // "One more sentence" makes no sense after a line of code.
  const looksLikeCode = /[=(){};]|^\s*(import|from|def|class)\b/.test(
    lastLine ?? ""
  )
  if (lastLine && !looksLikeCode) {
    const quote =
      lastLine.length > 90 ? `${lastLine.slice(0, 87)}...` : lastLine
    list.push({
      headline: "Pick up where your document stops",
      instruction: `Add one more sentence after “${quote}”`,
      why: "You've already started, so this uses what's there instead of beginning again.",
      minutes: 5,
      approach: "write-in-app",
      kind: "note",
      artifactTitle: `Where my document stops: ${task.title}`,
      body: `My document stops at:
${lastLine}

What comes next, roughly:
[one line]`,
      steps: ["Add one sentence to your document"],
    })
  }
  return list
}

function templates(
  request: TaskRecoveryRequest,
  category: Category
): Template[] {
  const { task, today } = request
  const title = task.title
  const missed = Boolean(task.deadline && task.deadline < today)
  const due = task.deadline ? shortDate(task.deadline) : "[date]"

  const askForHelp = (who: string): Template => ({
    headline: "Get one person's help",
    instruction: `Finish this short message to ${who}, using the draft below.`,
    why: "Other people can often unblock in one reply what's been stuck for days.",
    minutes: 3,
    approach: "ask-someone",
    kind: "email",
    artifactTitle: `Message asking for help with ${title}`,
    body: `Hi [name],\n\nI'm stuck on "${title}". Could you [look at it with me for 10 minutes / tell me how you approached it] this week?\n\nThe part I'm stuck on is: [one line].\n\nThanks,\n[Your name]`,
    steps: [
      "Add a name and one line about where you're stuck",
      "Send it, if you're happy with it",
    ],
  })

  const firstPass: Template = {
    headline: "Do a rough first pass",
    instruction: `Spend 5 minutes on the easiest piece of “${title}”, and put the rough result in this draft.`,
    why: "A rough version you can fix is easier to continue than a blank page.",
    minutes: 5,
    approach: "shrink-scope",
    kind: "note",
    artifactTitle: `Rough first pass: ${title}`,
    body: `Rough first pass (messy is fine):\n\n[Start here]\n\nWhat's left after this:\n- `,
    steps: [
      "Start a 5-minute focus session",
      "Write or do only the easiest piece",
      "Note what's left",
    ],
  }

  if (category === "academic" && missed) {
    return [
      {
        headline: "Find out what's still possible",
        instruction: "Fill in the brackets in this message to your professor.",
        why: "The late policy decides what's worth doing next, and this finds it out. You choose whether to send it.",
        minutes: 5,
        approach: "write-in-app",
        kind: "email",
        artifactTitle: "Message to your professor",
        body: `Subject: Question about late submission: ${title}\n\nHello [Professor's name],\n\nI missed the ${due} deadline for ${title}. Could you tell me whether late work is accepted, and if so, by when and with what penalty?\n\nI can realistically submit [what you can finish] by [date].\n\nThank you,\n[Your name]\n[Course and section]`,
        steps: [
          "Fill in the brackets in the draft",
          "Check the syllabus for a late-work policy",
          "Send the message, if you decide to",
          "List what's left to finish",
        ],
      },
      {
        headline: "Look up the policy first",
        instruction:
          "Open the syllabus, search for “late”, and paste what it says here.",
        why: "It takes about 5 minutes, and you may not need to write to anyone yet.",
        minutes: 5,
        approach: "gather-information",
        kind: "note",
        artifactTitle: "Late-work policy notes",
        body: `What the syllabus says about late work:\n[paste here]\n\nWhat that means for ${title}:\n- Can I still submit? [yes / no / unclear]\n- By when? [date]\n- Penalty? [amount]`,
        steps: [
          "Search the syllabus for “late”",
          "Paste the policy into this note",
          "Decide whether you need to ask your professor",
        ],
      },
      askForHelp("a classmate or advisor"),
      firstPass,
    ]
  }

  if (category === "academic") {
    return [
      {
        headline: "Turn it into a worksheet",
        instruction:
          "Paste the instructions or the first question into this worksheet.",
        why: "Having the actual questions in front of you makes this smaller than “homework”.",
        minutes: 5,
        approach: "write-in-app",
        kind: "outline",
        artifactTitle: `Worksheet: ${title}`,
        body: `${title}${task.deadline ? ` (due ${due})` : ""}\n\nWhat it asks for:\n[paste the instructions or first question]\n\nParts to finish:\n1. [part]\n2. [part]\n3. [part]\n\nWorking on now:\n[your answer or notes]`,
        steps: [
          "Paste the instructions into the worksheet",
          "List the parts to finish",
          "Do the first part in a 10-minute focus session",
          "Check it against the instructions",
        ],
      },
      {
        headline: "Do only the first question",
        instruction:
          "Start a 5-minute focus session on the first question, and write your attempt here.",
        why: "A wrong first attempt still gives you something to fix.",
        minutes: 5,
        approach: "shrink-scope",
        kind: "note",
        artifactTitle: `First question: ${title}`,
        body: `${title}\n\nQuestion 1:\n[copy it here]\n\nMy attempt (wrong is fine):\n[write here]\n\nWhat I'm unsure about:\n- `,
        steps: [
          "Copy the first question",
          "Attempt it for 5 minutes",
          "Write down what you're unsure about",
        ],
      },
      askForHelp("a classmate"),
      firstPass,
    ]
  }

  if (category === "job") {
    return [
      {
        headline: "Line up one application",
        instruction:
          "Fill in the first row of this tracker with one job you could apply to.",
        why: "One named role is something you can act on, and a backlog isn't.",
        minutes: 5,
        approach: "recall-from-memory",
        kind: "checklist",
        artifactTitle: "Application tracker",
        body: `Company: [name]\nRole: [title]\nLink: [paste it, or "need to find"]\nClosing date: [date, or "unknown"]\nStill needed: [résumé update / cover note / nothing]\nNext: [one thing]`,
        steps: [
          "Fill in one company and role",
          "Check that it's still open",
          "Note what the application still needs",
          "Submit it, or plan a session for it",
        ],
      },
      {
        headline: "Write the opening line",
        instruction:
          "Finish this opening for a cover note, for any role you have in mind.",
        why: "You can reuse it, and it's far smaller than a whole application.",
        minutes: 5,
        approach: "write-in-app",
        kind: "note",
        artifactTitle: "Cover note opening",
        body: `Hello [hiring team],\n\nI'm applying for [role] because [one real reason]. In my last [job/project], I [one thing you did], which [one result].\n\n[Your name]`,
        steps: ["Fill in the brackets", "Save it for the next application"],
      },
      askForHelp("someone in your network"),
      firstPass,
    ]
  }

  if (category === "message") {
    return [
      {
        headline: "Send a short reply",
        instruction: "Finish this reply. Two sentences are enough.",
        why: "A short reply now usually beats a perfect one later. You choose whether to send it.",
        minutes: 3,
        approach: "write-in-app",
        kind: "email",
        artifactTitle: `Draft reply: ${title}`,
        body: `Hi [name],\n\nThanks for your message, and sorry for the slow reply. [One sentence answering their question, or saying when you'll answer.]\n\nBest,\n[Your name]`,
        steps: ["Fill in the brackets", "Send it, if you're happy with it"],
      },
      {
        headline: "Send a holding reply",
        instruction: "Pick a date in this one-line reply.",
        why: "It closes the loop for now, without needing the full answer.",
        minutes: 2,
        approach: "shrink-scope",
        kind: "email",
        artifactTitle: "Holding reply",
        body: `Hi [name], I've seen this and I'll get back to you properly by [date]. Thanks for your patience.`,
        steps: ["Pick a date you can keep", "Send it, if you're happy with it"],
      },
      firstPass,
    ]
  }

  if (category === "admin") {
    return [
      {
        headline: "List what this needs",
        instruction:
          "Fill in this checklist of what you need before you can finish.",
        why: "Paperwork often stalls on one missing thing, and this finds it.",
        minutes: 5,
        approach: "gather-information",
        kind: "checklist",
        artifactTitle: `What ${title} needs`,
        body: `${title}\n\nWhere it's done: [website / office / phone number]\nDocuments or details needed:\n- [item]\n- [item]\nWho to ask if unsure: [person or office]\nFirst thing to do: [one thing]`,
        steps: [
          "Fill in where it gets done",
          "List the documents or details",
          "Find the first one",
        ],
      },
      {
        headline: "Prepare a quick question",
        instruction:
          "Finish this question for the office or person responsible.",
        why: "They can tell you what's required, so you don't have to guess.",
        minutes: 3,
        approach: "ask-someone",
        kind: "email",
        artifactTitle: "Question for the responsible office",
        body: `Hello,\n\nI need to complete ${title}. Could you tell me what's required and whether there's a deadline?\n\nMy details: [reference number, if any]\n\nThank you,\n[Your name]`,
        steps: ["Fill in the brackets", "Send it or use it as a phone script"],
      },
      firstPass,
    ]
  }

  return [
    {
      headline: "Break it into a short list",
      instruction: `List the first three pieces of “${title}” in this draft.`,
      why: "Three named pieces are easier to begin than one big task.",
      minutes: 5,
      approach: "write-in-app",
      kind: "plan",
      artifactTitle: `Plan: ${title}`,
      body: `${title}\n\nWhat “done” looks like: [one line]\n\nFirst three pieces:\n1. [smallest piece]\n2. [next piece]\n3. [next piece]\n\nWhat I need to open or find first: [one thing]`,
      steps: [
        "Fill in the three pieces",
        "Open what you need for the first one",
        "Do the first piece in a focus session",
      ],
    },
    firstPass,
    askForHelp("someone who could help"),
  ]
}

const PAUSE_TEMPLATE = (title: string): Template => ({
  headline: "Set this down for now, on purpose",
  instruction:
    "Write down where you got to, so that returning to this is easier.",
  why: "You've tried several approaches. Stopping with a note is different from avoiding it.",
  minutes: 2,
  approach: "decide",
  kind: "note",
  artifactTitle: `Where I left off: ${title}`,
  body: `Where I got to:\n[one line]\n\nWhat got in the way:\n[one line]\n\nWhen I'll look at this again:\n[date]`,
  steps: ["Write where you got to", "Pick a day to look at it again"],
})

function releaseTemplate(request: TaskRecoveryRequest): Template {
  const { title } = request.task
  return {
    headline: "Let this go cleanly",
    instruction: "Fill in this closing note, so nothing stays half-open.",
    why: "Deciding on purpose, and telling anyone who needs to know, closes the loop.",
    minutes: 5,
    approach: "decide",
    kind: "note",
    artifactTitle: `Closing note: ${title}`,
    body: `What I'm stopping: ${title}\nWhat stopping will affect: [check this first, if it matters]\nWho needs to know: [name, or nobody]\nAnything to save or cancel: [item, or nothing]`,
    steps: [
      "Check what stopping would affect",
      "Tell anyone who needs to know",
      "Save or cancel anything left over",
    ],
  }
}

function buildAnalysis(
  request: TaskRecoveryRequest,
  category: Category,
  recommended: Strategy
): Analysis {
  const { task, today, obstacle } = request
  const facts = taskFacts(request, today)
  const missed = Boolean(task.deadline && task.deadline < today)
  const reported = [obstacle, ...task.obstacles.slice(-2)]
    .filter(Boolean)
    .map((item) => `You reported: ${item}`)

  const unknownByCategory: Record<Category, string> = {
    academic: missed
      ? "Your professor's late-submission policy. BackOnTrack doesn't know it."
      : "Exactly what the assignment requires, unless it's in your notes.",
    job: "Whether the positions you have in mind are still open.",
    message: "How urgent this is for the other person.",
    admin: "What's actually required, and whether a fixed date applies.",
    general: "What “done” looks like for this.",
  }

  return applySafetyGuards(
    {
      acknowledgement: `Based on what's recorded for “${task.title}”.`,
      realityCheck: {
        knownFacts: [...facts.known, ...reported],
        assumptions: [
          missed
            ? "It may feel as if the passed deadline settles everything. What's still possible hasn't been checked."
            : "It may feel as if this has to be done all at once. That hasn't been established.",
        ],
        unknowns: [...facts.unknown, unknownByCategory[category]],
        consequences: [
          {
            text: missed
              ? "The original deadline has passed."
              : "The task isn't finished yet.",
            status: "confirmed",
          },
          {
            text: "What delay would actually cost depends on details not recorded here.",
            status: "uncertain",
          },
        ],
      },
      decision: {
        recommended,
        reasoning:
          recommended === "FINISH"
            ? `You've already made progress (${task.progress}%), so continuing looks more realistic than rethinking it.`
            : "A smaller next step looks more realistic than the whole task, and it keeps the goal alive.",
        uncertainty:
          "Demo Mode uses fixed rules and templates. You may know something that changes this.",
        options: {
          FINISH: `Keep “${task.title}” as it is, and work through it.`,
          REDUCE:
            "Keep the most important part, and start with something small.",
          RELEASE: "Stop on purpose, after checking what that would affect.",
        },
        highStakes: category === "academic" || category === "admin",
        caution: "",
      },
      supportConcern: false,
    },
    contextIntake(request)
  )
}

export function demoTaskRecovery(
  request: TaskRecoveryRequest
): TaskRecoveryResult {
  const { task, today, rejected, obstacle } = request
  const category = categorize(`${task.title} ${task.description}`)

  const recommended: Strategy = task.progress >= 50 ? "FINISH" : "REDUCE"
  const analysis = buildAnalysis(request, category, recommended)
  const strategy = request.strategy ?? analysis.decision.recommended

  // After a stopped session or low energy, start with something smaller.
  const lastSession = task.focusSessions.at(-1)
  const justStuck = lastSession?.outcome === "stuck"
  const lastNote = lastSession?.note
  const lowEnergy = /energy|overwhelm|too big/i.test(obstacle)
  const offset = justStuck || lowEnergy ? 1 : 0

  const adaptive = strategy === "RELEASE" ? [] : adaptiveTemplates(request)
  const list =
    strategy === "RELEASE"
      ? [releaseTemplate(request)]
      : [...adaptive, ...templates(request, category)]
  const used = new Set(rejected.map((item) => item.artifactTitle))
  const available = list.filter((item) => !used.has(item.artifactTitle))
  // A plan built from this task's own progress already fits, so it comes first.
  const stillTailored = adaptive.some((item) => !used.has(item.artifactTitle))
  const template =
    available[stillTailored ? 0 : Math.min(offset, available.length - 1)] ??
    PAUSE_TEMPLATE(task.title)
  const exhausted = available.length === 0

  const steps =
    strategy === "REDUCE" ? template.steps.slice(0, 3) : template.steps
  const reasonText = [
    rejected.length
      ? "That last suggestion didn't fit, so this is a different approach."
      : "",
    justStuck
      ? `Your last focus session stopped early${lastNote ? ` (“${lastNote}”)` : ""}, so this is smaller.`
      : "",
    obstacle ? `You said: “${obstacle}”.` : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    analysis,
    plan: {
      headline: template.headline,
      adaptationNote: reasonText,
      nextStep: {
        instruction: template.instruction,
        why: template.why,
        minutes: template.minutes,
        approach: template.approach,
      },
      artifact: {
        kind: template.kind,
        title: template.artifactTitle,
        body: template.body,
      },
      steps,
      smallerSteps: template.smallerSteps ?? [],
      choices: template.choices ?? [],
      schedule: [
        {
          date: today,
          minutes: 10,
          label: template.steps[0] ?? template.instruction,
        },
        ...(strategy === "RELEASE"
          ? []
          : [
              {
                date: addDays(today, 1),
                minutes: strategy === "FINISH" ? 25 : 10,
                label: template.steps[1] ?? "Continue",
              },
            ]),
      ],
    },
    exhausted,
  }
}
