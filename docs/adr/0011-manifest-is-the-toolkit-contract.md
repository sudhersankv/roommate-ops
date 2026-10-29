# The manifest is the Toolkit contract; the shell renders from it

Toolkits were folders with tools, but everything around them was hardcoded: the bottom nav, Home's cards, the Settings switches, the Gate's toolkit criteria and the per-Toolkit lines in Roomie's persona. Adding a Toolkit meant editing six places, and switching one off left its tab and cards behind. Now each Toolkit's `manifest.ts` is the single description of it (marketplace copy, icon, category, status, `requires`, the Gate criterion and examples, the persona fragment, its nav entry and owned pages), and its `server.ts` adds the tools, lazy dashboard sections (Home, Settings, mood) and `onEnable`/`onDisable` hooks. The agent's tools and instructions, the Gate's `toolkit` question, the bottom nav, Home, Settings, the off state of owned pages and the Toolkits page are all built from the enabled manifests at request time. A new Toolkit is one folder plus a line in `manifests.ts` and one in `registry.ts` (a missing one is a type error).

## Consequences

- Manifests are plain data and safe anywhere (services, client code, tests); `server.ts` is server-only, and dashboard sections are lazy imports so the agent runtime (tsx scripts, evals, Mastra) never loads React.
- The Gate only offers Jev the Group's enabled Toolkits plus `core` and `none`, so it can't narrow to a Toolkit that's off. `reminders` became `core`.
- A Toolkit with no `group_toolkits` row follows its `defaultOn`, so a new Toolkit doesn't silently appear in every existing Group.
- Coming-soon Toolkits are manifest-only stubs: listed, explained, refused kindly.

## Considered options

- **Keep the shell hardcoded and add a Settings switch per Toolkit:** the drift we had. Rejected.
- **One manifest file with tools and React components:** simplest, but loading the agent would load the dashboard. Rejected for the manifest / server split.
