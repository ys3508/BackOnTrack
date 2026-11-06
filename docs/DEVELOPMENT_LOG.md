# Development Log

Development was carried out with Claude Code, an AI coding assistant, working from the project brief written by the student.

## Starting repository and licensing

`ys3508/BackOnTrack` contained a single commit with a one-line README.

| Candidate | License found (checked 2026-11-05) | Decision |
| --- | --- | --- |
| [albertkupperdev/sapling](https://github.com/albertkupperdev/sapling) | None: no LICENSE file, GitHub reports no license, and the README grants none | **Not used.** No code was copied or read for reuse. |
| [shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template) | MIT | **Selected** |

The template fits the selection criteria: it is MIT licensed, has a working AI SDK integration, reusable shadcn/ui components, Vercel support, and no authentication or database. The first commit on this branch imports commit `4106041` unmodified so that its origin stays visible. The license text is kept in `THIRD_PARTY_NOTICES.md`.

## Technology decisions

| Decision | Reason |
| --- | --- |
| Next.js, React, TypeScript, Tailwind, shadcn/ui | Requested stack, already in the template |
| npm rather than pnpm | pnpm was not installed in the development environment |
| Vercel AI SDK `generateText` with `Output.object` and Zod | Structured output validated against a schema |
| One non-streaming request per stage | Structured data is shown whole, so streaming adds little |
| Claude Haiku 5.5 by default, changeable with `AI_MODEL` | The brief asked for an inexpensive provider |
| Demo Mode runs in the browser | Works with no key, and nothing leaves the browser |
| Summary built from session data, not by the model | A model can't claim work that didn't happen, and it saves a call |
| `localStorage` for session state | Allowed by the brief for v1, and needs no database or accounts |

## What was implemented

- **Removed from the template:** chat UI, message rendering, tools, model picker, web search, dark mode.
- **Kept from the template:** project configuration and the `Button`, `Input`, and `Textarea` components (restyled).

| Area | Files |
| --- | --- |
| Screens | `components/screens/*`, `components/recovery-app.tsx` |
| Schemas and validation | `lib/schemas.ts` |
| Safety rules, repeat detection, built-in steps | `lib/guards.ts` |
| AI prompts and calls | `lib/ai/prompts.ts`, `lib/ai/recovery.ts`, `lib/ai/provider.ts` |
| API and usage limits | `app/api/recovery/route.ts`, `lib/ai/rate-limit.ts` |
| Demo Mode | `lib/demo/scenarios.ts`, `lib/demo/engine.ts` |
| Session state and summary | `lib/session.ts`, `lib/summary.ts` |
| Tests | `tests/*`, `scripts/live-eval.ts` |

## Development challenges

- **Dependency conflict:** the test runner needed a newer `@types/node` than the template declared, so it was raised to version 24.
- **Provider schema limits:** native JSON-schema modes can reject length and array-size keywords. The model-facing schemas omit them, and `normalizeAnalysis` and `normalizeNextStep` enforce the limits after the response arrives.
- **Restoring from browser storage:** `localStorage` isn't available during server rendering, so the app loads only in the browser, which avoids a hydration mismatch.
- **No API key in the development environment:** real-model testing could not be done. See below.

## Changes made during iteration

- Test selectors were corrected to match typographic apostrophes and native disabled buttons. These were test mistakes, not product bugs.
- A switch of strategy partway through a Demo Mode session would have skipped that path's first step. Progress is now counted per strategy.
- The Demo Mode helper was renamed after noticing that the `use` prefix would be mistaken for a React hook.
- On a phone-width screen, the header wrapped to two lines. Button padding was reduced so that it fits on one, and the mode switch's tap targets were enlarged.

## Deployment

The prototype was deployed on 2026-11-05 at https://backontrack-peach.vercel.app, in Demo Mode with no API key.

- **Push to GitHub:** HTTPS pushes had no stored login, so the branch was pushed over SSH using a key already on the development computer. No force push was used.
- **First deployment:** this was made with the Vercel CLI after the student signed in, because `main` didn't contain the app yet. Vercel rejected the folder name for having capital letters, so the project was named `backontrack`.
- **Updating `main`:** the CLI also connected the GitHub repository to the project. Once `main` was fast-forwarded to commit `c657c09`, Vercel redeployed automatically. Commits on `main` now redeploy the site.

## Low-friction intake

The intake was changed on the `feat/low-friction-intake` branch, to reduce the thinking and typing needed before starting.

- **Inputs:** the three free-text details became a date option (with a native date input), and two single-select groups. They stay in a collapsed section, and none is required.
- **Data:** skipped questions are stored as `null`. "No deadline" and "I'm not sure" are separate, explicit answers. Dates are stored as `YYYY-MM-DD` strings and displayed in UTC, so they don't shift by time zone.
- **Reality Check:** `applyIntakeDetails` adds real answers as facts, and "not sure" answers as unknowns, in both Live AI and Demo Mode. A missing deadline becomes an unknown if the analysis doesn't already mention one.
- **Minimum length:** lowered from 10 characters to 3, because the screen now says a few words are enough. "my taxes" was previously rejected.
- **Saved sessions:** `restoreSession` and `migrateIntake` load older sessions and recover from damaged data. Old free text is kept in the user's own words instead of being guessed into an option.

Problems found while testing:

- Space didn't clear a selected option in a real browser, although the automated test passed, because browsers send no click for Space on a checked radio. A key handler now clears it.
- The "Add details" toggle (28 px) and example buttons (38 px) were too small to tap easily, and are now 44 px.
- "Delete my data" cleared storage but left the old text visible when pressed on the intake screen. The form now resets.

## Functional recovery workspace

The `feat/recovery-workspace` branch started from `feat/low-friction-intake`, so it includes that intake work. The project's author had noticed that the wizard advised people without helping them do the task, as described in [DESIGN_THINKING.md](DESIGN_THINKING.md).

### Repositories reviewed

| Repository | License check on 2026-11-05 | Decision |
| --- | --- | --- |
| `fullcalendar/fullcalendar` | MIT | Used its standard npm packages at version 6.1.22. |
| `Georgegriff/react-dnd-kit-tailwind-shadcn-ui` | MIT | Read for its keyboard and announcement pattern. The board was written separately, using `@dnd-kit/core` (MIT). |
| `natuomi/pomodoro` | MIT | Not used. It counts `setInterval` ticks, which the brief ruled out. |
| `ZainnQureshii/flowtask` | No license file, or license detected by GitHub. Its README says MIT. | Not used, because the brief asks for explicit permission. |

### Phases

| Phase | Commit | What was added | Results when completed |
| --- | --- | --- | --- |
| 1. Workspace and tasks | `3f9c86b` | Local-first store, migration, home view, task list and board, task details, settings, export, and deletion | 142 tests passed. Typecheck, lint, and build passed. |
| 2. Focus timer | `e290c7f` | Wall-clock timer, focus view, header timer, session history, and early-stop choices | 160 tests passed. Typecheck, lint, and build passed. |
| 3. Calendar | `38e6f0d` (shared with phase 4) | FullCalendar month and week views, planned sessions, deadline confirmation, and Replan | 174 tests passed. Build passed. Dragging was checked in a real browser. |
| 4. AI recovery | `38e6f0d` (shared with phase 3) | Task context, Live AI and Demo Mode plans, plan checks, preview and acceptance | See below. |
| 5. Testing and docs | Later commits on the branch | Accessibility scan, fixes, and documentation | 226 tests passed. See [TEST_RESULTS.md](TEST_RESULTS.md). |

Phases 3 and 4 share a commit, because the calendar was finished while its browser check was running, and the files overlapped by the time it passed. That commit also went in with one test failing, because of a mistake in my command, which committed regardless of the result. The failure was a duplicate "Progress" label for screen readers. It was fixed in the next commit, and tests were confirmed passing before work continued.

`main` was fast-forwarded to `c6e2747` on 2026-11-05, and Vercel deployed it to the public site. The results are in [TEST_RESULTS.md](TEST_RESULTS.md).

### Decisions

- **Reused existing logic.** Reality Check, the decision cards, safety guards, repeat detection, and the option groups were reused. The wizard stays available at `#/guided`.
- **Local-first, with hash-based views.** There's no database or account. Views use the URL hash, so the browser's back button works, while the timer and data stay in one provider.
- **Preview before change.** A plan is stored as pending on the task. Only "Add selected to my task" applies it, which also lets a pending plan survive a reload.
- **Plans have no way to change a deadline.** The plan schema has no such field.

### Problems found while testing

- Quick add seemed to lose text during a browser test. This was a test mistake: it clicked a visually hidden label, so the field never got focus.
- A timed calendar item showed a stray dot, and was changed to block display.
- The shared high-stakes check missed words such as "essay" and "homework", and now includes them.
- A screen reader would have heard "Progress" twice. The hidden duplicate was removed.
- The guided check-in nested one `main` landmark inside another, which the axe scan found.
- The complete button in the task list was 28 px tall, and now has a 44 px target.

## AI-assisted task execution (version 3)

The `feat/task-execution` branch started from `main` at `4d58986`.

### Repositories reviewed on 2026-11-05

| Repository | License | Decision |
| --- | --- | --- |
| `ueberdosis/tiptap` | MIT | Used directly, through its core packages. |
| `hunghg255/reactjs-tiptap-editor` | MIT | Not used. It brings its own UI, which wouldn't match the existing design. |
| `kcsujeet/ilamy-calendar` | MIT | Not used. The brief said not to rebuild the calendar. |
| `Georgegriff/react-dnd-kit-tailwind-shadcn-ui` | MIT | Already reviewed for version 2. No change. |
| `mozilla/pdf.js` | Apache-2.0 | Used, through `pdfjs-dist`, for reading PDF text in the browser. |

### Phases

| Phase | Commit | What was added | Tests when committed |
| --- | --- | --- | --- |
| 1. Breakdown and subtasks | `7f52194` | Data version 2 with a backup, editable breakdowns, real steps, and "Your next small step" | 248 passed |
| 2. Working editor | `e486af5` | Tiptap document, autosave, export, two-panel layout, backup import, and storage warnings | 260 passed |
| 3. Intake and AI help | `60f67e4` | Paste and file intake, PDF extraction, consent before sending, and six writing actions | 293 passed |
| 4. History and recovery | `9e50c9e` | History kinds, recovery attempts, and plans based on real progress | 306 passed |
| 5. Focus and documentation | `d4b706b` and later | Timer in the task, progress check-in, demo examples, and tests | 315 passed |

### Decisions

- **One document per task, saved as HTML in the existing workspace data.** It's simple and exportable. Saves write straight to storage, because a closing page won't wait for React.
- **Local PDF extraction.** Files stay in the browser, so nothing needs uploading or storing on a server.
- **Suggestions are preview-only until accepted.** Accepted text carries a mark, the version before it is kept, and the previous saved data format is backed up before migrating.
- **Consent per task.** The first Live AI request that includes instructions or a document asks first, and changing the instructions asks again.
- **Progress summaries come from recorded data, not AI.** A model isn't needed to count finished steps, and this way it can't overstate them.

### Problems found by testing

- PDF cleanup called a method on the wrong object, which would have broken every PDF upload. A test with a real PDF caught this.
- "Replace selected text" split the paragraph in two. It now stays inline when replacing within a sentence.
- A reload just after typing could lose the last edit, because saving went through React. Saves are now synchronous.
- The task and the timer both had a "Pause" button, so the timer's is now "Pause timer".
- The text rules glued a whole list into one long step, and joined a heading to the next sentence. They now work line by line.
- Stuck-specific plans were being skipped by a rule that started later in the list. Plans tailored to the task now come first.
- Icons squeezed the step text, so they moved behind an "Edit steps" toggle.
- Demo text read badly, such as "This section is about Write the introduction", and was reworded.

## From task manager to execution support

This followed a review of version 3, on the same `feat/task-execution` branch.

### Decisions

- **Concrete steps in Demo Mode come from fixed wording rules.** They can be wrong, and the interface labels them. Real understanding needs Live AI.
- **Code is for copying, not running.** Running Python in the browser would add a lot for a small gain. Code is labeled as not run.
- **Smaller steps replace only the current step.** Finished work stays, and the user can uncheck the replacement.
- **"Plan remaining work" is arithmetic, not AI.** It's predictable, costs nothing, and is labeled as calculated. It has no way to change a deadline.
- **A step stays in one sitting if a day has room.** Steps that don't fit are reported, not squeezed in.
- **Priority is optional.** Existing tasks keep the priority they have.
- **Under 60 seconds and not finished counts as an interrupted attempt.** It's kept in the history, but left out of focused time and the calendar.

### Problems found by testing

All of these were found in a real browser after the automated tests had passed.

- A second "I'm stuck" offered the same step back as its own next action, which is exactly what the review warned about. Steps that are already small now go smaller.
- Smaller steps could repeat steps already on the list, or be added twice when a plan was accepted. Both are now filtered out.
- A suggested session read "undefined", because that plan had no steps to name it after.
- Splitting a step left the running timer pointing at a step that no longer existed.
- After a code starter, a plan suggested adding "one more sentence" after a line of code.
- The first version of the planner scattered a step across days in 5-minute pieces.

## Easy return and Zero-Start

This followed a product review, on the same branch. The review recommended building these two first. The Failure-Aware Engine and Personal Friction Map are longer-term, and weren't started.

### Decisions

- **"Away" is based on when the app was last opened, for 3 days or more.** Basing it on task activity would treat someone who opens the app daily as absent. The threshold is a judgment call, and hasn't been tested.
- **Old data and first use never trigger the return screen,** because no last-opened time exists yet.
- **The return screen doesn't call AI.** Opening the app shouldn't send anything anywhere, so its small suggestion uses a labeled built-in rule.
- **Choosing an entry point counts as accepting.** It replaces "Use this", and the document can still be edited first. Suggested steps still wait for their own approval.

### Problems found by testing

All of these were found in a real browser after the automated tests had passed.

- After choosing an entry, the cursor landed on the list rather than in its text. It now selects the first placeholder.
- A new paper's first action was "Find the submission page", from whichever step came first.
- Text typed over a placeholder kept the "suggested" highlight, so the user's own words looked like a suggestion. Typed text is now never marked, anywhere in suggested text.

## Failure-aware learning

### Decisions

- **Counting, not machine learning.** With a handful of records in one browser, counting is explainable and honest, and a trained model wouldn't have enough data.
- **A separate log that holds no text.** It stores event type, time, task ID, task kind, whether the document was empty, and outcomes. Deleting a task removes its records.
- **"Progress" means a finished step, a real focus session, or at least 5 of the user's own words.** Accepted suggestions and code blocks don't count, so accepting help can't count as its own success. Editing code isn't detected, which undercounts coding work.
- **Task kind comes from wording,** so it can be wrong.
- **Preference options are limited to ones that change something,** so no choice is silently ignored.

### Problems found by testing

- Clicking "I'm stuck" three times in a minute produced a "pattern", found in a real browser. Events on one task within an hour now count once.
- A plan's note quoted a different pattern from the one behind its choice.

## Suggested order and Daily Rescue Plan

### Decisions

- **One scoring function** for the home page's suggestion, the Tasks order, and the daily plan, so they don't disagree.
- **Time estimates are optional.** Without one, a task's open steps count as 25 minutes each, and any risk warning says it's a rough guess.
- **Marking an item done for today doesn't complete the task.** A day's plan and a task's status are separate.
- **The plan is only offered with two or more tasks,** since there's nothing to arrange otherwise.

### Problems found by testing

Both were found by trying a realistic scenario in a real browser, after all automated tests had passed.

- A high-priority task due tomorrow, needing 4 hours, got 10 minutes because it had been missed before, while 40 minutes went to tasks that could wait. Urgent work now gets the time.
- A 5-minute email was described as "Break it into small steps". Tasks with no steps are now named plainly.

## Phase 1: Adaptive Recovery Workspace

### Decisions

- **A recovery case is a field on the task, not a new store.** Status, deadline, document, timer, history, and Calendar all keep working, with no migration. Older saved data restores with no case. A damaged case is dropped without losing the task.
- **One status.** A case's status is worked out from the task, so Recovery and Tasks can't disagree. The task's next action and the case's current step are kept the same.
- **One workspace.** Tools are chosen from the blocker, plus any a Plan B opened. Changing the blocker changes only which tools show.
- **Rules decide what must hold.** A model can't skip the user's choice of Finish, Reduce, or Release. Claimed facts must come from the user's text, and repeats, vague steps, and invented rules get one retry, then a labeled template.
- **A "make it smaller" choice stays out of the URL,** so a reload or the back button can't repeat it.
- **The old dashboard moved to `#/today`** rather than being removed.

### Problems found by testing

The first three came from trying the flow in a real browser after the automated tests passed. The last was caught by a new test.

- A Plan B step threw away the plan's later steps, so finishing the smaller step led to a dead end. Swapping a step now leaves the later ones alone.
- "Make it smaller" from the resume prompt stayed in the URL, so reloading would have shrunk the step again.
- "Continue" on the resume prompt was followed by the same question inside the case.
- Finishing the last quick item removed the list holding its "Undo".

## Testing evidence

See [TEST_RESULTS.md](TEST_RESULTS.md).

## Known limitations

- **The real AI model has not been tested, including the new recovery engine.** See [TEST_RESULTS.md](TEST_RESULTS.md) for what was verified instead.
- The public site runs in Demo Mode, with no API key, so its suggestions are templates. Version 3 isn't on it until the `feat/task-execution` branch is merged.
- Browser storage is limited to about 5 MB per site, and a long document uses more of it. The app warns when a save fails, and backups can be exported and imported.
- If two tabs edit the same task, the last save wins.
- Documents have one earlier version kept, from before the last accepted suggestion. There's no full version history.
- Requirement extraction in Demo Mode uses text rules, so it can miss or misread requirements. The interface says to check.
- Citation checks look for common citation and link patterns, so unusual formats can get through.
- The timer can't alert the user when it ends, beyond the screen and tab title.
- On a phone-width month view, calendar titles are cut off, although tapping a day lists them in full.
- A person dragging Kanban cards by hand hasn't been tested. Keyboard dragging and simulated pointer dragging worked.
- The Vercel AI Gateway option has not been exercised at all, and its default model ID is unconfirmed.
- The public deployment runs in Demo Mode only. Live AI has not been run on it.
- Copy and Download have not been confirmed on the public site in a normal browser.
- The repeat check compares wording and approach labels. A model could still label a similar step differently and pass.
- Keyword-based high-stakes and crisis detection will have false positives and false negatives. For example, it recognizes "exam" and "bill", but not every phrasing.
- Rate limits are stored in memory per server instance and reset on restart.
- Saved sessions are not encrypted, and they are readable by anyone using the same browser profile.
- Demo Mode can't respond to the specifics of custom text. It records and displays intake details, but its prewritten decision and steps don't change based on them, and it says so.
- Live AI could restate an intake answer that the app also adds to the Reality Check. The prompt tells it not to, but this hasn't been tested with a real model.
- Text typed on the intake screen is saved only after submitting, so an unsubmitted draft is lost on reload.
- A full automated accessibility audit and a screen-reader test have not been done. Color contrast, labels, and focus handling were considered, and the contrast of the main color pairs was measured.
- No testing with real users has been done.
