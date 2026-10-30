# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: the vocabulary (Group, Member, Trick, Expense, Cart, Chore, Join link...) and, under _Avoid_, the words not to use.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. The plan in `docs/plan.md` links the ADR behind each decision.

This is a **single-context** repo: one glossary, one ADR folder, both at the root.

## File structure

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-baileys-for-whatsapp-groups.md
│   ├── ...
│   └── 00NN-<decision>.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids. In particular: a person reads **Trick**, code says **Toolkit**; never "bot", "assistant", "feature", "enable" in anything user-facing.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (money is integer cents computed in code), but worth reopening because…_
