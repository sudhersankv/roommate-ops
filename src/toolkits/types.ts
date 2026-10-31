// The Toolkit contract (ADR 0011). A manifest says what a Toolkit is (the marketplace card, the Gate's criterion, the
// persona fragment, its nav tab and pages); its server entry adds the tools, the dashboard sections and the
// on/off hooks. Everything that changes with the Toolkits (agent tools, Gate, persona, nav, Home, Settings, the
// marketplace) is read from here, so a new Toolkit is one folder plus a line in manifests.ts and registry.ts.
import type { ToolAction } from "@mastra/core/tools";
import type { icons } from "lucide-react";
import type { ReactNode } from "react";
import type { RoomieMood } from "@/components/roomie/mascot";
import type { GroupSession } from "@/lib/session";
import type { ReportPart } from "@/services/report";
import type { GroupCtx } from "@/services/types";

export { TOOLKIT_IDS, isToolkitId, type ToolkitId } from "./manifests";
export type { ReportPart };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolAction<any, any, any, any, any, any>;

export const TOOLKIT_CATEGORIES = ["money", "home", "food", "planning", "fun", "integrations"] as const;
export type ToolkitCategory = (typeof TOOLKIT_CATEGORIES)[number];
export type ToolkitStatus = "stable" | "beta" | "coming-soon";
export type Integration = "composio" | "instacart" | "splitwise" | "agentmail";
/** A lucide-react icon, by its PascalCase export name ("Wallet", "ShoppingCart"). Rendered on the server. */
export type IconName = keyof typeof icons;

export type Requirements = {
  /** Env vars that must be set on the server. */
  env?: string[];
  /** Other Toolkits that must be on first. */
  toolkits?: string[];
  integrations?: Integration[];
};

/** What an Admin's message must say for an admin-only tool to run (toolkits/admin-ask.ts). Plain strings only. */
export type AdminAsk = {
  /** Words naming the action, as a case-insensitive regex source ("promote|admin"). */
  action: string;
  /** The input field naming who or what it's for ("name", "toolkit"). One of its words must be in the message too. */
  target?: string;
  /** For a tool that changes several things (settings): every input field the call sets must be asked for by its own
   * words; `action` then only counts for a call that changes nothing. */
  fields?: Record<string, AdminField>;
  /** The question Roomie asks instead; "{target}" is the target's value (or the fields nobody asked for). */
  ask: string;
};

/** How a message asks for one field: its words (a regex source), or with `byValue` the value itself ("Chicago"). */
export type AdminField = { words: string; byValue?: boolean; /** Also asked for by what the value means ("ist" for Asia/Kolkata, "rupees" for INR). */ byMeaning?: "timezone" | "currency" };

export type NavEntry = { label: string; href: (groupId: string) => string; icon: IconName; order: number };

/** What a Toolkit is. Plain data, safe to import anywhere (services, client code, tests). */
export type ToolkitManifest<Id extends string = string> = {
  id: Id;
  name: string;
  /** One line for the agent and logs. */
  description: string;
  /** One line for the marketplace card. */
  summary: string;
  /** 2-4 sentences for the detail sheet. */
  longDescription: string;
  icon: IconName;
  category: ToolkitCategory;
  tags: string[];
  /** On for a Group that never chose (no group_toolkits row yet). */
  defaultOn: boolean;
  /** Can't be switched on until these are met (toggle_toolkit and the marketplace both check). */
  requires?: Requirements;
  /** Optional extras it works better with; shown in the detail sheet, never blocking. */
  worksWith?: { integrations: Integration[] };
  status: ToolkitStatus;
  /** The Gate's `toolkit` choice for this Toolkit: what messages belong here. */
  gate: { criterion: string; examples: string[] };
  /** Plain-words lines for the detail sheet, by tool id. Tools without one show their own description. */
  abilities?: Record<string, string>;
  /**
   * Admin-only tools, by tool id (audit H6). The model sees other people's chat and working memory, so a planted
   * instruction could run one with the next Admin's rights: these only run when the Admin's own current message asks
   * for it (toolkits/admin-ask.ts); otherwise the tool returns { refused: "confirm", ask } and Roomie asks first.
   */
  adminOnly?: Record<string, AdminAsk>;
  /**
   * Tools Roomie may put to the whole chat as a group decision (#42): a ✅ / ❌ poll where the first ✅ from any active
   * Member runs the pinned call as them. Only changes to shared state that any active Member may make; the registry
   * refuses an adminOnly tool here whatever the list says (groupDecisionRefusal).
   */
  groupDecisions?: string[];
  /**
   * Where its lines sit in Roomie's own posts, the morning Bundle and the weekly report (ADR 0017: money 10, the
   * landlord 20, the house 30, groceries 40). Default: its nav order, then last.
   */
  postOrder?: number;
  dashboard?: {
    nav?: NavEntry;
    /** Route prefixes under /g/<id>/ it owns ("money"); they show the off state while it's off. */
    pages?: string[];
  };
};

/** What a Toolkit's Home or Settings section gets. */
export type ToolkitSectionCtx = { session: GroupSession; isAdmin: boolean; base: string };
export type ToolkitSection = (props: { ctx: ToolkitSectionCtx }) => ReactNode | Promise<ReactNode>;
/** A lazy reference to a React server component, so the agent runtime never loads dashboard code. */
export type ComponentRef = () => Promise<ToolkitSection>;
/** Roomie's mood in the Home doorway from this Toolkit's data (Splitting: your Balance), when the Group's mood can't be read. */
export type MoodRef = () => Promise<(ctx: ToolkitSectionCtx) => Promise<RoomieMood | null>>;

/** Who switched a Toolkit on or off (null: Roomie itself, e.g. Onboarding). */
export type HookCtx = { groupId: string; memberId: string | null };

/** A manifest plus what runs on the server: tools, dashboard sections, hooks, and its lines in Roomie's own posts. */
export type Toolkit<Id extends string = string> = Omit<ToolkitManifest<Id>, "dashboard"> & {
  /** Keyed by tool id. */
  tools: Record<string, AnyTool>;
  /** How Roomie works with this Trick: its skill.md (#35), generated into skill.ts by `npm run skills`. Server-only. */
  skill: string;
  dashboard?: NonNullable<ToolkitManifest["dashboard"]> & {
    home?: ComponentRef;
    /** Where the Home section sits (default: nav order). Home reads standing, then today, then the rest. */
    homeOrder?: number;
    settings?: ComponentRef;
    mood?: MoodRef;
  };
  /** Runs when the Toolkit goes from off to on (and for the Onboarding preset). Must be idempotent. */
  onEnable?(ctx: HookCtx): Promise<void>;
  onDisable?(ctx: HookCtx): Promise<void>;
  /** Its line in the morning Bundle (ADR 0017), or null when it has nothing to say. A thin call into its service. */
  bundle?(ctx: GroupCtx, now: Date): Promise<string | null>;
  /** Its sections of the weekly Group Report, in order (none when there's nothing to report). */
  report?(ctx: GroupCtx, now: Date): Promise<ReportPart[]>;
};
