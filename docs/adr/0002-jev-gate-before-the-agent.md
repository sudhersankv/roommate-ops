# A Jev Gate runs before the agent on every Chat message

Roomie reads every message and should speak up when there's something to act on, even if no one named it. Running the main Sonnet agent on every message would be slow and expensive, and asking an LLM "should you reply?" gives free-text answers that aren't calibrated. Instead, each message first goes to Jev (`typesafeai-jev-1-14-0` on the Neon AI Gateway). Jev returns typed answers with calibrated probabilities: intent (act / clarify / chat / ignore), whether the message is addressed to Roomie, and which Toolkit it relates to. Only "act" and "clarify" above the Group's Chattiness thresholds wake up the agent, and the agent then gets only that Toolkit's tools.

## Consequences

- Message text goes to TypeSafe through the gateway.
- If Jev is unavailable, the Gate falls back to the hard triggers only (Roomie is named or @-mentioned, someone replies to Roomie, or a voice note). Roomie never goes silent and never spams.
- When the agent acts on a message nobody addressed to it, it asks before logging anything ("Want me to log $40 pizza split 4 ways?").
- If Jev through the gateway turns out not to work, Haiku (`claude-haiku-5-5`) with structured output replaces it behind the same Gate interface.
