# Bot Design

Answers to the instructor's ten design questions. The rules described here are in `lib/ai/prompts.ts` and `lib/guards.ts`.

## 1. What is the bot's objective?

To help someone who is stuck on a real task get moving again, by working out what is true, choosing what to do about it, and producing something they can use right away, such as a draft message, a worksheet, or a schedule.

The AI is one part of a working task manager with a focus timer and calendar. It isn't a general-purpose chatbot, and the app stays useful without it.

## 2. What information should it use?

- The selected task's recorded data: title, description, deadline, status, progress, previous attempts, completed actions, focus sessions, and reported obstacles.
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

## 4. How should it engage with users?

It is calm, plain, and direct, without motivational slogans or exclamation marks. Interaction happens through purpose-built screens and controls rather than a chat thread. It explains its reasoning and states what it does not know. The user makes the decisions and can override any recommendation.

## 5. Will images or other data be involved?

No. The bot works only with text. Interface icons are decorative. Uploads are not accepted.

## 6. How should it start?

The app opens on a workspace, with no onboarding and no registration. The AI only joins in when someone asks for help on a task, using "I'm stuck" or "Recover a Task". It then offers one optional question about what's in the way, and a button to get a plan.

The earlier guided check-in is still available. It starts with "What's been weighing on you?", and a few words are enough.

## 7. What steps should it follow?

1. **Read the task's data.** The app assembles what's recorded, within fixed size limits.
2. **Reality Check:** separate known facts, assumptions, unknowns, and consequences (confirmed or uncertain). The app adds facts it knows for certain, such as the recorded deadline.
3. **Recovery Decision:** suggest Finish, Reduce, or Release, with reasoning and uncertainty. The user can choose any option, and the plan is rewritten for it.
4. **Plan:** give one next step and a usable draft, with optional steps and work sessions.
5. **Preview:** the user edits the draft and chooses which parts to keep. Nothing changes until they accept.
6. **Adapt:** "Still stuck" must produce a different plan. The server rejects a step that repeats an earlier one or asks for reflection. The model gets one corrected retry, and after that a clearly labeled built-in template is used.

## 8. How should it conclude?

The user accepts the parts they want, and these become the task's next action, steps, notes, and planned work. Or they decline, and only the history records it. Either way, they return to the task, and the AI's part is over. The task's history records what was accepted and where it came from (Live AI or a Demo Mode template).

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

Actual results are in [TEST_RESULTS.md](TEST_RESULTS.md).
