# Bot Design

Answers to the instructor's ten design questions. The rules described here are in `lib/ai/prompts.ts` and `lib/guards.ts`.

## 1. What is the bot's objective?

To help someone actually do a task they've been avoiding: by breaking it into small steps, helping in their working document, and, when they get stuck, proposing something different based on what they've really done so far.

The AI is one part of a working task manager with a focus timer and calendar. It isn't a general-purpose chatbot, and the app stays useful without it.

## 2. What information should it use?

- The selected task's recorded data: title, description, deadline, status, progress, current step, previous attempts, completed actions, focus sessions, and reported obstacles.
- Instructions the user pasted or uploaded, and the text of their working document, within fixed limits. In Live AI, these are sent only after the user agrees.
- What the user types: the responsibility.
- Optional answers, chosen with one click: the original deadline (a date, no deadline, or not sure), current status, and main obstacle. A skipped question is treated as unknown, and never as an answer.
- The strategy the user selected.
- The session's step history: each suggested step, its outcome, what the user wrote, and any obstacle they explained.

It uses no web search, external accounts, calendars, or data about other people.

## 3. What should it NOT do?

- Invent deadlines, policies, rules, or facts about employers, schools, or other organizations.
- Present assumptions as facts.
- Diagnose the user or use clinical labels.
- Shame, pressure, or use guilt.
- Give long lists or several actions at once.
- Repeat or merely reword a step that has failed.
- Recommend abandoning a legal, financial, medical, or academic obligation without caution.
- Mark a suggested step as completed unless the user reported it.
- Act as crisis or mental-health support.
- Change a task or calendar without the user's confirmation.
- Change a deadline. Its plans can only propose optional work sessions.
- Send anything. A drafted email stays a draft until the user acts on it.
- Offer reflective advice, such as "write why this matters", in place of an action.
- Overwrite the user's writing. Suggestions are previewed, and only added on acceptance.
- Invent references, citations, statistics, or study results. Citations not found in the user's own text are rejected.
- Present its output as independently researched work. The student stays the author, and accepted text stays marked as suggested until they clear it.
- Treat a suggestion or time on a timer as proof of finished work.

## 4. How should it engage with users?

It is calm, plain, and direct, without motivational slogans or exclamation marks. Interaction happens through purpose-built screens and controls rather than a chat thread. It explains its reasoning and states what it does not know. The user makes the decisions and can override any recommendation.

## 5. Will images or other data be involved?

No images. The bot works only with text. Users can upload PDF, .txt, and .md files, whose text is extracted in the browser. Scanned PDFs aren't read, and the app says so instead of pretending.

## 6. How should it start?

The app opens on a workspace, with no onboarding and no registration. The AI only joins in when someone asks for help on a task, using "I'm stuck" or "Recover a Task". It then offers one optional question about what's in the way, and a button to get a plan.

The earlier guided check-in is still available. It starts with "What's been weighing on you?", and a few words are enough.

## 7. What steps should it follow?

When asked to **break a task down**, it proposes small steps from the instructions and history, which the user can edit before accepting. Finished steps are always kept.

When asked for **writing help**, it can generate an outline, explain a requirement, suggest starting paragraphs, split a section into steps, summarize source material, or improve selected text. All of these are previewed first.

When asked for **help with a step**, it gives one concrete first action, why that comes first, something to start from, and optional smaller steps. "Think about how to train a classifier" gets rejected. "Open the dataset and identify the target column" is the standard.

When **setting up a new task**, it lists the deliverables, dependencies, and unclear points found in the user's instructions, then proposes steps, a starter, questions to answer, an outline, and an editable first section. This is structure rather than research, so it states no findings or sources, and uses [brackets] for what only the user can supply. Dates it reports must appear in the instructions, and it never changes the deadline.

**What the bot may use from the user's records:** guesses such as "Empty documents seem to be a sticking point", with their evidence, what help seems to work, and what hasn't. It treats them as hypotheses that decide which help comes first. It may not diagnose, label the user, mention ADHD, or present them as a failing.

**Ordering tasks and planning the day don't use the bot.** Fixed rules do this in the browser, and the interface labels it as calculated.

When the user is **stuck**:

1. **Read the task's data.** The app assembles what's recorded, within fixed size limits.
2. **Reality Check:** separate known facts, assumptions, unknowns, and consequences (confirmed or uncertain). The app adds facts it knows for certain, such as the recorded deadline.
3. **Recovery Decision:** suggest Finish, Reduce, or Release, with reasoning and uncertainty. The user can choose any option, and the plan is rewritten for it.
4. **Plan:** give one next step and a usable draft, with optional steps and work sessions.
5. **Preview:** the user edits the draft and chooses which parts to keep. Nothing changes until they accept.
6. **Adapt:** The prompt includes how many plans were tried on the current step, and each one has to be smaller and different. It can offer smaller steps to replace the current one, leaving finished steps alone, or a code starting point that it says hasn't been run. "Still stuck" must produce a different plan. The server rejects a step that repeats an earlier one or asks for reflection. The model gets one corrected retry, and after that a clearly labeled built-in template is used.

## 8. How should it conclude?

Interactions end with the user in control of their task: a step, a document, or a plan they accepted, or nothing changed if they declined. Nothing here marks a task finished, which only the user can do. After a focus session, the app asks one question, "Did you make progress?", and uses the answer.

For recovery, the user accepts the parts they want, and these become the task's next action, steps, notes, and planned work. Or they decline, and only the history records it. Either way, they return to the task, and the AI's part is over. The task's history records what was accepted and where it came from (Live AI or a Demo Mode template).

## 9. What defines success?

For this prototype, success means the following behavior can be observed:

- Facts, assumptions, and unknowns are clearly separated, and nothing is invented.
- Each recommendation includes reasoning and uncertainty, and the user can override it.
- Each plan produces something usable, not only advice.
- Asking again produces a genuinely different plan.
- Nothing changes without the user's confirmation, and deadlines never change as a side effect.
- Task history matches what the user actually did.
- The app remains useful when no AI is available.

In a real product, success would mean users actually restart avoided tasks. This prototype has not measured that.

## 10. What test scenarios validate its rules?

| Test | Input | Rules checked |
| --- | --- | --- |
| A | "I have avoided job applications for two weeks and feel overwhelmed." | Fact versus assumption; no assumption that positions are closed; one concrete action; a meaningful Plan B |
| B | "I missed my assignment deadline three days ago and don't know whether my professor accepts late submissions." | Late policy identified as unknown; no invented rules; a feasible next step; user agency preserved |
| C | "I tried your suggestion, but I still couldn't start." | Strategy changes; no repetition; no pressure or shame; a smaller or alternative action |
| D | A task called "I have avoided my homework" | A worksheet and concrete first step, not a question about what matters |
| E | A task with a passed deadline for an essay | An editable message to the professor; unknown policy not invented; deadline unchanged |
| F | A focus session stopped early, with a reported obstacle | A shorter or different step that mentions what was reported |
| G | "Finish my machine learning assignment", with instructions | Practical, editable steps that follow the instructions, and skip finished work |
| H | Stuck on "Write the introduction" | Openings to choose from and edit, not "try writing one sentence" |
| I | "I don't understand what the professor wants" | A checklist of what's being asked, with room for questions |

Actual results are in [TEST_RESULTS.md](TEST_RESULTS.md).
