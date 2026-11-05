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

## Testing evidence

See [TEST_RESULTS.md](TEST_RESULTS.md).

## Known limitations

- **The real AI model has not been tested.** See [TEST_RESULTS.md](TEST_RESULTS.md) for what was verified instead.
- The Vercel AI Gateway option has not been exercised at all, and its default model ID is unconfirmed.
- The app has not been deployed to Vercel.
- The repeat check compares wording and approach labels. A model could still label a similar step differently and pass.
- Keyword-based high-stakes and crisis detection will have false positives and false negatives. For example, it recognizes "exam" and "bill", but not every phrasing.
- Rate limits are stored in memory per server instance and reset on restart.
- Saved sessions are not encrypted, and they are readable by anyone using the same browser profile.
- Demo Mode can't respond to the specifics of custom text.
- A full automated accessibility audit and a screen-reader test have not been done. Color contrast, labels, and focus handling were considered, and the contrast of the main color pairs was measured.
- No testing with real users has been done.
