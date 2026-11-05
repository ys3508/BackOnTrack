# Privacy and Ethics

This is a description of how the prototype works, not legal advice or a formal privacy policy.

## User data handling

The app collects what the user types: a description of the avoided responsibility, optional details, text entered in steps, and explanations of obstacles. It has no accounts, and it doesn't ask for a name or email. It has no analytics.

The content can still be sensitive, because people may describe their work, health, or finances. The intake screen reminds Live AI users to avoid sensitive personal details.

## Data storage

- The session is stored in the browser's `localStorage`, under `backontrack.session.v1`.
- There is no application database, and the app doesn't save sessions on the server.
- The data stays until the user deletes it or clears the browser's data.
- It isn't encrypted, so anyone using the same browser profile could read it. Use a private window on a shared computer.

## API data transmission

| Mode | Where the text goes |
| --- | --- |
| Demo Mode | Nowhere. It runs in the browser. |
| Live AI | Browser → this app's server (`/api/recovery`) → the AI provider |

On the server:

- API keys are kept in environment variables and never sent to the browser.
- Input is validated and limited in size.
- Logs of AI failures record only the error type, not the user's text.
- Requests are rate limited. The limiter briefly holds the client's IP address in memory to count requests, and doesn't write it to storage.
- The hosting platform, such as Vercel, may keep its own request logs under its own terms.

## Third-party AI risks

- Text sent in Live AI mode is processed by the AI provider, and possibly by Vercel if the AI Gateway is used, under their own terms and retention policies.
- Before deploying this for anyone beyond a class demonstration, the operator should read those terms and check how long data is retained, and whether it can be used for training.
- Provider outages or policy changes can affect availability. If so, the app shows an error and offers Demo Mode, clearly labeled.
- Text entered by the user could try to manipulate the AI (prompt injection). The prompts mark user text as data, and each session only affects that user's own screen.

## Limitations of AI advice

- AI output can be wrong, incomplete, or overconfident. The Reality Check reduces that risk, but it can't eliminate it.
- The AI knows only what the user says. It doesn't know real deadlines, policies, or the user's circumstances.
- BackOnTrack isn't medical, legal, financial, academic, or mental-health advice. Users should confirm important matters with the responsible person or office.
- It isn't a crisis service. If crisis language is detected, it shows a notice pointing to human help (988 in the US and Canada, otherwise local emergency services). Detection is imperfect and can miss things.
- Its effect on procrastination has not been measured. This prototype makes no claim that it works as an intervention.

## Ethical safeguards built in

- High-stakes guard: RELEASE isn't recommended for detected legal, financial, medical, or academic obligations, and choosing it requires an explicit acknowledgement.
- The AI recommends, and the user decides. Overrides are recorded honestly.
- The system prompt prohibits diagnoses, shaming, and invented facts.
- Demo content is labeled as prewritten, and AI failure isn't hidden by substituting it.
- The summary lists a step as completed only if the user reported it. These are self-reports, and the app doesn't verify them.

## User control and deletion

- "Delete my data" in the header removes the saved session from the browser immediately. So does "Start over and delete this session" on the summary screen.
- The user can copy or download the summary.
- Data already sent to an AI provider in Live AI mode can't be deleted from within this app. It is governed by the provider's retention policy.

## Privacy-policy and terms-of-use considerations

If this moved beyond a class prototype, it would need at least:

- A written privacy policy covering what is collected, the providers involved, retention, and user rights.
- Terms of use stating that this is not professional advice, along with age requirements.
- A review of applicable laws, such as GDPR or CCPA, and FERPA if a school deployed it with student data.
- A data-processing agreement with the AI provider.
- A review of the crisis-handling approach by a qualified professional.

This prototype has none of these, and it should be treated as a demonstration.
