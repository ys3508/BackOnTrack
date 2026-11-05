# Design Thinking

This document follows the five stages: Empathy → Define → Ideate → Prototype → Test.

> **Note on evidence.** No interviews or user studies were carried out while this prototype was built, and none are claimed here. The Empathy and Define sections restate the project brief as working assumptions. **Student to complete:** add your own preliminary research, prompt experiments, and sources in the marked section below.

## How the product evolved

| Version | What it was | Limitation that led to the next version |
| --- | --- | --- |
| 1. AI Recovery Assistant | A five-step guided workflow: Reality Check, a decision, one step at a time, and a summary | It advised people, but left them with nothing to act on or return to. |
| 2. Productivity workspace | Persistent tasks, calendar, focus timer, and recovery plans | It could organize work, but the work itself still happened elsewhere. Suggestions stayed abstract. |
| 3. AI-assisted task execution | Each task has instructions, editable steps, a working document, writing help, adaptive recovery, and honest progress history | Not yet tested with real users or a real AI model. |

The review of version 3 led to a fourth stage of the same idea, on the same branch.

| Stage | What the user gets | What was still missing |
| --- | --- | --- |
| Advice chatbot | Suggestions on what to do | The work still started from nothing |
| Task manager | Tasks, a calendar, and a timer | It organized work, but didn't reduce the effort of starting |
| Execution-supporting assistant | A workspace prepared for the step, which adapts when the user is stuck | Whether this really helps on real work is untested |

### Positioning

A later review argued that calendars, timers, Kanban boards, and task breakdown aren't enough to set BackOnTrack apart, since other apps offer them. It named Goblin Tools, Tiimo, Focusmate, and Llama Life as examples. Those comparisons come from the review, and weren't checked independently for this document.

The loop BackOnTrack targets is: plan → don't do it → feel pressure → avoid the app → tasks pile up → harder to restart.

| Idea from the review | Status | Note |
| --- | --- | --- |
| **Return Without Catching Up** | Built | One way back in, using only recorded facts |
| **Zero-Start Mode** | Built | Prepared requirements, questions, outline, and first section |
| Failure-Aware Engine | Built, simply | Counts recorded moments across tasks, and changes which help comes first. It isn't machine learning, and hasn't been tried with real use over time. |
| Personal Friction Map | Partly built | The Settings card lists what's been noticed, with evidence and controls. There's no map or wider analysis. |
| Avoidance Debt Radar | Not built | Sorting by consequence must rest on verifiable information, not AI guesses |
| Plan B Simulator | Not built | Paths to switch to, decided before anything fails |

Decisions on the return screen, all aimed at not adding pressure:

- It shows no overdue count, no time-away figure, and no streak. It's based on when the app was last opened.
- It doesn't hide consequences entirely. It states the deadline of the task being resumed, and one other deadline if it's due today or tomorrow. Leaving those out could cost someone a real deadline.
- Nothing about deadlines or tasks changes because someone was away.

Decisions on learning from failed attempts:

- **It learns about the help, not the person.** It records which approach was followed by progress, and it never labels anyone.
- **It needs 3 separate moments in 60 days.** Events on one task within an hour count once, so one bad afternoon isn't a pattern. These thresholds are judgment calls, and haven't been tested.
- **Everything is stated as a guess, with its evidence.** "Progress after it" is a correlation, so the app says it doesn't prove the cause.
- **The user has the last word.** A stated preference beats anything inferred, and "This isn't right" stops a pattern from being used.
- **It offers, and doesn't impose.** A hint can be ignored, and a plan's note explains any change.

### From workspace to task manager

A third review narrowed the product: BackOnTrack shouldn't try to be a chatbot or do the work. Its value is in deciding what to do now, arranging tasks, and adjusting when a plan fails. This moves the emphasis away from the first review, which made the Task Workspace the core page. It's a change of direction, not a contradiction, and the real-case test still hasn't shown which emphasis helps more.

| Idea from the review | Status | Note |
| --- | --- | --- |
| Intelligent Prioritization | Built, with rules | Uses deadline, priority, progress, and plans, and shows the reasons. |
| Daily Rescue Plan | Built, with rules | Time is the only required input. Energy can be skipped. |
| Adaptive Planning | Partly built | The daily plan rethinks unfinished work and states risks. It doesn't yet re-plan the whole calendar or detect conflicts. |
| Failure-Aware Recovery | Built | See above. Asking whether to shrink a repeatedly moved task is there. Asking about late submission isn't. |
| New roles for the four pages | Partly done | Home gained the daily plan and Tasks the suggested order. Calendar and Focus are unchanged, and the document hasn't been moved to a secondary place. |

**Why it's rules and not AI.** The review calls this an "AI" task manager. Ordering and planning use fixed rules for now, because they have to be explainable, instant, free, and able to work with no API key. The interface says so. AI is used for recovery plans, breakdowns, and writing help with Live AI. Calling the whole product "AI-powered" would overstate what orders the tasks.

Decisions on the plan:

- **What's due within a day gets the time it needs, up to all that's available.** A quick task goes first only if that still leaves enough time for it.
- **Plans cover only part of the time available:** about 80%, or 60% on a low-energy day. These figures are judgment calls.
- **Unfinished work is rethought rather than moved.** It restarts with something smaller, and nothing is marked overdue.
- **Risks are stated, and deadlines are never changed.**

### What success means, and how to test it

Completed tasks, focus minutes, and streaks measure activity, not whether someone got unstuck. These measures come from the review. **None has been measured yet**, and the app doesn't collect them.

| Measure | Question | How to test it |
| --- | --- | --- |
| Time to First Action | How long from opening the app to starting real work? | Time testers on the guided check-in and on Zero-Start, using the same task |
| Recovery Success Rate | After reporting being stuck, do they start again? | Note whether they do something real after accepting a plan, and how many plans it took |
| Return-to-Action Rate | After a break, can they continue existing work? | Set up a task with progress, leave it for several days, and note whether they continue |

Compare the original advice flow with Zero-Start, looking at actual progress rather than clicks. **Student to complete:** run this with testers, ideally including adults with lived experience of ADHD. Results shouldn't be described as clinical effects.

### Where the evidence comes from

| Kind | What's here |
| --- | --- |
| **Actual user feedback** | None from other people has been recorded. **Student to complete:** add any test sessions or feedback you've collected. |
| **Developer observations** | The project's author reported that "I haven't finished my homework for a long time" produced "Write the part of this that matters most, in a single line", which leaves the person to work out what to do. They also observed that version 2 could organize tasks without helping to perform them. Browser testing during development found the bugs listed in the development log. |
| **Planned capabilities** | Testing with a real AI model and real users, sync between devices, importing Word files, and timer alerts. None of these exist yet. |

### Review of version 3

The project's author reviewed version 3 by using it. This is one person's review, not a user study.

| Review point | Change | Kind of evidence |
| --- | --- | --- |
| The task page should be the core, and AI should reduce the work needed to start | Primary buttons now lead to a prepared workspace | Review |
| Steps were still too abstract, so "train classifier" gives no way in | "Help me do this" gives a concrete first action, such as "Open the dataset and identify the target column" | Review |
| The focus timer was separate from the work | "Start 5 minutes" opens the step's document, with a small timer on top | Review |
| Plan B should use finished steps, failed attempts, and the deadline, and "think about how to train a classifier" counts as failure | Repeated "I'm stuck" makes the step smaller, or gives a code starting point. Finished steps and the deadline stay as they are. | Review |
| The calendar should plan the work left | "Plan remaining work" proposes sessions, and adds them only once confirmed | Review |
| A required-looking priority, and a 2-second session counted as focus | Priority is optional, and sessions under a minute are interrupted attempts | Review |

### Real-case test (not run yet)

**Student to complete.** Try BackOnTrack on one real, unfinished small assignment, and record the answers here:

1. Did it correctly understand what has to be submitted?
2. Did it give you a workspace you could act in straight away?
3. When you clicked "I'm stuck", did it really make the work easier?

Run this with Live AI if possible, because Demo Mode only uses wording rules. No results are claimed until this has been done.

### Version 3 design rationale

The product's philosophy became: "Less planning. Less switching between apps. More actual progress."

| Observed limitation | Change | Why |
| --- | --- | --- |
| Advice was too abstract | Plans and steps must produce something, and vague advice is rejected | Starting is easier with something concrete on the page |
| Work happened in other apps | A working document in every task | Switching apps is another chance to stop |
| Long lists could overwhelm | The home page shows one small step, and the full list is opened on request | Fewer decisions before beginning |
| A blank page is hard to begin | Openings to pick from, and outlines from the instructions | Editing is easier than starting, and the writer stays the author |
| A repeated suggestion doesn't help | Recovery uses the current step, document, and what's already failed | A different approach is more useful than the same one again |
| Time isn't the same as progress | One question after a session, and history that separates suggested, accepted, tried, and done | The record should match what happened |

Tradeoffs: rich features add complexity, so instructions and task settings stay collapsed until needed. Academic help carries an integrity risk, so suggestions stay marked, and invented citations are rejected.

## Iteration: from "Recovery Advice Assistant" to "Functional Recovery Workspace"

The first prototype was a five-step wizard that helped people think through a stuck task. The second is a working task manager with recovery built in.

### What prompted the change

While reviewing the first prototype, the project's author noticed a practical gap. Someone who said they had avoided homework would be asked to write what mattered most. That's a reasonable reflection, but it doesn't help them do the homework. When the wizard ended, they still had no plan on file, no draft, and no time set aside, and they had to start over the next time.

**About this evidence:** this came from the author's own review of the prototype. It was not a formal user study, and there were no recruited participants. The first version's workflow tests checked that the wizard behaved as designed, and couldn't show whether it was useful, which is why this review mattered.

**Student to complete, if applicable:** *if you ran any test sessions with other people, record how many, what they did, and what you observed here.*

### How each stage changed

| Stage | First iteration | Second iteration |
| --- | --- | --- |
| **Empathy** | Focused on the feelings around avoidance, such as overwhelm and catastrophizing. | Also considers the practical moment: a person with little energy to begin needs something to act on, and shouldn't have to re-enter their situation each time. |
| **Define** | People need to understand what's true, and restart with one realistic action. | People need that understanding *and* somewhere to do the work, with their progress kept. Advice with no output doesn't solve the problem. |
| **Ideate** | Compared a chatbot, task manager, reminders, and a guided workspace, and chose the guided workspace. | Revisited the task manager idea, with its risk of overwhelming lists managed by showing one next action and short lists. Added a timer and calendar, because starting and scheduling are where plans tend to fail. |
| **Prototype** | Six-screen wizard with Live AI and Demo Mode. | Persistent workspace with tasks, focus, and calendar, which all work without AI. Recovery uses a task's real data and produces drafts, steps, and schedules, which the user previews. |
| **Test** | Automated workflow tests, with browser checks. | The same, plus the Definition of Done as one end-to-end test, an automated accessibility scan, and real-browser checks of timing, dragging, and layout. Real-user testing is still outstanding. |

### What stayed

Reality Check, Finish/Reduce/Release, and failure-aware Plan B were kept, and now appear when someone is stuck on a specific task. The safety rules, honest labeling, and user agency also carried over, and were extended: AI suggestions now need confirmation, and deadlines never change as a side effect.

## 1. Empathy

### Target users

People who have stopped following a plan and now find it hard to return to it. Examples from the project brief include job seekers who have stopped applying and students who have missed a deadline.

### Pain points (working assumptions from the brief)

- Avoiding an important responsibility, and having unfinished tasks pile up.
- Feeling increasingly overwhelmed as time passes.
- Tools that respond with overdue lists, reminders, or new plans, which address organization rather than the reason a person stopped.
- Treating worst-case predictions as if they were facts.
- Finishing a planning or reflection exercise and still having nothing to act on.
- Not knowing what is still possible.

### Student research (to be completed)

*Add your preliminary user research, prompt experiments, and AI-assisted research on procrastination and avoidance here, with citations. These materials were not available when this document was drafted.*

## 2. Define

### Problem statement

People who have fallen behind on an important responsibility need a way to understand what is actually true and restart with a realistic action, in a place where they can do the work and keep their progress. Existing productivity tools mostly help with planning and offer little for the moment after a plan has failed, and advice alone leaves the task as it was.

### Design principles

- Recovery instead of perfect planning.
- Action instead of endless advice.
- Reality instead of catastrophizing.
- Adaptation instead of rigid schedules.
- One manageable step instead of long to-do lists.
- User agency instead of AI making decisions for the user.

## 3. Ideate

| Idea | Strength | Weakness | Outcome |
| --- | --- | --- | --- |
| General chatbot with a recovery prompt | Quickest to build | Tends toward long advice; easy to keep talking instead of acting; can't guarantee the behavior | Rejected |
| Task manager with AI breakdown | Familiar format | Risks recreating the overwhelming list | Rejected |
| Reminder and accountability tool | Simple concept | Adds pressure and does not explain why the person stopped; notifications are out of scope | Rejected |
| Structured recovery workspace | Enforces the desired behavior through its screens | Less flexible than open chat | **Selected** |

### Selection rationale

A structured workspace turns the product principles into constraints. Showing only one action means a long list can't appear. Separate fields for facts, assumptions, and unknowns require the model to make those distinctions. Building the summary from recorded events means that it can't claim work that didn't happen. A server check enforces that Plan B must differ, instead of relying only on the prompt.

## 4. Prototype

The current prototype is described in the iteration section above, and in the [README](../README.md). The guided check-in from the first iteration remains available inside it, with:

- A Recovery Intake with three samples and no sign-up. Optional details are one-click choices in a collapsed section, intended to reduce typing and decisions before starting. This design goal hasn't been tested with users, including people with ADHD.
- A Reality Check with known facts, assumptions, unknowns, and consequences.
- A Recovery Decision (Finish, Reduce, or Release) with reasoning, uncertainty, and override. Releasing a high-stakes obligation requires an explicit acknowledgement.
- A One-Step Workspace with a text box and three actions.
- Failure-aware Plan B behavior with repeat detection.
- A Recovery Summary with copy, download, and delete.
- Live AI through a server API, and a clearly labeled Demo Mode that works without an API key.

## 5. Test

### Approach

- Automated tests of the safety rules, repeat detection, demo paths, API validation, failure handling, and summary accuracy.
- A full walkthrough of the interface in an automated test and in a real browser, on desktop and at phone width.
- A script (`npm run test:live`) for running the required scenarios against the real AI model.
- The Definition of Done as one end-to-end automated test, and an automated accessibility scan of each view.

Actual results and what has not yet been tested are in [TEST_RESULTS.md](TEST_RESULTS.md). No testing with real users has been done. A sensible next step would be to observe a few real users trying it, and to ask whether the one-step format helped them restart.

## Ethical considerations

- **Honesty:** Demo content is labeled as prewritten, and the app never presents it as AI output. If live AI fails, the app shows an error rather than quietly substituting demo content.
- **Agency:** The AI recommends and the user decides. Overrides are respected and recorded, and AI changes need the user's confirmation.
- **Not assuming needs:** The design aims to reduce friction for people who struggle with task initiation, including some people with ADHD. It doesn't assume they share the same needs, and hasn't been tested with them, so it makes no claims about ADHD outcomes.
- **Avoiding harm:** The app doesn't diagnose or shame. RELEASE is never the recommendation for a detected high-stakes obligation.
- **Crisis language:** The app isn't a support service. If crisis language is detected, it points to human help, such as 988 in the US and Canada.
- **Privacy:** See [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md).
