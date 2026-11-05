/**
 * Demo Mode's way of making a big step small. These are fixed rules matched on
 * wording, so they can be wrong, and the interface says they aren't AI. Code
 * starters use [brackets] for anything unknown, and they haven't been run.
 */

export type Starter = {
  kind: "outline" | "draft" | "code" | "checklist"
  title: string
  content: string
}

export type ConcreteStep = {
  firstAction: string
  why: string
  starter: Starter
  smallerSteps: string[]
}

const fence = (code: string) => "```python\n" + code + "\n```"

const RULES: { match: RegExp; build: (step: string) => ConcreteStep }[] = [
  {
    match:
      /classifier|target column|train\b.*\bmodel|\bmodel\b.*\btrain|fit\b.*\bmodel/i,
    build: () => ({
      firstAction: "Open the dataset and identify the target column",
      why: "You can’t train anything until you know what it’s predicting, and this takes a couple of minutes.",
      smallerSteps: [
        "Open the dataset and identify the target column",
        "Split the data into training and test sets",
        "Fit one simple classifier",
        "Record its accuracy on the test set",
      ],
      starter: {
        kind: "code",
        title: "Code starting point: look at the data",
        content: fence(
          [
            "import pandas as pd",
            "",
            'data = pd.read_csv("[your_dataset].csv")',
            "print(data.head())",
            "print(data.columns)",
            "",
            'target = "[name of the column you want to predict]"',
            "print(data[target].value_counts())",
          ].join("\n")
        ),
      },
    }),
  },
  {
    match: /baseline/i,
    build: () => ({
      firstAction:
        "Write down the simplest prediction to compare against, such as always choosing the most common class",
      why: "A baseline only needs a sentence to define, and it tells you if your model is doing anything useful.",
      smallerSteps: [
        "Choose the simplest prediction to compare against",
        "Work out its accuracy on the test set",
        "Put both numbers side by side",
      ],
      starter: {
        kind: "code",
        title: "Code starting point: a baseline",
        content: fence(
          [
            "from sklearn.dummy import DummyClassifier",
            "",
            'baseline = DummyClassifier(strategy="most_frequent")',
            "baseline.fit(X_train, y_train)",
            'print("Baseline accuracy:", baseline.score(X_test, y_test))',
          ].join("\n")
        ),
      },
    }),
  },
  {
    match: /accuracy|metric|evaluat/i,
    build: () => ({
      firstAction:
        "Write down which number you need to report, and for which data",
      why: "Naming the exact number makes the rest of this step straightforward.",
      smallerSteps: [
        "Write down which number you need to report",
        "Calculate it on the test set",
        "Paste the result into your document",
      ],
      starter: {
        kind: "code",
        title: "Code starting point: measure the result",
        content: fence(
          [
            "from sklearn.metrics import accuracy_score",
            "",
            "predictions = model.predict(X_test)",
            'print("Test accuracy:", accuracy_score(y_test, predictions))',
          ].join("\n")
        ),
      },
    }),
  },
  {
    match: /submit|upload|hand in|turn in/i,
    build: (step) => ({
      firstAction:
        "Find the submission page, and write down the file format it needs",
      why: "This avoids surprises at the last minute, and takes about two minutes.",
      smallerSteps: [
        "Find the submission page",
        "Write down the required file format",
        "Export your work in that format",
        "Submit it",
      ],
      starter: {
        kind: "checklist",
        title: "Submission checklist",
        content: [
          `- [ ] Where it's submitted: [link or place]`,
          "- [ ] File format: [format]",
          `- [ ] Requirement checked: ${step}`,
          "- [ ] Submitted, and confirmation saved",
        ].join("\n"),
      },
    }),
  },
  {
    match: /read|review|requirements?|instructions?|understand/i,
    build: () => ({
      firstAction:
        "Copy the first requirement into your document, in your own words",
      why: "Rewriting one line shows you whether you understand it, which rereading doesn’t.",
      smallerSteps: [
        "Rewrite the first requirement in your own words",
        "List what has to be handed in",
        "Mark anything unclear with a question mark",
      ],
      starter: {
        kind: "checklist",
        title: "What's being asked",
        content: [
          "- [ ] What has to be handed in: [list]",
          "- [ ] First requirement, in my own words: [one line]",
          "- [ ] Anything unclear: [question]",
        ].join("\n"),
      },
    }),
  },
  {
    match:
      /write|draft|introduc|essay|paper|report|section|paragraph|outline|conclusion/i,
    build: (step) => ({
      firstAction:
        "Write one rough line saying what this part needs to get across",
      why: "One rough line gives you something to edit, and it can be replaced later.",
      smallerSteps: [
        "Write one rough line on what this part must say",
        "List the three points it needs",
        "Turn the first point into a sentence",
      ],
      starter: {
        kind: "draft",
        title: `Draft starter: ${step}`,
        content: [
          "**What this part needs to say:** [one rough line]",
          "",
          "**Points to cover:**",
          "",
          "- [point]",
          "- [point]",
          "",
          "**First sentence:** [write it badly, then fix it]",
        ].join("\n"),
      },
    }),
  },
  {
    match: /apply|application|company|role|job/i,
    build: () => ({
      firstAction: "Type the name of one company and role into your document",
      why: "One named role is something you can act on.",
      smallerSteps: [
        "Type one company and role",
        "Save the posting link",
        "Note what the application asks for",
      ],
      starter: {
        kind: "checklist",
        title: "One application",
        content: [
          "- [ ] Company: [name]",
          "- [ ] Role: [title]",
          "- [ ] Link: [paste it]",
          "- [ ] It asks for: [résumé, cover letter, other]",
        ].join("\n"),
      },
    }),
  },
  {
    match: /email|reply|respond|message/i,
    build: () => ({
      firstAction: "Write a two-sentence reply in your document",
      why: "Two sentences are usually enough to get this moving.",
      smallerSteps: [
        "Note what they're asking",
        "Write a two-sentence reply",
        "Send it, if you're happy with it",
      ],
      starter: {
        kind: "draft",
        title: "Reply starter",
        content:
          "Hi [name],\n\nThanks for your message. [One sentence answering them.]\n\nBest,\n[Your name]",
      },
    }),
  },
]

/** Finds the smallest useful action for a step, with something to start from. */
export function concreteStep(step: string): ConcreteStep {
  const rule = RULES.find((item) => item.match.test(step))
  if (rule) return rule.build(step)
  return {
    firstAction: `Open what you need for “${step}”, and write down the first thing it asks for`,
    why: "Having it open, with one line written, is most of the battle.",
    smallerSteps: [
      "Open what you need for this step",
      "Write down the first thing it asks for",
      "Do only that",
    ],
    starter: {
      kind: "checklist",
      title: `Getting started: ${step}`,
      content: [
        "- [ ] What I need to open: [file, site, or person]",
        "- [ ] The first thing it asks for: [one line]",
        "- [ ] What done looks like: [one line]",
      ].join("\n"),
    },
  }
}

/** A smaller step to do first, for big steps a stuck person shouldn't start with. */
export function prepStepFor(step: string): string | null {
  return /classifier|train\b.*\bmodel|fit\b.*\bmodel/i.test(step)
    ? "Open the dataset and identify the target column"
    : null
}
