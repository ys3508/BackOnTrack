# Design Thinking

This document follows the five stages: Empathy → Define → Ideate → Prototype → Test.

> **Note on evidence.** No interviews or user studies were carried out while this prototype was built, and none are claimed here. The Empathy and Define sections restate the project brief as working assumptions. **Student to complete:** add your own preliminary research, prompt experiments, and sources in the marked section below.

## 1. Empathy

### Target users

People who have stopped following a plan and now find it hard to return to it. Examples from the project brief include job seekers who have stopped applying and students who have missed a deadline.

### Pain points (working assumptions from the brief)

- Avoiding an important responsibility, and having unfinished tasks pile up.
- Feeling increasingly overwhelmed as time passes.
- Tools that respond with overdue lists, reminders, or new plans, which address organization rather than the reason a person stopped.
- Treating worst-case predictions as if they were facts.
- Not knowing what is still possible.

### Student research (to be completed)

*Add your preliminary user research, prompt experiments, and AI-assisted research on procrastination and avoidance here, with citations. These materials were not available when this document was drafted.*

## 2. Define

### Problem statement

People who have fallen behind on an important responsibility need a way to understand what is actually true and restart with a realistic action, because existing productivity tools mostly help with planning and offer little for the moment after a plan has failed.

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

The prototype is a working Next.js web application with:

- A Recovery Intake with three samples and no sign-up.
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
- A script (`npm run test:live`) for running Tests A, B, and C against the real AI model.

Actual results and what has not yet been tested are in [TEST_RESULTS.md](TEST_RESULTS.md). No testing with real users has been done. A sensible next step would be to observe a few real users trying it, and to ask whether the one-step format helped them restart.

## Ethical considerations

- **Honesty:** Demo content is labeled as prewritten, and the app never presents it as AI output. If live AI fails, the app shows an error rather than quietly substituting demo content.
- **Agency:** The AI recommends and the user decides. Overrides are respected and recorded.
- **Avoiding harm:** The app doesn't diagnose or shame. RELEASE is never the recommendation for a detected high-stakes obligation.
- **Crisis language:** The app isn't a support service. If crisis language is detected, it points to human help, such as 988 in the US and Canada.
- **Privacy:** See [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md).
