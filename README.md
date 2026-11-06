# BackOnTrack AI

**When plans fall apart, find your way forward.**

BackOnTrack AI helps you do avoided work, in one place: "Less planning. Less switching between apps. More actual progress." Each task opens as a workspace with its instructions, small steps, a working document, and a focus timer, with AI help for when you get stuck. Everything except the Live AI suggestions works with no AI at all.

It was built as a prototype for the AI Lab in AIML-500: Machine Learning Fundamentals at Indiana Wesleyan University. It is not a commercial product.

**Try it:** https://backontrack-peach.vercel.app

The public site runs in Demo Mode, with no account or API key. Its suggestions come from prewritten templates, not AI, and each one is labeled that way. The site currently runs the previous version, until the `feat/task-execution` branch is merged into `main`.

## The idea

**A task manager that adapts when life doesn't go according to plan.**

Most task managers ask "What do you need to do?" BackOnTrack keeps asking "Given what happened, what's the most realistic plan now?" It's meant for people who tend to put things off or find it hard to get started: you plan, don't do it, feel pressure, avoid the app, and find it harder to restart. It focuses on:

- **Deciding what to do:** a suggested order that explains itself, and a plan for what today can realistically hold.

- **Zero-Start:** the work is prepared, so you never begin from a blank page.
- **Failure-aware:** when an approach doesn't work, the next one is different and smaller.
- **Easy return:** you can come back after weeks away without catching up on anything.

BackOnTrack isn't a treatment for ADHD or anything else, and its effect hasn't been measured.

## What it does

The home page asks one question: "What's something you've been putting off?" From there, BackOnTrack follows **Understand → Act → Recover**:

1. Say what's going on, in your own words. A simple errand like "Buy lunch" stays a one-tap quick item.
2. Pick what's making it difficult. The app may point at the closest match, but you always choose, and you can change it any time without losing work.
3. Work in one Recovery Workspace, whose tools follow that choice, with one next action at a time:

| What's in the way | Tools |
| --- | --- |
| "I don't know where to start." | One-Step Breakdown: one step, and "Make it smaller". Later steps stay hidden until you ask or finish this one. |
| "I know what to do, but I can't start." | Micro-action, plus an optional 2 or 5 minute timer. A timer finishing never marks anything done. |
| "I'm worried about what might happen." | Reality Gap: four editable lists separating facts from fears, plus an optional message draft. It never invents a policy or consequence. |
| "I'm already behind, or my plan didn't work." | Reality Check, then Finish, Reduce, or Release, which you choose. Release on something consequential explains the uncertainty first. |

"I'm stuck" asks what happened and adapts (Plan B), never repeating a suggestion and never deleting finished work. After a few days away, it asks neutrally whether to continue, make the next step smaller, or reconsider the plan.

The earlier dashboard (suggested task and daily plan) is still there, under "Today's plan and suggested task" on the home page. The tools below all still work:

| Area | What you can do |
| --- | --- |
| **Workspace** | See "Your next small step", or "Continue where you left off", with one click to the task, its document, or a short focus session. Lists stay short, with an option to expand. |
| **Today** | "Plan my day" asks how much time you have, and optionally your energy, then proposes a realistic plan from your tasks. It gives each item a reason, says what's left out, and warns about deadlines at risk. You can reorder, remove, or add before using it. This is calculated, not AI, and it never moves a deadline. |
| **Suggested order** | Tasks are ordered by deadline, priority, progress, and plans, with the reason shown. You can turn this off, and change a task's priority or time estimate. |
| **Learning what helps** | BackOnTrack notices when work stalls, such as getting stuck on empty documents, and whether accepted help was followed by progress. Then it changes which help comes first, and says why. It needs at least 3 separate moments before claiming anything. In Settings, you can see every record, say "This isn't right", delete anything, state a preference, or switch it off. |
| **Coming back** | After a few days away, home shows one way back in: where you stopped, and a "Continue working" button. It shows no overdue counts, backlog, or streaks. |
| **Zero-Start** | "Set up my workspace" prepares a document with what's being asked, questions to answer, an outline, and an editable first section. Choose where to begin, and the first [placeholder] is selected so you can type over it. It's structure, not research. |
| **Help starting** | Each step has "Help me do this", which gives one concrete first action and something to start from: an outline, a draft, a checklist, or code to copy. Code hasn't been run, and BackOnTrack can't run it. A new task can set up its first workspace from your instructions. "Start 5 minutes" opens the document for that step, with a small timer on top. |
| **Task workspace** | Add instructions by pasting them or uploading a PDF, .txt, or .md file. Get an editable breakdown into small steps. Write in a rich-text document with autosave, and get writing help you preview, then accept or reject. Keep the timer beside your work. |
| **Tasks** | Create, edit, delete, complete, pause, and resume tasks. Set deadlines and, if you want, a priority, track progress, add steps and notes, and view history. Use a list or a Kanban board with six states. |
| **Focus** | Run 5, 10, or 25 minute sessions linked to a task, with pause, resume, reset, optional breaks, and history. A session stopped in under a minute is an interrupted attempt, and doesn't count as focus time. Timing uses wall-clock timestamps, so it stays right in background tabs and after a reload. Finishing a session never completes the task. |
| **Calendar** | See month and week views using FullCalendar's MIT packages. "Plan remaining work" suggests sessions for open steps, calculated from the time you say you have. You confirm them, and it can't change a deadline. Deadlines look different from optional planned work. Work sessions move freely, but a deadline only moves after you confirm. "Replan" sets a new work day and leaves the deadline alone. |
| **Recovery** | When stuck, get a plan based on the task's real data: title, deadline, status, attempts, finished actions, focus sessions, and obstacles. It produces something usable, such as a draft email, worksheet, or schedule. You preview and edit it, and nothing changes unless you accept it. |

Reality Check, Finish/Reduce/Release, and Plan B are all part of Recovery. The original step-by-step wizard is still available as a guided check-in.

| | |
| --- | --- |
| ![Task workspace](docs/screenshots/v3-task-workspace.jpg) | ![Continue where you left off](docs/screenshots/v3-continue.jpg) |
| ![Kanban board](docs/screenshots/w2-board.jpg) | ![Recovery plan](docs/screenshots/w5-recovery-plan.jpg) |
| ![Calendar](docs/screenshots/w3-calendar.jpg) | ![Focus timer](docs/screenshots/w4-focus.jpg) |

## Run it locally

Tested on Node.js 24. Next.js itself requires Node.js 20.9 or newer.

```bash
git clone https://github.com/ys3508/BackOnTrack.git
```

```bash
cd BackOnTrack
```

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3000. With no API key, the app runs in Demo Mode.

## Demo Mode

Tasks, focus, and the calendar never use AI, so they work the same in every mode. Demo Mode only affects suggestions:

- Breakdowns, writing help, and recovery plans come from fixed templates and simple text rules, using the task's own details. Each one says it's prewritten, not AI-generated.
- Four made-up examples are available on an empty workspace: a homework assignment, a job application, a missed deadline, and a first attempt that failed.
- It runs entirely in the browser, so nothing is sent to a server.
- If Live AI repeats itself or fails, the app says so. A template is never labeled as AI output.

## Environment variables

Live AI is optional. To enable it, copy `.env.example` to `.env.local` and set one key:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API key. Uses `claude-haiku-5-5`, chosen as an inexpensive model ($0.10 / $0.50 per million input / output tokens when written). |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key, used only if the Anthropic key is empty. |
| `AI_MODEL` | Optional override of the model ID. |

Keys are read only on the server and are never sent to the browser. `.env*` files are excluded from Git, except for `.env.example`.

## Testing

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

To run the required scenarios against the real model (needs a key, and spends a small amount of credit):

```bash
npm run test:live
```

Results are in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## Deploy on Vercel

The prototype is already deployed at https://backontrack-peach.vercel.app, and new commits on `main` redeploy it automatically. To create your own deployment:

1. Import `ys3508/BackOnTrack` at https://vercel.com/new. Vercel detects Next.js, so the defaults work.
2. Optionally, add `ANTHROPIC_API_KEY` under Settings → Environment Variables. Without it, the deployed app runs in Demo Mode.
3. Deploy. If you add a key later, redeploy so that it takes effect.

Set a monthly spend limit with your AI provider before sharing a live link. The built-in rate limits are per server instance, so they are not a strict quota.

## Technology

Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui components on Base UI, the Vercel AI SDK, Zod, Tiptap, PDF.js, FullCalendar (MIT packages), dnd-kit, and Vitest with Testing Library and axe-core.

## Open-source attribution

The project started from [shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template) (MIT License, © 2026 shadcn). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The editor uses Tiptap (MIT), PDF reading uses PDF.js (Apache-2.0), the calendar uses FullCalendar's MIT packages, and the board uses dnd-kit (MIT). Other projects were reviewed but no code was copied from them, including two that were left out because of licensing or timing approach. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) has the full list.

The chat interface was removed. The workspace, recovery engine, demo content, and interface design are specific to this project.

This repository does not yet have its own license for the original BackOnTrack code. That choice belongs to the author.

## Known limitations

- Recovery cases are saved only in this browser, along with everything else. Clearing browser data deletes them, so use Export in Settings to keep a backup.
- In Demo Mode, the blocker suggestion, errand detection, Reality Gap sorting, and next steps come from wording rules and templates. They handle any text, but only generally, and can sort a sentence wrongly. Everything is editable, and each suggestion says it isn't AI.
- Crisis wording is matched by rules, so it can miss phrasing or misfire. Live AI can flag it too, and someone who isn't in danger can continue. BackOnTrack is not a crisis service.
- The Live AI recovery stage has only been tested against a mocked model, not a real one.
- The suggested order and daily plan use fixed rules with chosen weights, not AI, and the weights haven't been tested with users. Time estimates are rough, and steps without an estimate are assumed to take 25 minutes.
- Learning what helps is simple counting, and hasn't been tried with real use over time. Progress after some help doesn't prove that the help caused it.
- BackOnTrack hasn't been tried on a real assignment yet. See the real-case test in [docs/DESIGN_THINKING.md](docs/DESIGN_THINKING.md).
- The real AI model has not been tested, and the public site doesn't use it. See [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).
- No formal user testing has been done, and BackOnTrack's effect on procrastination has not been measured.
- Data stays in one browser, within its storage limit of about 5 MB. Clearing browser data deletes it, so use Export in Settings to keep a backup. The app warns if storage fills up.
- Two tabs open on the same task can overwrite each other's document changes.
- PDFs must contain real text. Scanned PDFs, images, and Word files aren't read.
- The timer stays accurate, but it can't alert you with a sound or notification when it ends.
- Calendar items are hard to read on a phone-width month view. Tapping a day lists its items in full below the calendar.
- Demo Mode uses fixed templates and simple text rules, so it can't understand a task or explain text the way an AI model could.
- Vague-advice, repeat, and high-stakes checks use wording rules, so they can miss cases or flag them wrongly.
- BackOnTrack is not medical, legal, financial, or mental-health advice.

## Documentation

- [Bot design](docs/BOT_DESIGN.md)
- [Design thinking](docs/DESIGN_THINKING.md)
- [Development log](docs/DEVELOPMENT_LOG.md)
- [Privacy and ethics](docs/PRIVACY_AND_ETHICS.md)
- [Test results](docs/TEST_RESULTS.md)
