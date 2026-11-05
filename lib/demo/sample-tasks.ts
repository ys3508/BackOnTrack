import { addDays } from "@/lib/workspace/dates"
import type { WorkspaceAction } from "@/lib/workspace/reducer"

/**
 * Made-up example tasks for trying the app. Nothing here is real, including the
 * courses, companies, and instructions.
 */
type Sample = {
  label: string
  build: (id: string, at: string, today: string) => WorkspaceAction[]
}

const example = "Made-up example task."

export const SAMPLE_TASKS: Sample[] = [
  {
    label: "Homework assignment",
    build: (id, at, today) => [
      {
        type: "create-task",
        id,
        at,
        title: "Finish my machine learning assignment",
        description: example,
        deadline: addDays(today, 6),
      },
      {
        type: "set-instructions",
        id,
        at,
        instructions: {
          text: "Assignment 3: Classification\n- Train a classifier on the provided dataset\n- Compare it with one baseline model\n- Report the accuracy on the test set\nYou must submit a two-page PDF report. Graded on clarity and correct evaluation.",
          sourceName: "",
          kind: "paste",
          truncated: false,
          addedAt: at,
        },
      },
    ],
  },
  {
    label: "Job application",
    build: (id, at, today) => [
      {
        type: "create-task",
        id,
        at,
        title: "Apply for a data analyst job",
        description: example,
        deadline: addDays(today, 9),
      },
      {
        type: "set-instructions",
        id,
        at,
        instructions: {
          text: "Data Analyst posting (example)\n- Experience with SQL and spreadsheets\n- Include a short cover letter\nYou must submit your résumé through the company's website.",
          sourceName: "",
          kind: "paste",
          truncated: false,
          addedAt: at,
        },
      },
    ],
  },
  {
    label: "Missed deadline",
    build: (id, at, today) => [
      {
        type: "create-task",
        id,
        at,
        title: "Submit my biology lab report",
        description: example,
        deadline: addDays(today, -3),
      },
      { type: "set-status", id, at, status: "needs-recovery" },
    ],
  },
  {
    label: "A first attempt that failed",
    build: (id, at, today) => [
      {
        type: "create-task",
        id,
        at,
        title: "Write my history essay",
        description: example,
        deadline: addDays(today, 4),
      },
      {
        type: "add-subtask",
        id,
        at,
        subId: `${id}-1`,
        title: "Read the essay prompt",
      },
      {
        type: "add-subtask",
        id,
        at,
        subId: `${id}-2`,
        title: "Write the introduction",
      },
      { type: "toggle-subtask", id, at, subId: `${id}-1` },
      {
        type: "timer-start",
        id: `${id}-session`,
        kind: "focus",
        taskId: id,
        subtaskId: `${id}-2`,
        minutes: 25,
        now: Date.parse(at) - 240_000,
        at: new Date(Date.parse(at) - 240_000).toISOString(),
      },
      {
        type: "timer-stop",
        now: Date.parse(at),
        at,
        outcome: "stuck",
        note: "I stared at the blank page",
      },
    ],
  },
]
