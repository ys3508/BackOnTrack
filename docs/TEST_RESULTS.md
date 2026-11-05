# Test Results

Tests were run on 2026-11-05 on macOS with Node.js 24. This document lists only tests that were actually executed. Anything not executed is listed as such.

## Summary

| Check | Result |
| --- | --- |
| TypeScript (`npm run typecheck`) | Pass, no errors |
| ESLint (`npm run lint`) | Pass, no errors or warnings |
| Production build (`npm run build`) | Pass |
| Automated tests (`npm test`) | Pass, 226 of 226 |
| Demo Mode in a real browser, without an API key | Pass |
| Live code path against a **local fake API server** | Pass (wiring only) |
| **Tests A, B, C against the real AI model** | **Not run: no API key was available** |
| Deployment to Vercel, in Demo Mode | Pass, publicly reachable at https://backontrack-peach.vercel.app |
| Workflow on the public URL | Pass, except that Copy and Download are unconfirmed there |

## What "live" testing does and doesn't show

No real AI model has been called. The following were verified instead:

- Automated route tests use the AI SDK's mock model.
- A manual test ran the production build with the real Anthropic SDK client over HTTP, against a throwaway local server returning canned answers.

These show that requests, validation, safety rules, retries, and error handling work. **They don't show how good the real model's answers are.** To complete this evidence, add an API key, run `npm run test:live`, read `docs/live-eval-output.json`, and fill in the table below.

## Functional recovery workspace

These tests were run on 2026-11-05 on the `feat/recovery-workspace` branch. "Automated" means the Vitest suites in `tests/`. "Browser" means a production build run locally in Chromium with no API key. No real AI model was involved, so these results don't show the quality of real AI suggestions.

### Definition of Done

`tests/recovery-workspace.test.tsx` runs these steps as one continuous test in Demo Mode:

| Step | Actual observed behavior | Pass/Fail |
| --- | --- | --- |
| 1. Add a real task | Added with quick add. | Pass |
| 2. See it in the workspace | Appeared as the one next thing. | Pass |
| 3. View or modify its deadline | Changed in the task, and saved. | Pass |
| 4. Start a focus session for it | Timer started, and the task moved to In Progress. | Pass |
| 5. Pause and resume work | Pause stopped the clock, and Resume restarted it. | Pass |
| 6. Mark progress | Set to 40%, and recorded in the history. | Pass |
| 7. Request a recovery plan after getting stuck | A plan appeared, with no change to the task yet. | Pass |
| 8. Accept or reject suggestions | Accepting applied the edited draft, steps, next action, and sessions. Other tests cover partial acceptance and declining. | Pass |
| 9. View updated task and session history | Showed the session, the obstacle, and the accepted plan with its source. | Pass |
| 10. Return later and continue | After a remount, the progress and draft were still there. | Pass |

### Features

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| Task management (automated) | Create, edit, pause, resume, complete, delete | All work with no AI | All worked. Demo Mode made no POST requests in the end-to-end test. | Pass | None |
| Six task states (automated) | Move through each state | All supported | All supported, with history entries. | Pass | None |
| Kanban by keyboard (browser) | Space, 10 × Right arrow, Space | Card moves and is announced | Moved to In Progress. "Moved Apply for two jobs to In Progress." was announced. | Pass | None |
| Kanban by pointer (browser) | Simulated multi-step pointer drag | Card moves | Moved to Paused. A single-jump tool drag didn't register, and a person dragging by hand wasn't tested. | Pass, simulated | See note |
| Short home lists (automated) | 6 stuck tasks | Shows 3, with Show more | Showed 3, and expanded to 5 besides the recommended task. | Pass | None |
| Wall-clock timer (browser) | Real 8-second wait | Clock matches real time | The clock dropped 8 seconds in 8 real seconds. | Pass | None |
| Throttled background tab (automated) | Clock jumps 7 minutes with no ticks | Shows the right time | 10:00 became 03:00. | Pass | None |
| Reload during a session (automated) | Remount after 10 of 25 minutes | Resumes correctly | Showed 15:00. | Pass | None |
| Timer ends while closed (automated) | Reopen an hour later | Session saved with its real end time | Saved as completed, ending 5 minutes after it started. | Pass | None |
| Finishing doesn't complete the task (automated) | Timer reaches zero | Task stays open | Stayed In Progress. | Pass | None |
| Stopping early (automated and browser) | Stop | Continue later or I got stuck | Both offered. Getting stuck recorded the note, set Needs Recovery, and opened Recovery. | Pass | None |
| Calendar rendering (browser) | Real FullCalendar | Month and week; distinct items | Rendered. Deadlines and planned work looked clearly different. | Pass | Stray dot removed from timed items |
| Moving planned work (browser) | Real drag to Nov 18 | Moves; deadline unchanged | Moved, and the deadline stayed Nov 12. | Pass | None |
| Moving a deadline (browser) | Real drag to Nov 14 | Snaps back and asks | Stayed on Nov 12, and asked for a decision. | Pass | None |
| Replan (automated) | Pick a day | Plans work; keeps the deadline unless asked | Deadline unchanged, unless the box was ticked. The original deadline was kept either way. | Pass | None |
| Calendar actions (automated, with a mock calendar) | Create on a date; schedule; open a task | All work with no AI | All worked. FullCalendar's callbacks were called directly, because it needs real layout. | Pass | None |
| Homework plan (automated and Demo Mode) | "I have avoided my homework" | Tangible worksheet, not advice | Gave a worksheet with the task's title and "Parts to finish". | Pass | The complaint behind this work |
| Missed deadline plan (automated and browser) | Biology task with a passed deadline | Editable message; no invented policy | Gave a draft with [Professor's name], asking whether late work is accepted. The policy was listed as unknown. | Pass | None |
| Stopped session (automated and browser) | Stuck focus session, with a note | Shorter or different; uses the report | Gave a smaller step, which said the session stopped early and quoted the note. | Pass | Quote added after the browser check |
| Plan B (automated) | "Still stuck" on six kinds of task | Never repeats; says when out of ideas | No repeats. Each ended by saying no more suggestions were available. | Pass | Fixed: it reported this one template too early |
| Preview (automated) | Accept part; decline | Only chosen parts apply; declining changes nothing else | As expected. Declining only added a history entry and remembered the plan to avoid. | Pass | None |
| Live checks (mock model) | Vague advice; repeats; RELEASE on a high-stakes task; past dates | Rejected, retried, or removed | All handled. A persistent problem fell back to a template, labeled as not AI. | Pass | None |
| Live path (real SDK, local fake server) | One request | Task data sent; vague plan rejected | Task data reached the server. A vague first answer was retried, and a past-dated session was removed. | Pass, wiring only | None |
| AI unavailable (automated) | Server returns 502 | Safe error; no changes; Demo Mode offered | As expected. | Pass | None |
| Migration (automated) | Old guided session; damaged data | Becomes a task; no crash | Old session became one task, only once, with finished steps kept. Damaged items were dropped individually. | Pass | None |
| Export and delete (automated) | Press both | File created; data removed | Export created a file, with browser APIs stubbed. Delete removed the data. | Pass | Not tried as a real file download |
| Accessibility scan (automated, axe-core) | Each view, the board, a running timer, and a plan preview | No violations | None, after one fix. Color contrast can't be checked this way. | Pass | Nested `main` fixed |
| Phone width (browser, 375 px emulation) | All 9 views | No sideways scrolling | No overflow, and no console errors. Most targets were at least 32 px; the complete button was 28 px, and was enlarged to 44 px. | Pass | Complete button enlarged |

Final checks on the committed build:

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| Old session (browser) | Earlier free-text session in storage | Becomes a task; no crash | Became one task, with status Needs Recovery. | Pass | None |
| Fixes applied (browser, 375 px) | Task list, guided check-in, stopped session | Fixes work | Complete button measured 44 px. Each view had one `main`. The plan quoted the reported obstacle. | Pass | None |
| Back button (browser) | Go to Tasks, then back | Returns to the previous view | Returned to the workspace. | Pass | None |
| Color contrast of new text pairs (browser, computed) | Text on the sand, sage, indigo, and secondary backgrounds | At least 4.5:1 | Lowest was 6.06:1. | Pass | None |
| Clean clone (automated) | Fresh clone and `npm ci` | All checks pass | 226 of 226 tests, typecheck, lint, and build passed. Tests also passed with the system set to Kiritimati and Los Angeles time. | Pass | None |

### Not tested for the workspace

- The real AI model, including the quality, cost, and speed of recovery plans. `npm run test:live` now includes three recovery scenarios for this.
- Whether this helps real users. No user testing has been done.
- Real phones, Safari, Firefox, and screen readers.
- A person dragging by hand, on a mouse or a touch screen.
- The deployed version of this branch.

## Low-friction intake

These tests were run on 2026-11-05 on the `feat/low-friction-intake` branch. "Automated" means `tests/intake.test.ts`, `tests/intake-screen.test.tsx`, and `tests/route.test.ts`. "Browser" means a production build run locally in Chromium with real key presses and clicks, with no API key. The AI model was mocked or not involved.

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| Selecting a date (automated and browser) | Pick a date, then type 03/01/2026 | Calendar appears only after choosing; stored without a shift | Stored `{type: "date", date: "2026-03-01"}`, and displayed Sunday, March 1, 2026. Automated tests passed with the system time zone set to Kiritimati and Los Angeles. | Pass | None |
| Past and future dates (automated) | 1999 and 2099 dates | Both accepted; impossible dates rejected | Accepted. The field has no minimum date. 2026-02-29 and 2026-02-31 were rejected. | Pass | None |
| No deadline (automated) | Choose No deadline | Explicit answer, shown as a fact | Stored `{type: "none"}`, and the Reality Check showed "You said there is no deadline." | Pass | None |
| Unknown deadline (automated) | Choose I'm not sure | Explicit answer, shown as an unknown | Stored `{type: "unsure"}`, and listed under Unknowns, not as a fact. | Pass | None |
| Optional fields left blank (automated and browser) | Submit without opening details | Nothing required; missing answers aren't treated as answers | Section was collapsed by default, and nothing was preselected. Values stayed `null`. Live prompts said "not answered (unknown)". The summary showed "Not answered". | Pass | None |
| Clickable status (automated and browser) | Click options | One at a time; clearable | One stayed selected, and clicking it again cleared it. | Pass | None |
| Clickable obstacle (automated and browser) | Click options | One at a time; passed on | Reached the Reality Check, summary, and Live AI request body. | Pass | None |
| Something else (automated and browser) | Choose it, with and without text | Optional text field; blank allowed | Field appeared only for this option. Blank became an unknown. Text became a fact, and was discarded if another option was chosen. Crisis wording in it was detected. | Pass | None |
| Restoring the intake (automated and browser) | Go back; reload | All answers restored | Text, date, options, and other text were restored, with the section open. | Pass | None |
| Old and damaged sessions (automated and browser) | Old free-text session; invalid JSON | No crash; no guessing | Old obstacle became Something else with its text. Old deadline and status were kept as "Earlier details". Invalid JSON gave a fresh start with no console errors. | Pass | New in this change |
| Mobile layout (browser, 375 px emulation) | Open details with all fields showing | One column; large targets; no sideways scrolling | One column, with no overflow. Options and inputs measured 48 px; toggle, examples, and submit 44 px. | Pass | Toggle and examples enlarged from 28 px and 38 px |
| Keyboard (browser) | Tab, arrow keys, Space, digits | Everything works without a mouse | Tab reached the groups with nothing selected. Space selected, arrow keys moved, and typing filled the date and text fields. | Pass | Space didn't clear a selected option at first, although the automated test passed. Fixed and rechecked in the browser. |
| Delete my data on the intake screen (automated) | Saved text, then delete | Form is emptied | Text and selections were cleared, and the section collapsed. | Pass | Old text stayed visible before this fix |

The live public site runs the earlier wizard until these branches are merged into `main`. The results under "Public deployment" below describe that earlier version, including the old heading and validation wording.

## Public deployment

These tests were run on 2026-11-05 at https://backontrack-peach.vercel.app, with scripted clicks in a browser and with no API key configured. The full set ran on the first deployment, of commit `c657c09`. After `main` was updated to the same commit, Vercel redeployed it and the job application path and basic access checks were run again.

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| Public access | Logged-out request to the site | Opens with no sign-in | Returned 200 with the app's page, and no Vercel sign-in page. | Pass | Vercel rejected the folder name, so the project was named `backontrack` |
| Mode | Open the site | Demo Mode labeled; Live AI unavailable | Demo was selected, Live AI was disabled, and the status endpoint reported `live: false`. | Pass | None |
| Invalid input | Empty text | Inline error | "Please describe it in at least a few words." | Pass | None |
| Test A | Job application sample | All screens; different Plan B and Plan C; change works; accurate summary | All four Reality Check sections appeared, Reduce was suggested, and one step was shown with all three buttons. Plan B, Plan C, and the changed step all differed. The pending step wasn't listed as completed. | Pass | None |
| Test B | Missed assignment sample | Unknown policy; caution; override needs acknowledgement | Policy was listed as unknown and a caution appeared. Release stayed blocked until acknowledged, and the summary recorded it as the user's choice. | Pass | None |
| Test C | Failed attempt sample | No repeats; no pressure to continue | Six different steps appeared across repeated "stuck" presses, then the app offered the summary. | Pass | None |
| Persistence and deletion | Reload; delete | Restored; then removed | Session survived a reload. Deleting returned to intake and removed the saved text. | Pass | None |
| Demo privacy | Network log during the workflow | No text sent to the server | Only GET status requests to `/api/recovery` appeared, with no POST. No console errors. | Pass | None |
| Phone width | Intake at 375 px | No sideways scrolling | No horizontal overflow on the intake screen. | Pass | Other screens were checked at this width on a local build only |
| Copy summary | Scripted click and real click | Summary copied | **Unconfirmed.** The test browser denies clipboard access, so the app showed its "blocked" message and suggested Download. | Not confirmed | Needs a check in a normal browser |
| Download | Not clicked on the public site | File downloaded | **Not run** on the public site. It has only passed an automated test with simulated browser functions. | Not run | Needs a check in a normal browser |

## Required scenarios in Demo Mode

These results come from automated tests (`tests/demo.test.ts`, `tests/workflow.test.tsx`). All three scenarios were also checked on the public site, as listed above. Demo responses are prewritten, so these results validate the workflow and content, not AI behavior.

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| A: Job application avoidance | "I have avoided job applications for two weeks and feel overwhelmed." | Separates fact from assumption; doesn't assume positions are closed; one concrete action; meaningful Plan B | The two-week gap is a known fact. "Still accepting applications" is an unknown, and closure is marked uncertain. First step: "Type the name of one company you wanted to apply to." Plan B: "Type any job title you remember seeing that seemed all right," using a different approach. | Pass | None |
| B: Missed assignment | "I missed my assignment deadline three days ago and don't know whether my professor accepts late submissions." | Identifies the unknown late policy; invents no rules; feasible next step; preserves agency | The late-submission policy is an unknown, and any penalty is marked uncertain. Marked high stakes with a caution. First step asks where the policy might be found. Plan B drafts a message in the app and says sending it stays the user's decision. | Pass | None |
| C: Failed recovery attempt | "I tried your suggestion, but I still couldn't start." | Changes strategy; doesn't repeat; no pressure or shame; smaller or alternative action | What the earlier suggestion was is listed as unknown, rather than pretending to remember. First step is a one-minute, five-word description that doesn't require starting. A word check found no shaming terms. Repeated "stuck" presses never repeated a step. | Pass | None |

## Required scenarios with the real AI model

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| A | As above | As above | Not yet run | Not run | |
| B | As above | As above | Not yet run | Not run | |
| C | As above | As above | Not yet run | Not run | |

## Other tests

| Scenario | Input | Expected behavior | Actual observed behavior | Pass/Fail | Fixes or iterations |
| --- | --- | --- | --- | --- | --- |
| Full navigation (automated and browser) | Sample → all screens → summary | Every screen works in order | Reached every screen. Each step screen showed one instruction and the three required buttons. | Pass | Test selectors corrected |
| Summary accuracy (automated and browser) | Two stuck steps, one completed, one pending | Only completed steps are listed as completed | The completed step and the user's text appeared under "completed". Stuck steps appeared under "tried". The pending step appeared only under "remaining". | Pass | None |
| Second "stuck" (automated and browser) | Press stuck twice, choose a reason | User can explain; Plan C is different and acknowledges it | Reason panel appeared. Plan C used a different approach and repeated the chosen reason. | Pass | None |
| All demo paths (automated) | 4 scenarios × 3 strategies | No repeated steps; every path can end | No duplicates; every path reached an end. | Pass | Strategy switching fixed |
| Override (automated) | Choose Release on the assignment scenario | Requires acknowledgement; recorded as override | Button stayed disabled until the box was checked. Summary recorded "your choice; the suggestion was Reduce". | Pass | None |
| Invalid input (automated and browser) | Empty text | Inline error, no progress | "Please describe it in at least a few words." Stayed on intake. | Pass | None |
| API validation (automated) | Malformed JSON, unknown stage, empty, short, digits only, over-long | 400 | All returned 400. | Pass | None |
| Oversized request; rate limit (automated) | 70 KB body; 41 quick requests | 413; 429 | Returned 413 and 429. | Pass | None |
| No key configured (browser) | POST to the API | Clean 503 | Returned 503 `not_configured`. The status endpoint reported `live: false`. | Pass | None |
| Model recommends RELEASE for an assignment (mock and fake server) | Model returns RELEASE | Changed to REDUCE | Returned REDUCE, marked high stakes. | Pass | None |
| Reworded repeat from the model (mock and fake server) | Model repeats the failed step in new words | Rejected, retried | Retried with a correction, and returned the different step. | Pass | None |
| Model keeps repeating (mock) | Same step every time | Built-in alternative | Returned a built-in step using a different approach. | Pass | None |
| Invalid model output (mock) | Non-JSON text | One retry, then safe error | Two calls were made, then 502. A later valid retry returned 200. | Pass | None |
| Provider failure (mock and fake server stopped) | Provider error or server down | Safe 502; no leaks | Returned 502 with a general message. Logs had only the error type, with no key or user text. | Pass | None |
| Error in the UI (automated, mocked server) | Server returns 502 | Text kept; retry and labeled Demo Mode offered | Error shown, text kept. Switching showed the Demo Mode label. | Pass | None |
| Failure after Completed (automated, mocked server) | Next-step request fails | Completion is not lost | Error shown, and the summary still listed the completed step. | Pass | None |
| Live labels (browser, fake server) | Key configured | Live AI selected and labeled | "Live AI" was selected, and screens showed "Generated by live AI". | Pass | None |
| Persistence and deletion (automated and browser) | Reload; press Delete | Restored; then removed | Session restored after reload. Delete returned to intake and removed the saved text. | Pass | None |
| Copy and download (automated) | Press both buttons | Markdown copied; file created | Clipboard call and file creation both occurred, with browser APIs stubbed. | Pass | Not tried with a real browser clipboard or file download |
| Responsive layout (browser) | 800 px and 375 px wide | Usable, no sideways scrolling | No horizontal overflow at 375 px. Buttons stack. | Pass | Mobile header fixed |
| Color contrast (browser, computed) | Main text and accent pairs | At least 4.5:1 | Lowest measured pair was 6.1:1 (error text on background). | Pass | None |

## Not tested

- The real AI model, including answer quality, cost, and speed.
- The Vercel AI Gateway option.
- Live AI on the public deployment, which has no API key.
- Real users.
- Screen readers, and browsers other than the one built into the development tool.
- The native calendar popup itself. The date field was tested by typing, and the popup's look varies by browser.
- Real phones. The mobile layout was tested with an emulated phone width.
- Whether the new intake actually helps people with ADHD or task-initiation difficulty.

## How to reproduce

```bash
npm install
```

```bash
npm test
```

```bash
npm run test:live
```

The last command needs an API key in `.env.local`.
