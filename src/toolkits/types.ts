// The Toolkit contract (ADR 0011). A manifest says what a Toolkit is (the marketplace card, the Gate's criterion, the
// persona fragment, its nav tab and pages); its server entry adds the tools, the dashboard sections and the
// on/off hooks. Everything that changes with the Toolkits (agent tools, Gate, persona, nav, Home, Settings, the
// marketplace) is read from here, so a new Toolkit is one folder plus a line in manifests.ts and registry.ts.
import type { ToolAction } from "@mastra/core/tools";
import type { icons } from "lucide-react";
import type { ReactNode } from "react";
import type { RoomieMood } from "@/components/roomie/mascot";
import type { GroupSession } from "@/lib/session";

export { TOOLKIT_IDS, isToolkitId, type ToolkitId } from "./manifests";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolAction<any, any, any, any, any, any>;

export const TOOLKIT_CATEGORIES = ["money", "home", "food", "planning", "fun", "integrations"] as const;
export type ToolkitCategory = (typeof TOOLKIT_CATEGORIES)[number];
export type ToolkitStatus = "stable" | "beta" | "coming-soon";
export type Integration = "composio" | "instacart" | "splitwise";
/** A lucide-react icon, by its PascalCase export name ("Wallet", "ShoppingCart"). Rendered on the server. */
export type IconName = keyof typeof icons;

export type Requirements = {
  /** Env vars that must be set on the server. */
  env?: string[];
  /** Other Toolkits that must be on first. */
  toolkits?: string[];
  integrations?: Integration[];
};

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
  /** Appended to Roomie's instructions while the Toolkit is on. */
  persona?: string;
  /** Plain-words lines for the detail sheet, by tool id. Tools without one show their own description. */
  abilities?: Record<string, string>;
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
/** Roomie's mood in the Home doorway, from this Toolkit's data (Splitting: your Balance). */
export type MoodRef = () => Promise<(ctx: ToolkitSectionCtx) => Promise<RoomieMood | null>>;

/** Who switched a Toolkit on or off (null: Roomie itself, e.g. Onboarding). */
export type HookCtx = { groupId: string; memberId: string | null };

/** A manifest plus what runs on the server: tools, dashboard sections, hooks. */
export type Toolkit<Id extends string = string> = Omit<ToolkitManifest<Id>, "dashboard"> & {
  /** Keyed by tool id. */
  tools: Record<string, AnyTool>;
  dashboard?: NonNullable<ToolkitManifest["dashboard"]> & { home?: ComponentRef; settings?: ComponentRef; mood?: MoodRef };
  /** Runs when the Toolkit goes from off to on (and for the Onboarding preset). Must be idempotent. */
  onEnable?(ctx: HookCtx): Promise<void>;
  onDisable?(ctx: HookCtx): Promise<void>;
};
