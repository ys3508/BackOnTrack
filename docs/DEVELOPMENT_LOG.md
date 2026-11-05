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

## Testing evidence

See [TEST_RESULTS.md](TEST_RESULTS.md).

## Known limitations

- **The real AI model has not been tested, including the new recovery engine.** See [TEST_RESULTS.md](TEST_RESULTS.md) for what was verified instead.
- The workspace isn't on the public site until this branch is merged.
- The timer can't alert the user when it ends, beyond the screen and tab title.
- Importing an exported file isn't supported.
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
