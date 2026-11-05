import type { ActionStep, Analysis, Approach, Strategy } from "@/lib/schemas"

/** A rung is one point in the path; its variants are alternative ways through. */
type Rung = ActionStep[]

export type DemoScenario = {
  id: string
  label: string
  /** The sample text placed in the intake box. Empty for the custom scenario. */
  input: string
  analysis: Analysis
  ladders: Record<Strategy, Rung[]>
}

function step(
  approach: Approach,
  instruction: string,
  why: string,
  inputLabel = "Your answer",
  inputPlaceholder = "Type here",
  minutes = 2
): ActionStep {
  return { approach, instruction, why, inputLabel, inputPlaceholder, minutes }
}

const jobScenario: DemoScenario = {
  id: "job-applications",
  label: "Avoiding job applications",
  input: "I have avoided job applications for two weeks and feel overwhelmed.",
  analysis: {
    acknowledgement:
      "Two weeks away from applications, and now the whole thing feels heavy.",
    realityCheck: {
      knownFacts: [
        "You have not worked on job applications for about two weeks.",
        "You feel overwhelmed by it.",
      ],
      assumptions: [
        "It may feel like a two-week gap has already cost you your chances. That has not been verified.",
        "It may feel like restarting means catching up on everything at once. Nothing requires that.",
      ],
      unknowns: [
        "Whether the positions you had in mind are still accepting applications.",
        "Whether any of them has a firm closing date.",
        "How soon you need a new job.",
      ],
      consequences: [
        {
          text: "Applications that are not sent cannot receive a response.",
          status: "confirmed",
        },
        {
          text: "Some positions may have closed during these two weeks.",
          status: "uncertain",
        },
      ],
    },
    decision: {
      recommended: "REDUCE",
      reasoning:
        "Nothing you described suggests that the goal has stopped mattering, but overwhelm is what stopped you. Keeping the goal while shrinking the restart to one application deals with that directly.",
      uncertainty:
        "If you have an urgent income need or a known closing date, finishing more applications may matter more than this suggests.",
      options: {
        FINISH:
          "Go back to your original application plan at its original pace.",
        REDUCE: "Keep looking for work, but restart with just one application.",
        RELEASE:
          "Stop this job search on purpose, if it is no longer what you want.",
      },
      highStakes: false,
      caution: "",
    },
    supportConcern: false,
  },
  ladders: {
    FINISH: [
      [
        step(
          "recall-from-memory",
          "Type the names of the companies you remember from your original list.",
          "Getting your list out of your head makes it something you can look at.",
          "Companies you remember",
          "One per line, as many as come to mind"
        ),
        step(
          "write-in-app",
          "Type one job title you would be willing to apply for, even a rough one.",
          "You do not need the list yet. A rough title is enough to search with later.",
          "A job title",
          "e.g. junior data analyst"
        ),
        step(
          "name-the-obstacle",
          "In any words, write what makes this feel stuck right now.",
          "One honest line tells us more than another attempt at the same thing.",
          "What feels stuck",
          "It feels stuck because..."
        ),
      ],
      [
        step(
          "decide",
          "From what you wrote, type the one application you want to finish first.",
          "The first one sets the direction. It does not have to be the best one.",
          "First application",
          "Company or role"
        ),
        step(
          "shrink-scope",
          "Write one sentence about why that kind of work appeals to you.",
          "This can become the opening of a cover note, so it is real progress.",
          "One sentence",
          "I am interested because..."
        ),
      ],
    ],
    REDUCE: [
      [
        step(
          "recall-from-memory",
          "Type the name of one company you wanted to apply to.",
          "One name turns a heavy backlog into one specific thing.",
          "Company name",
          "Just one name"
        ),
        step(
          "write-in-app",
          "Type any job title you remember seeing that seemed all right.",
          "If no company comes to mind, the kind of role is an easier place to begin.",
          "A job title",
          "e.g. project coordinator"
        ),
        step(
          "name-the-obstacle",
          'Finish this sentence: "Thinking about applying feels hard because..."',
          "Naming the specific difficulty is more useful than pushing harder.",
          "Finish the sentence",
          "It feels hard because..."
        ),
      ],
      [
        step(
          "write-in-app",
          "Write one sentence you could use to open an application to that role.",
          "You are writing part of the real application here, without opening anything else.",
          "Opening sentence",
          "I am applying because..."
        ),
        step(
          "gather-information",
          "List what you would still need to apply: for example, a résumé file, a link, or a closing date.",
          "This separates what you know from what you would have to look up.",
          "What you still need",
          "I would still need..."
        ),
      ],
      [
        step(
          "decide",
          "Write when you could spend ten minutes on the next piece, in your own words.",
          "A specific, small return point is easier to keep than a whole new plan.",
          "When",
          "e.g. after lunch tomorrow",
          1
        ),
        step(
          "ask-someone",
          "Type the first name of someone who could sit with you while you send it, or 'nobody'.",
          "Some tasks are easier with company nearby. 'Nobody' is a fine answer.",
          "A person",
          "A name, or nobody",
          1
        ),
      ],
    ],
    RELEASE: [
      [
        step(
          "write-in-app",
          "Write one sentence about what you are choosing to stop, and why.",
          "Stopping on purpose is different from drifting away from it.",
          "What you are stopping",
          "I am choosing to stop..."
        ),
        step(
          "name-the-obstacle",
          "Write what you would need to believe to feel all right stopping this.",
          "If that is hard to write, the decision may not be settled yet, and that is useful to know.",
          "What you would need to believe",
          "I would need to believe..."
        ),
      ],
      [
        step(
          "decide",
          "Write what, if anything, you want to do instead of this job search.",
          "Letting go leaves room. It is fine if the answer is 'nothing yet'.",
          "Instead",
          "Instead, I would...",
          1
        ),
        step(
          "ask-someone",
          "Type the name of anyone who needs to know you have stopped, or 'nobody'.",
          "Telling the right person closes the loop so it stops taking up your attention.",
          "Who needs to know",
          "A name, or nobody",
          1
        ),
      ],
    ],
  },
}

const assignmentScenario: DemoScenario = {
  id: "missed-assignment",
  label: "Missed an assignment deadline",
  input:
    "I missed my assignment deadline three days ago and don't know whether my professor accepts late submissions.",
  analysis: {
    acknowledgement:
      "The deadline passed three days ago, and you don't yet know what your options are.",
    realityCheck: {
      knownFacts: [
        "The assignment deadline passed three days ago.",
        "You do not know whether your professor accepts late submissions.",
      ],
      assumptions: [
        "It may feel as if the assignment can no longer be submitted. You have not confirmed that.",
        "It may feel as if contacting your professor will make things worse. You do not know how they will respond.",
      ],
      unknowns: [
        "Your professor's late-submission policy for this course.",
        "Whether any penalty would apply, and how large it would be.",
        "How much of the assignment is already done.",
      ],
      consequences: [
        {
          text: "The assignment has not been submitted by its original deadline.",
          status: "confirmed",
        },
        {
          text: "There may be a grade penalty or it may not be accepted. This depends on a policy you have not confirmed.",
          status: "uncertain",
        },
      ],
    },
    decision: {
      recommended: "REDUCE",
      reasoning:
        "The most important unknown is the late policy, and you can resolve it before doing all the work. Shrinking the immediate task to finding out, and preparing a submittable version, protects your options.",
      uncertainty:
        "If the syllabus or your professor says late work is not accepted, the best path could change. If it is accepted with little penalty, finishing fully may be better.",
      options: {
        FINISH:
          "Complete the whole assignment as planned, then submit it late.",
        REDUCE:
          "First find out the late policy, then aim for a complete but simpler submission.",
        RELEASE:
          "Decide not to submit it, only after confirming what that would mean for your grade.",
      },
      highStakes: true,
      caution:
        "This is an academic obligation. Before dropping it, check the syllabus or ask your professor what not submitting would mean for your grade.",
    },
    supportConcern: false,
  },
  ladders: {
    FINISH: [
      [
        step(
          "write-in-app",
          "Write what the assignment asks for in one sentence, from memory.",
          "Getting the task into your own words is a start that needs no other app.",
          "The assignment",
          "It asks me to..."
        ),
        step(
          "gather-information",
          "Type what is already finished and what is still missing, in rough words.",
          "A rough inventory is often smaller than the task feels.",
          "Done and missing",
          "Done: ... Missing: ..."
        ),
        step(
          "name-the-obstacle",
          "Write the part of this you most want to avoid thinking about.",
          "It is probably where the block is, so it is worth naming first.",
          "The part I'm avoiding",
          "The part I'm avoiding is..."
        ),
      ],
      [
        step(
          "write-in-app",
          "Write the first sentence of the section you could do most easily.",
          "Starting with the easiest section still moves the assignment forward.",
          "First sentence",
          "Rough is fine"
        ),
        step(
          "shrink-scope",
          "Type three rough headings for the assignment. Don't write anything under them.",
          "An outline is progress you can reuse without needing to write it well.",
          "Three headings",
          "One per line"
        ),
      ],
    ],
    REDUCE: [
      [
        step(
          "gather-information",
          "Type where you would find the late policy: for example, the syllabus, the course page, or an earlier email.",
          'This turns "I don\'t know" into a specific place to look.',
          "Where to look",
          "Probably in..."
        ),
        step(
          "write-in-app",
          "Draft a short message to your professor here, asking whether late work is accepted.",
          "You can write it here without sending anything. Sending it stays your decision.",
          "Draft message",
          "Hello Professor, I missed the deadline for..."
        ),
        step(
          "name-the-obstacle",
          'Finish this sentence: "Contacting my professor feels hard because..."',
          "If the hard part is the conversation, that is what to work on, not the assignment.",
          "Finish the sentence",
          "It feels hard because..."
        ),
      ],
      [
        step(
          "shrink-scope",
          "Write what the simplest complete version of this assignment would include.",
          "A simple, complete submission can be better than a perfect one that never arrives.",
          "Simplest complete version",
          "It would include..."
        ),
        step(
          "write-in-app",
          "Type the one section you would keep if you could only do one.",
          "This tells you which part matters most, however things turn out.",
          "One section",
          "I would keep..."
        ),
      ],
      [
        step(
          "decide",
          "Write when you plan to check the policy or contact your professor, in your own words.",
          "Knowing the answer changes the next decision, so this comes before more work.",
          "When",
          "e.g. this afternoon",
          1
        ),
        step(
          "ask-someone",
          "Type the name of a classmate or advisor who might know how this course handles late work, or 'nobody'.",
          "Someone else may know already, but your professor's answer is the one to rely on.",
          "A person",
          "A name, or nobody",
          1
        ),
      ],
    ],
    RELEASE: [
      [
        step(
          "gather-information",
          "Write what you would need to confirm before not submitting: for example, the weight of this assignment in your grade.",
          "This is an academic obligation, so the consequences are worth checking before you let go.",
          "What to confirm",
          "I would need to know..."
        ),
        step(
          "name-the-obstacle",
          "Write why not submitting feels like the right choice at the moment.",
          "If the reason is that the task feels too big, reducing it may serve you better.",
          "Why",
          "It feels right because..."
        ),
      ],
      [
        step(
          "ask-someone",
          "Type who you would talk to about what this means for the course: for example, your professor or an advisor.",
          "Someone with real information can tell you what this decision would cost.",
          "A person",
          "My professor, an advisor...",
          1
        ),
        step(
          "decide",
          "Write one sentence stating your decision and what you will do next.",
          "Writing it down makes it a decision instead of something that just happens.",
          "Your decision",
          "I have decided...",
          1
        ),
      ],
    ],
  },
}

const failedAttemptScenario: DemoScenario = {
  id: "failed-attempt",
  label: "A suggestion that didn't work",
  input: "I tried your suggestion, but I still couldn't start.",
  analysis: {
    acknowledgement:
      "You tried, and it didn't get you started. That tells us the last approach didn't fit, so we'll try something else.",
    realityCheck: {
      knownFacts: ["You tried a suggestion.", "You still could not start."],
      assumptions: [
        "It may feel as if not starting means something is wrong with you. A step that did not work says more about the step.",
        "It may feel as if the task itself is impossible. So far, only one way of starting it has been tried.",
      ],
      unknowns: [
        "What the task is and what the suggestion was. This session has no record of an earlier one.",
        "At what point starting stopped working: before opening it, or after.",
      ],
      consequences: [
        {
          text: "The task has not been started yet.",
          status: "confirmed",
        },
        {
          text: "Whether the delay will matter depends on a task and a deadline that are not known here.",
          status: "uncertain",
        },
      ],
    },
    decision: {
      recommended: "REDUCE",
      reasoning:
        "Trying again with the same size of step is unlikely to go differently. A much smaller first move changes what is being asked of you, without giving up on the task.",
      uncertainty:
        "This may be wrong if the task is no longer worth doing, or if it has a near deadline you have not mentioned.",
      options: {
        FINISH:
          "Keep the task as it is, and try a different way of starting it.",
        REDUCE: "Keep the task, but make the first move as small as possible.",
        RELEASE:
          "Consider whether this task still matters enough to keep pursuing.",
      },
      highStakes: false,
      caution: "",
    },
    supportConcern: false,
  },
  ladders: {
    FINISH: [
      [
        step(
          "write-in-app",
          "In a few words, type what the task is.",
          "This session doesn't know the task yet, and naming it makes the rest possible.",
          "The task",
          "The task is..."
        ),
        step(
          "name-the-obstacle",
          "Write what happened the last time you tried, as if describing it to a friend.",
          "Knowing where it stopped helps avoid sending you back to the same place.",
          "What happened",
          "I tried to... and then..."
        ),
      ],
      [
        step(
          "decide",
          "Write a different place or time you could try this, unlike last time.",
          "The same conditions tend to produce the same result, so change one of them.",
          "Where or when",
          "Instead, I could..."
        ),
        step(
          "ask-someone",
          "Type the name of someone who could be nearby while you start, or 'nobody'.",
          "Company can make starting easier. 'Nobody' is a fine answer.",
          "A person",
          "A name, or nobody",
          1
        ),
      ],
    ],
    REDUCE: [
      [
        step(
          "shrink-scope",
          "Type what the task is, in five words or fewer.",
          "We're not starting it yet. This only needs five words, right here.",
          "In five words",
          "Five words or fewer",
          1
        ),
        step(
          "name-the-obstacle",
          'Finish this sentence: "The moment I try to start, what happens is..."',
          "There's no need to do the task for this. It only shows where it stalls.",
          "Finish the sentence",
          "What happens is...",
          1
        ),
        step(
          "recall-from-memory",
          "Think of the last time you started something you'd been avoiding, and type what helped.",
          "What worked for you before is better evidence than general advice.",
          "What helped",
          "It helped that...",
          2
        ),
      ],
      [
        step(
          "write-in-app",
          "Write the worst possible first line or first idea for it, on purpose.",
          "Doing it badly on purpose takes away the pressure to get it right.",
          "Your bad first attempt",
          "Deliberately bad is the goal"
        ),
        step(
          "decide",
          "Write what would count as enough for today, even if it's tiny.",
          "Deciding this now means you don't have to keep judging yourself as you go.",
          "Enough for today",
          "Enough would be..."
        ),
      ],
    ],
    RELEASE: [
      [
        step(
          "write-in-app",
          "Write what the task is, and what would actually change if you stopped pursuing it.",
          "This is a way to check whether letting go is a real option.",
          "What would change",
          "If I stopped..."
        ),
        step(
          "name-the-obstacle",
          "Write who or what is making this feel required.",
          "It may be a real obligation, or an old expectation. Those call for different choices.",
          "Who or what",
          "It feels required because..."
        ),
      ],
      [
        step(
          "decide",
          "Write one sentence about what you've decided to do with this for now.",
          "A decision, even a temporary one, can stop it from taking up your attention.",
          "Your decision",
          "For now, I have decided...",
          1
        ),
        step(
          "ask-someone",
          "Type the name of anyone you'd want to talk this over with first, or 'nobody'.",
          "You don't have to settle it alone if you'd rather not.",
          "A person",
          "A name, or nobody",
          1
        ),
      ],
    ],
  },
}

/**
 * Used in Demo Mode for text that isn't one of the samples. It only repeats
 * what the user typed and says openly that it has not analyzed it.
 */
export function customScenario(responsibility: string): DemoScenario {
  return {
    id: "custom",
    label: "Your own text",
    input: "",
    analysis: {
      acknowledgement:
        "Demo Mode uses prewritten content, so this is a general example and is not an analysis of your words.",
      realityCheck: {
        knownFacts: [`You wrote: "${responsibility.slice(0, 200)}"`],
        assumptions: [
          "It may feel as if time away from this has already made things unrecoverable. That has not been checked.",
        ],
        unknowns: [
          "Whether there is a firm deadline, and who set it.",
          "What would actually happen if this were delayed further.",
        ],
        consequences: [
          {
            text: "Without knowing the details, the real consequences are unclear.",
            status: "uncertain",
          },
        ],
      },
      decision: {
        recommended: "REDUCE",
        reasoning:
          "As a general starting point, reducing keeps the goal alive while making the next step easier. Live AI would base this on your specific situation.",
        uncertainty:
          "This is a generic example. You are in a better position to judge which option fits.",
        options: {
          FINISH: "Continue the responsibility as originally planned.",
          REDUCE: "Keep the most important part and make the rest smaller.",
          RELEASE:
            "Consciously stop, if it is no longer relevant or recoverable.",
        },
        highStakes: false,
        caution: "",
      },
      supportConcern: false,
    },
    ladders: {
      FINISH: [
        [
          step(
            "write-in-app",
            "Write the very next thing the original plan would have you do.",
            "You only need the next thing, and not the whole plan.",
            "Next thing",
            "The next thing is..."
          ),
          step(
            "name-the-obstacle",
            "Write what is making that hard, in any words.",
            "A plain description of the obstacle is more useful than trying again.",
            "What makes it hard",
            "It is hard because..."
          ),
        ],
      ],
      REDUCE: [
        [
          step(
            "shrink-scope",
            "Write the part of this that matters most, in a single line.",
            "What's most important is what you will keep when the rest gets smaller.",
            "What matters most",
            "What matters most is..."
          ),
          step(
            "name-the-obstacle",
            'Finish this sentence: "I keep avoiding this because..."',
            "There's no wrong answer. It only helps show what to change.",
            "Finish the sentence",
            "I keep avoiding this because..."
          ),
        ],
        [
          step(
            "write-in-app",
            "Write what a one-minute version of that part would be.",
            "If it fits in one minute, it might be possible today.",
            "One-minute version",
            "In one minute I could..."
          ),
          step(
            "ask-someone",
            "Type the name of someone who could help with this, or 'nobody'.",
            "It doesn't have to be done alone. 'Nobody' is a fine answer.",
            "A person",
            "A name, or nobody",
            1
          ),
        ],
      ],
      RELEASE: [
        [
          step(
            "gather-information",
            "Write what you would need to check before stopping this for good.",
            "It's worth knowing what stopping would actually change.",
            "What to check",
            "I would need to check..."
          ),
          step(
            "decide",
            "Write one sentence about what you are letting go of, and why.",
            "Letting go on purpose is different from drifting away from it.",
            "What you are letting go",
            "I am letting go of..."
          ),
        ],
      ],
    },
  }
}

export const DEMO_SCENARIOS = [
  jobScenario,
  assignmentScenario,
  failedAttemptScenario,
]
