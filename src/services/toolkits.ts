// Toolkits for a Group: the marketplace's facts (what's on, what each needs) and switching one on or off. The
// manifests (src/toolkits/manifests.ts) say what exists; this file is the rules: Admins only, coming-soon ones
// can't be switched on, `requires` must be met, the on/off hooks run once per change, and a dashboard switch-on
// gets ONE line from Roomie in the Chat.
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CATALOG, findManifest, isToolkitId, manifestOf, MANIFESTS, type ToolkitId } from "@/toolkits/manifests";
import type { HookCtx, Integration, Toolkit, ToolkitManifest } from "@/toolkits/types";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { logMessage } from "./chatlog";
import { enabledToolkits, listToolkits } from "./groups";
import type { Ctx, GroupCtx } from "./types";

/** "Not yet" answers that aren't permission problems: coming soon, or something it needs is missing. */
export class ToolkitUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: "unknown" | "coming-soon" | "requirements" | "needed-by",
  ) {
    super(message);
    this.name = "ToolkitUnavailableError";
  }
}

/* ---------- requirements (pure, toolkits.test.ts) ---------- */

export type Requirement = { label: string; ok: boolean; detail?: string; blocking: boolean };
export type IntegrationState = { ok: boolean; hint?: string };
export type RequirementFacts = {
  hasEnv: (name: string) => boolean;
  enabled: readonly string[];
  integrations: Partial<Record<Integration, IntegrationState>>;
};

const INTEGRATION_LABEL: Record<Integration, string> = {
  composio: "Needs a Composio key",
  instacart: "Instacart (through Composio)",
  splitwise: "Splitwise (through Composio)",
  agentmail: "Needs an email service (AgentMail)",
};

/** Every requirement of a manifest with a red/green state. `blocking` ones stop it being switched on. */
export function checkRequirements(m: ToolkitManifest, facts: RequirementFacts): Requirement[] {
  const out: Requirement[] = [];
  for (const name of m.requires?.env ?? []) out.push({ label: `Needs ${name} on the server`, ok: facts.hasEnv(name), blocking: true });
  for (const id of m.requires?.toolkits ?? []) {
    const dep = manifestOf(id);
    out.push({ label: `Needs ${dep?.name ?? id} first`, ok: facts.enabled.includes(id), blocking: true });
  }
  for (const i of m.requires?.integrations ?? []) {
    const s = facts.integrations[i];
    out.push({ label: INTEGRATION_LABEL[i], ok: !!s?.ok, ...(s?.hint ? { detail: s.hint } : {}), blocking: true });
  }
  for (const i of m.worksWith?.integrations ?? []) {
    const s = facts.integrations[i];
    out.push({ label: `Works with ${INTEGRATION_LABEL[i].replace(/^Needs an? /, "")}`, ok: !!s?.ok, ...(s?.hint ? { detail: s.hint } : {}), blocking: false });
  }
  return out;
}

export const unmet = (reqs: Requirement[]) => reqs.filter((r) => r.blocking && !r.ok);

/**
 * A whole list of Toolkits to have on (set_group_settings, Onboarding's preset): what each one `requires` comes along
 * (Groceries brings Money), coming-soon and unknown ids drop out. Catalog order. Pure.
 */
export function resolveToolkitSet(ids: readonly string[], catalog: readonly ToolkitManifest[]): ToolkitId[] {
  const live = new Map(catalog.filter((m) => m.status !== "coming-soon" && isToolkitId(m.id)).map((m) => [m.id, m]));
  const on = new Set<string>();
  const add = (id: string) => {
    const m = live.get(id);
    if (!m || on.has(id)) return;
    on.add(id);
    for (const dep of m.requires?.toolkits ?? []) add(dep);
  };
  ids.forEach(add);
  return [...live.keys()].filter((id) => on.has(id)) as ToolkitId[];
}

/** The live facts: env, the Group's enabled Toolkits, and integration health (cached by the integrations). */
export async function requirementFacts(groupId: string, needed: Iterable<Integration>): Promise<RequirementFacts> {
  const wanted = new Set(needed);
  const integrations: RequirementFacts["integrations"] = {};
  const tasks: Promise<void>[] = [];
  if (wanted.has("composio")) {
    tasks.push(
      import("@/integrations/composio").then(async ({ composioHealth }) => {
        const h = await composioHealth();
        integrations.composio = h === "ok" ? { ok: true } : { ok: false, hint: h === "missing-key" ? "COMPOSIO_API_KEY isn't set on the server." : h === "invalid-key" ? "Composio rejected COMPOSIO_API_KEY." : "Composio isn't answering right now." };
      }),
    );
  }
  if (wanted.has("instacart")) {
    tasks.push(
      import("@/integrations/instacart").then(async ({ instacartAvailability }) => {
        const a = await instacartAvailability();
        integrations.instacart = a.ready ? { ok: true } : { ok: a.kind === "fake", hint: a.hint };
      }),
    );
  }
  if (wanted.has("splitwise")) {
    tasks.push(
      import("@/integrations/splitwise").then(async ({ splitwiseAvailability }) => {
        const a = await splitwiseAvailability();
        integrations.splitwise = { ok: a.ready, ...(a.hint ? { hint: a.hint } : {}) };
      }),
    );
  }
  if (wanted.has("agentmail")) {
    tasks.push(
      import("@/integrations/mail").then(({ mailAvailability }) => {
        const a = mailAvailability();
        integrations.agentmail = { ok: a.ready, ...(a.hint ? { hint: a.hint } : {}) };
      }),
    );
  }
  const [enabled] = await Promise.all([enabledToolkits({ groupId }), ...tasks]);
  return { hasEnv: (n) => !!process.env[n]?.trim(), enabled, integrations };
}

const integrationsOf = (ms: readonly ToolkitManifest[]) => ms.flatMap((m) => [...(m.requires?.integrations ?? []), ...(m.worksWith?.integrations ?? [])]);

/* ---------- reads ---------- */

export type ToolkitState = { manifest: ToolkitManifest; enabled: boolean; requirements: Requirement[] };

/** The whole catalog for a Group: every manifest (coming-soon ones too) with on/off and requirements. */
export async function catalogFor(ctx: GroupCtx): Promise<ToolkitState[]> {
  const [states, facts] = await Promise.all([listToolkits(ctx), requirementFacts(ctx.groupId, integrationsOf(CATALOG))]);
  return CATALOG.map((m) => ({ manifest: m, enabled: states.find((s) => s.id === m.id)?.enabled ?? false, requirements: checkRequirements(m, facts) }));
}

/* ---------- writes ---------- */

export type ToolkitChange = { toolkit: ToolkitId; name: string; enabled: boolean; changed: boolean; toolkits: ToolkitId[]; tryThis?: string };

/**
 * Admin: switch one Toolkit on or off by id or name. Nothing is deleted when it's off. A coming-soon Toolkit or one
 * whose `requires` aren't met can't go on; one that another enabled Toolkit requires can't go off. On a change the
 * Toolkit's hook runs and Activity records it; switched on from the dashboard, Roomie says so in the Chat once.
 */
export async function setToolkit(ctx: Ctx, input: { toolkit: string; enabled: boolean }): Promise<ToolkitChange> {
  const m = findManifest(input.toolkit);
  if (!m) throw new ToolkitUnavailableError(`I don't know a "${input.toolkit}" Trick. I can learn ${MANIFESTS.map((x) => x.name).join(", ")}.`, "unknown");
  if (m.status === "coming-soon") {
    if (!input.enabled) return { toolkit: m.id as ToolkitId, name: m.name, enabled: false, changed: false, toolkits: await enabledToolkits(ctx) };
    throw new ToolkitUnavailableError(`I can't learn ${m.name} yet: it isn't ready yet, but it's on the list.`, "coming-soon");
  }
  if (!isToolkitId(m.id)) throw new ToolkitUnavailableError(`I don't know a "${input.toolkit}" Trick.`, "unknown");
  const id = m.id;
  await requireAdmin(ctx);

  const before = await enabledToolkits(ctx);
  const wasOn = before.includes(id);
  if (input.enabled && !wasOn) {
    const missing = unmet(checkRequirements(m, await requirementFacts(ctx.groupId, m.requires?.integrations ?? [])));
    if (missing.length) throw new ToolkitUnavailableError(`I can't learn ${m.name} yet: ${missing.map((r) => r.label.replace(/^Needs /, "it needs ")).join("; ")}.`, "requirements");
  }
  if (!input.enabled && wasOn) {
    const dependents = MANIFESTS.filter((x) => before.includes(x.id) && x.requires?.toolkits?.includes(id));
    if (dependents.length) throw new ToolkitUnavailableError(`${dependents.map((x) => x.name).join(" and ")} need${dependents.length === 1 ? "s" : ""} ${m.name}, so I'm keeping it.`, "needed-by");
  }

  await db
    .insert(schema.groupToolkits)
    .values({ groupId: ctx.groupId, toolkit: id, enabled: input.enabled })
    .onConflictDoUpdate({ target: [schema.groupToolkits.groupId, schema.groupToolkits.toolkit], set: { enabled: input.enabled } });

  const changed = wasOn !== input.enabled;
  if (changed) {
    await recordFor(ctx, "toolkit.toggled", `${input.enabled ? "taught Roomie" : "had Roomie forget"} ${m.name}`);
    await runHooks({ groupId: ctx.groupId, memberId: ctx.memberId }, input.enabled ? [id] : [], input.enabled ? [] : [id]);
    if (input.enabled && ctx.source === "ui") await announceToolkitOn(ctx.groupId, id).catch((e) => console.error("[toolkits] announce failed", e));
  }
  return { toolkit: id, name: m.name, enabled: input.enabled, changed, toolkits: await enabledToolkits(ctx), ...(input.enabled ? { tryThis: m.gate.examples[0] } : {}) };
}

/** Run the Toolkits' onEnable / onDisable hooks (lazy: services never load the tools at import time). */
export async function runHooks(ctx: HookCtx, on: readonly string[], off: readonly string[] = []): Promise<void> {
  if (!on.length && !off.length) return;
  const { toolkitById } = await import("@/toolkits/registry");
  for (const id of on) await toolkitById(id)?.onEnable?.(ctx);
  for (const id of off) await toolkitById(id)?.onDisable?.(ctx);
}

/** Post order for Roomie's own posts (the Bundle, the report): a manifest's `postOrder`, else its nav order, else last. Pure. */
export const byPostOrder = <T extends Pick<ToolkitManifest, "postOrder" | "dashboard">>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.postOrder ?? a.dashboard?.nav?.order ?? 100) - (b.postOrder ?? b.dashboard?.nav?.order ?? 100));

/** The Group's enabled Toolkits' server entries (bundle / report contributions, hooks) in post order. Lazy, like runHooks. */
export async function enabledToolkitEntries(ctx: GroupCtx): Promise<Toolkit[]> {
  const [{ TOOLKITS }, on] = await Promise.all([import("@/toolkits/registry"), enabledToolkits(ctx)]);
  return byPostOrder(TOOLKITS.filter((t) => (on as readonly string[]).includes(t.id)));
}

/** The line Roomie posts when a Toolkit goes on from the dashboard. Pure. */
export function announcement(m: Pick<ToolkitManifest, "name" | "gate">): string {
  const example = m.gate.examples[0];
  return example ? `Learned ${m.name}. Try: "roomie, ${example}"` : `Learned ${m.name}.`;
}

const ANNOUNCE_COOLDOWN_MS = 10 * 60_000;
const announced = (): Map<string, number> => ((globalThis as { __roomieAnnounced?: Map<string, number> }).__roomieAnnounced ??= new Map());

/**
 * Roomie says ONE line in the Chat that a Toolkit is on. Switching the same one off and on again within 10 minutes
 * doesn't post again. Returns whether it posted.
 */
export async function announceToolkitOn(groupId: string, id: string, now = Date.now()): Promise<boolean> {
  const m = manifestOf(id);
  if (!m) return false;
  const key = `${groupId}:${id}`;
  const last = announced().get(key);
  if (last !== undefined && now - last < ANNOUNCE_COOLDOWN_MS) return false;
  announced().set(key, now);
  const [chat] = await db.select({ id: schema.chats.id }).from(schema.chats).where(eq(schema.chats.groupId, groupId));
  if (!chat) return false;
  const text = announcement(m);
  const { deliver } = await import("@/channels");
  await deliver(groupId, { text });
  await logMessage(groupId, null, text);
  return true;
}
