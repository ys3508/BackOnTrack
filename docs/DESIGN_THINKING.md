# Design Thinking

This document follows the five stages: Empathy → Define → Ideate → Prototype → Test.

> **Note on evidence.** No interviews or user studies were carried out while this prototype was built, and none are claimed here. The Empathy and Define sections restate the project brief as working assumptions. **Student to complete:** add your own preliminary research, prompt experiments, and sources in the marked section below.

## Iteration: from "Recovery Advice Assistant" to "Functional Recovery Workspace"

This project has been through the design cycle twice. The first prototype was a five-step wizard that helped people think through a stuck task. The second is a working task manager with recovery built in.

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
