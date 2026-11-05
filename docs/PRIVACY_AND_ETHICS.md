# Privacy and Ethics

This is a description of how the prototype works, not legal advice or a formal privacy policy.

## User data handling

The app stores what the user enters: tasks, descriptions, instructions, working documents, deadlines, steps, notes and drafts, planned work, focus sessions, reported obstacles, and each task's history. It has no accounts, and it doesn't ask for a name or email. It has no analytics.

This content can be sensitive, because people may describe their work, health, or finances. Tasks and drafts may also include other people's names.

## Data storage

- Everything is stored in the browser's `localStorage`, under `backontrack.workspace.v1`. The guided check-in also uses `backontrack.session.v1`.
- There is no application database, and the app doesn't save this data on a server.
- The data stays until the user deletes it or clears the browser's data, and it isn't backed up.
- It isn't encrypted, so anyone using the same browser profile could read it. Use a private window on a shared computer.
- API keys are never stored in the browser.
- The latest daily plan is saved here too, including the energy level if one was chosen. It isn't sent to the AI service.
- To work out which help to offer first, the app keeps a log of moments such as getting stuck, focus sessions, moved work sessions, and accepted help. It holds no task titles or written text. It has its own controls in Settings: view, delete, or switch off. Deleting a task removes its records, and Delete all removes everything.
- The time the app was last opened is saved too, only in this browser, and is included in backups. It's used to offer an easier return after time away. It isn't sent anywhere, and there's no streak or usage tracking.
- Browsers usually allow about 5 MB for this. Settings shows the amount used, and the app warns if a save fails.
- Before moving saved data to a new format, or if it can't be read, a copy is kept under `backontrack.workspace.backup`. Deleting all data removes this too.

### Uploaded files

Files are read in the browser, using PDF.js for PDFs. They're never sent to this app's server or kept as files. Only the extracted text is saved, up to 30,000 characters, and the app says when text was cut. Type and size are checked first: PDF up to 10 MB and 100 pages, and .txt or .md up to 1 MB. Scanned or unreadable files produce a message asking the user to paste the text, and the app doesn't claim to have read them.

## API data transmission

| Mode | Where the text goes |
| --- | --- |
| Demo Mode | Nowhere. It runs in the browser. |
| Live AI | Browser → this app's server (`/api/recovery`) → the AI provider, only when the user asks for a suggestion |
| Tasks, focus, and calendar | Nowhere, in any mode |

When someone asks for a breakdown, writing help, or a recovery plan in Live AI mode, the selected task's details are sent: its title, description, deadline, status, progress, recent history, focus sessions, and reported obstacles, along with up to 12,000 characters of instructions and 8,000 of document text. Writing help also sends any selected text or source material. Other tasks aren't sent.

**Consent:** the first request that includes instructions or a document asks first, and explains that the text goes to a third-party AI service. Cancelling sends nothing. Changing the instructions asks again. Demo Mode never asks, because nothing is sent.

On the server:

- API keys are kept in environment variables and never sent to the browser.
- Input is validated and limited in size.
- Logs of AI failures record only the error type, not the user's text.
- Requests are rate limited. The limiter briefly holds the client's IP address in memory to count requests, and doesn't write it to storage.
- The hosting platform, such as Vercel, may keep its own request logs under its own terms.

### What's noticed about the user

With Live AI, guesses from that log, such as "Empty documents seem to be a sticking point", are sent along with a task when the user asks for help. They describe behavior, so they could be sensitive. Switching learning off stops this. A preference the user states is still sent. Demo Mode sends nothing.

The app doesn't diagnose anyone or infer health conditions, and its counts shouldn't be read that way.

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

- High-stakes guard: RELEASE isn't recommended for detected legal, financial, medical, or academic obligations, and choosing it requires an explicit acknowledgement. This also applies when changing a task's status by hand.
- Deadlines never change as a side effect of planning, because someone else may control them.
- Drafts are never sent by the app.
- The interface avoids alarm words and shame. A passed deadline reads "Deadline was Tue, Nov 3".
- The AI recommends, and the user decides. Overrides are recorded honestly.
- The system prompt prohibits diagnoses, shaming, and invented facts.
- Demo content is labeled as prewritten, and AI failure isn't hidden by substituting it.
- The summary lists a step as completed only if the user reported it. These are self-reports, and the app doesn't verify them.

## Academic integrity

The app helps students think and start, and they stay the author.

- AI text is labeled as suggested, previewed, and only added when accepted. It's never silently written over the student's work.
- Accepted text stays highlighted until the student clears it, and history records what was accepted and from where.
- The model is told not to invent references, data, or results, and not to present anything as independently researched. Citations and links not found in the student's own text are rejected, although unusual formats could get through.
- These measures don't guarantee a course's rules are met. Students should check what's allowed, and disclose AI help as required.

## User control and deletion

- Settings has "Export my data", which downloads everything as JSON, "Import a backup", which replaces the data after a confirmation, and "Delete all my data", which removes it after a confirmation.
- A document can be copied, or exported as Markdown or text.
- Each task can be deleted separately.
- AI suggestions change nothing until accepted, and each part can be left out or edited first.
- In the guided check-in, the user can also copy or download a summary.
- Data already sent to an AI provider in Live AI mode can't be deleted from within this app. It is governed by the provider's retention policy.

## Privacy-policy and terms-of-use considerations

If this moved beyond a class prototype, it would need at least:

- A written privacy policy covering what is collected, the providers involved, retention, and user rights.
- Terms of use stating that this is not professional advice, along with age requirements.
- A review of applicable laws, such as GDPR or CCPA, and FERPA if a school deployed it with student data.
- A data-processing agreement with the AI provider.
- A review of the crisis-handling approach by a qualified professional.

This prototype has none of these, and it should be treated as a demonstration.
