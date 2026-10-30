# Two new primitives: polls as a Channel message, and Documents as a core store

## Polls

Some questions are for more than one person, and in a group chat a poll beats four replies: who had pizza, who's shopping this week, which day for the inspection. Both channels support polls (grammY `sendPoll` with non-anonymous polls delivering per-person `poll_answer` updates; Baileys sends polls and surfaces votes, which must be decrypted against the stored poll message).

Decisions:

1. **A poll is a kind of `Outgoing`.** `Outgoing.poll = { question, options, multi }`; a Channel that can't render polls sends the question and numbered options as text and accepts a numbered reply. Inbound, a `PollVote` message carries the poll's external id, the voter and the option ids. The dev adapter prints polls and takes a `vote` command. The pipeline logs a poll like any Roomie line.
2. **Polls are for *who*, never *how*.** Roomie asks a poll only when more than one person's input is the answer and there are at most 4 options: who's in on an Expense when the payer didn't say (multi-select); who's shopping; rotation order at onboarding; a day for a landlord visit. *How* to split stays the payer's word: "I paid 60 for pizza" logs an even split at once and the reply ends with how to change it. Groceries' per-item shared / personal attribution is a feature of its own and is never polled.
3. **One core tool, `ask_poll`.** Any Trick's persona can lead to it; a Member asking for a poll works through the same tool but isn't advertised.
4. **Lifecycle.** A poll resolves on the first of: a majority of active Members voted, or 2 hours. Nothing is logged until it resolves; then Roomie acts once and posts one line. A later "I was in too" amends by text. The payer's or asker's explicit text closes the poll early and wins. Polls live in a `polls` table (group, kind, external id, options, the Expense or question it's about, resolved_at) so votes arriving after a restart still count.

## Documents

Receipts, the lease, landlord notices, utility bills and work-order threads need one place, and `public/uploads/` on an ephemeral disk (audit M6) is not it.

Decisions:

5. **Documents are core**, always on, like Reminders: a `documents` table (group, kind: receipt | lease | notice | bill | email | photo | other, title, source: the Expense, email or work order it came from, uploader, storage key) and files in **Neon Object Storage**, which branches with the database. A Docs tab appears when the Group has any; "roomie find the lease" and "the March internet bill" search it from chat. Active Members only; served through a route that checks the session's Group.
6. **Every Trick files, none owns.** Money files receipts, Lease Inbox files attachments and threads, anyone can forward a file in chat ("roomie keep this"). Forgetting a Trick doesn't delete what it filed. "delete group data" does. "forget me" removes a Member's own photos and anonymizes them as uploader.

## Consequences

- The Channel contract grows by one outbound kind and one inbound kind; `sendToChat` returns the sent poll's external id so the `polls` row can be keyed by it; both adapters' tests gain a poll round-trip against their fakes.
- Telegram: `is_anonymous: false` (anonymous polls deliver no per-person votes) and `poll_answer` in `allowed_updates`; an empty `option_ids` is a retracted vote. WhatsApp (Baileys 7.0.0-rc14): the library's automatic vote decryption is commented out, so the adapter listens for `pollUpdateMessage` in `messages.upsert`, decrypts with `decryptPollVote` against the poll's `messageSecret`, and matches the SHA-256 option hashes to the options; the `messageSecret` is persisted with the `polls` row, not left in the in-memory sent-message cache.
- Receipt uploads move off `public/` and get the access check the audit asked for; Expense rows keep a document id, not a URL.
- A `BlobStore` interface with the real client and an in-memory fake, in the Splitwise / Instacart pattern.

## Considered options

- **Polls for the split method too** (the first idea): waits on votes to log a pizza, confuses the Groceries attribution, and can't be edited after sending. Rejected.
- **Member-started polls as a feature:** fun, general-purpose, not a roommate problem. Not advertised.
- **Keep files on disk with a Fly volume:** one machine, no branching, still no access check. Rejected.
