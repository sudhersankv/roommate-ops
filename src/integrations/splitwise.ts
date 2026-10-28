// Splitwise behind one interface (ADR 0004). The real client runs Composio's Splitwise tools as the connecting
// Admin's Composio user (= our accounts.id); the in-memory fake stands in for tests, evals and dev-chat when
// COMPOSIO_API_KEY is missing or invalid (SPLITWISE_FAKE=1). Amounts cross this boundary as integer cents.
import { composio, composioHealth, isAuthError } from "./composio";

export type SwUser = { id: string; firstName: string; lastName: string; email: string | null };
export type SwGroup = { id: string; name: string; members: SwUser[] };
export type SwShare = { userId: string; paidCents: number; owedCents: number };
export type SwExpense = {
  id: string;
  groupId: string | null;
  description: string;
  costCents: number;
  currency: string;
  date: string; // YYYY-MM-DD
  createdAt: Date | null;
  deleted: boolean;
  /** A Splitwise "payment" (one person paying another back): a Settlement for us. */
  payment: boolean;
  category: string | null;
  notes: string | null;
  users: SwShare[];
};
export type SwExpenseInput = { groupId: string; description: string; costCents: number; currency: string; date: string; notes?: string | null; payment?: boolean; users: SwShare[] };

export interface SplitwiseClient {
  readonly kind: "composio" | "fake";
  /** Where to send the Admin to connect their Splitwise; Composio redirects back to `callbackUrl`. */
  connectUrl(userId: string, callbackUrl: string): Promise<string>;
  isConnected(userId: string): Promise<boolean>;
  currentUser(userId: string): Promise<SwUser>;
  groups(userId: string): Promise<SwGroup[]>;
  group(userId: string, groupId: string): Promise<SwGroup>;
  /** Every expense in the group (paginated here), newest first. */
  expenses(userId: string, groupId: string, opts?: { datedAfter?: string }): Promise<SwExpense[]>;
  createExpense(userId: string, input: SwExpenseInput): Promise<{ id: string }>;
  updateExpense(userId: string, id: string, input: SwExpenseInput): Promise<void>;
  deleteExpense(userId: string, id: string): Promise<void>;
}

/** What Roomie says when Splitwise can't be reached as this user (no key, bad key, no connection). */
export class SplitwiseNotConnectedError extends Error {
  constructor(message = "Splitwise isn't connected yet. An admin can connect it in Settings.") {
    super(message);
    this.name = "SplitwiseNotConnectedError";
  }
}

/* ---------- money on the wire ---------- */

/** 1250 -> "12.50" (Splitwise wants 2-decimal strings). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(cents);
  return `${sign}${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** "12.5" / "12.50" / 12.5 -> 1250, by string parsing (no float math). */
export function decimalToCents(v: unknown): number {
  const s = String(v ?? "0").trim();
  const m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Splitwise sent an amount I can't read: "${s}".`);
  const frac = (m[3] ?? "").padEnd(2, "0");
  const cents = Number(m[2] || "0") * 100 + Number(frac.slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
  return m[1] ? -cents : cents;
}

/* ---------- Composio ---------- */

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function toUser(u: Raw): SwUser {
  return { id: str(u.id), firstName: str(u.first_name).trim(), lastName: str(u.last_name).trim(), email: u.email ? String(u.email) : null };
}

function toExpense(e: Raw): SwExpense {
  const users = (Array.isArray(e.users) ? (e.users as Raw[]) : []).map((u) => ({
    userId: str(u.user_id ?? (u.user as Raw | undefined)?.id),
    paidCents: decimalToCents(u.paid_share),
    owedCents: decimalToCents(u.owed_share),
  }));
  const category = e.category as Raw | undefined;
  return {
    id: str(e.id),
    groupId: e.group_id === null || e.group_id === undefined ? null : str(e.group_id),
    description: str(e.description).trim() || "Splitwise expense",
    costCents: decimalToCents(e.cost),
    currency: str(e.currency_code || "USD").toUpperCase(),
    date: str(e.date).slice(0, 10),
    createdAt: e.created_at ? new Date(String(e.created_at)) : null,
    deleted: !!e.deleted_at,
    payment: e.payment === true,
    category: category?.name ? String(category.name) : null,
    notes: e.details ? String(e.details) : null,
    users,
  };
}

/** Splitwise's flattened users__N__* arguments for create/update. */
function expenseArgs(input: SwExpenseInput): Raw {
  const args: Raw = {
    group_id: Number(input.groupId),
    description: input.description,
    cost: centsToDecimal(input.costCents),
    currency_code: input.currency,
    date: input.date,
    ...(input.notes ? { details: input.notes } : {}),
    ...(input.payment ? { payment: true } : {}),
  };
  input.users.forEach((u, i) => {
    args[`users__${i}__user_id`] = Number(u.userId);
    args[`users__${i}__paid_share`] = centsToDecimal(u.paidCents);
    args[`users__${i}__owed_share`] = centsToDecimal(u.owedCents);
  });
  return args;
}

const PAGE = 100;

export class ComposioSplitwise implements SplitwiseClient {
  readonly kind = "composio" as const;

  private client() {
    const c = composio();
    if (!c) throw new SplitwiseNotConnectedError("Splitwise isn't set up here: COMPOSIO_API_KEY is missing.");
    return c;
  }

  private async run(userId: string, slug: string, args: Raw): Promise<Raw> {
    const version = process.env.COMPOSIO_SPLITWISE_VERSION;
    try {
      const res = await this.client().tools.execute(slug, { userId, arguments: args, ...(version ? { version } : { dangerouslySkipVersionCheck: true }) });
      if (!res.successful) {
        if (isAuthError({ message: res.error ?? "" })) throw new SplitwiseNotConnectedError();
        throw new Error(`Splitwise said no: ${res.error ?? "unknown error"}`);
      }
      const d = res.data as Raw;
      return ((d?.response_data as Raw) ?? d) as Raw;
    } catch (e) {
      if (e instanceof SplitwiseNotConnectedError) throw e;
      if (isAuthError(e)) throw new SplitwiseNotConnectedError();
      throw e;
    }
  }

  /** The Splitwise auth config: COMPOSIO_SPLITWISE_AUTH_CONFIG_ID, else an existing Composio-managed one, else a new one. */
  private async authConfigId(): Promise<string> {
    const fromEnv = process.env.COMPOSIO_SPLITWISE_AUTH_CONFIG_ID?.trim();
    if (fromEnv) return fromEnv;
    const c = this.client();
    try {
      const existing = await c.authConfigs.list({ toolkit: "splitwise" });
      const found = existing.items?.[0]?.id;
      if (found) return found;
      const created = await c.authConfigs.create("splitwise", { type: "use_composio_managed_auth", name: "Roomie Splitwise" });
      console.warn(`[splitwise] created a Composio auth config; put COMPOSIO_SPLITWISE_AUTH_CONFIG_ID=${created.id} in .env`);
      return created.id;
    } catch (e) {
      if (isAuthError(e)) throw new SplitwiseNotConnectedError("Splitwise isn't available: Composio rejected our API key.");
      throw e;
    }
  }

  async connectUrl(userId: string, callbackUrl: string): Promise<string> {
    const authConfigId = await this.authConfigId();
    try {
      const req = await this.client().connectedAccounts.link(userId, authConfigId, { callbackUrl });
      if (!req.redirectUrl) throw new Error("Composio didn't return a sign-in link for Splitwise.");
      return req.redirectUrl;
    } catch (e) {
      if (isAuthError(e)) throw new SplitwiseNotConnectedError("Splitwise isn't available: Composio rejected our API key.");
      throw e;
    }
  }

  async isConnected(userId: string): Promise<boolean> {
    try {
      const res = await this.client().connectedAccounts.list({ userIds: [userId], toolkitSlugs: ["splitwise"], statuses: ["ACTIVE"] });
      return (res.items ?? []).length > 0;
    } catch (e) {
      if (isAuthError(e)) return false;
      throw e;
    }
  }

  async currentUser(userId: string) {
    const d = await this.run(userId, "SPLITWISE_GET_CURRENT_USER", {});
    return toUser((d.user as Raw) ?? d);
  }

  async groups(userId: string) {
    const d = await this.run(userId, "SPLITWISE_GET_GROUPS", {});
    return ((d.groups as Raw[]) ?? [])
      .filter((g) => Number(g.id) !== 0) // 0 = "non-group expenses"
      .map((g) => ({ id: str(g.id), name: str(g.name), members: ((g.members as Raw[]) ?? []).map(toUser) }));
  }

  async group(userId: string, groupId: string) {
    const d = await this.run(userId, "SPLITWISE_GET_GROUP", { id: Number(groupId) });
    const g = (d.group as Raw) ?? d;
    return { id: str(g.id), name: str(g.name), members: ((g.members as Raw[]) ?? []).map(toUser) };
  }

  async expenses(userId: string, groupId: string, opts: { datedAfter?: string } = {}) {
    const out: SwExpense[] = [];
    for (let offset = 0; offset < 50_000; offset += PAGE) {
      const d = await this.run(userId, "SPLITWISE_GET_EXPENSES", { group_id: Number(groupId), limit: PAGE, offset, ...(opts.datedAfter ? { dated_after: opts.datedAfter } : {}) });
      const page = ((d.expenses as Raw[]) ?? []).map(toExpense);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }

  async createExpense(userId: string, input: SwExpenseInput) {
    const d = await this.run(userId, "SPLITWISE_CREATE_EXPENSE", expenseArgs(input));
    const errors = d.errors as Raw | undefined;
    if (errors && Object.keys(errors).length) throw new Error(`Splitwise refused the expense: ${JSON.stringify(errors).slice(0, 200)}`);
    const created = ((d.expenses as Raw[]) ?? [])[0];
    if (!created?.id) throw new Error("Splitwise didn't return the new expense.");
    return { id: str(created.id) };
  }

  async updateExpense(userId: string, id: string, input: SwExpenseInput) {
    const d = await this.run(userId, "SPLITWISE_UPDATE_EXPENSE", { id: Number(id), ...expenseArgs(input) });
    const errors = d.errors as Raw | undefined;
    if (errors && Object.keys(errors).length) throw new Error(`Splitwise refused the change: ${JSON.stringify(errors).slice(0, 200)}`);
  }

  async deleteExpense(userId: string, id: string) {
    await this.run(userId, "SPLITWISE_DELETE_EXPENSE", { id: Number(id) });
  }
}

/* ---------- the fake ---------- */

type FakeState = { connected: Set<string>; groups: SwGroup[]; expenses: SwExpense[]; next: number };

const u = (id: string, firstName: string, lastName: string, email: string | null): SwUser => ({ id, firstName, lastName, email });
const share = (userId: string, paid: number, owed: number): SwShare => ({ userId, paidCents: paid, owedCents: owed });

function fakeSeed(): FakeState {
  const maya = u("101", "Maya", "Rivera", "maya@example.com");
  const dev = u("102", "Dev", "Patel", "dev@example.com");
  const sam = u("103", "Sam", "Kim", "sam@example.com");
  const jordan = u("104", "Jordan", "Lee", "jordan@example.com");
  const e = (id: string, description: string, costCents: number, date: string, users: SwShare[], extra: Partial<SwExpense> = {}): SwExpense => ({
    id,
    groupId: "9001",
    description,
    costCents,
    currency: "USD",
    date,
    createdAt: new Date(`${date}T18:00:00Z`),
    deleted: false,
    payment: false,
    category: null,
    notes: null,
    users,
    ...extra,
  });
  return {
    connected: new Set(),
    next: 1,
    groups: [
      { id: "9001", name: "Apt 4B (Splitwise)", members: [maya, dev, sam, jordan] },
      { id: "9002", name: "Tahoe weekend", members: [maya, dev] },
    ],
    expenses: [
      e("5001", "Internet (September)", 7500, "2026-09-03", [share("101", 7500, 2500), share("102", 0, 2500), share("103", 0, 2500)], { category: "TV/Phone/Internet" }),
      e("5002", "Thai takeout", 6400, "2026-09-10", [share("101", 0, 1600), share("102", 6400, 1600), share("103", 0, 1600), share("104", 0, 1600)], { category: "Dining out" }),
      e("5003", "Costco", 12000, "2026-09-14", [share("101", 7000, 4000), share("102", 0, 4000), share("103", 5000, 4000)], { category: "Groceries", notes: "Two carts" }),
      e("5004", "Payment", 2500, "2026-09-20", [share("103", 2500, 0), share("101", 0, 2500)], { payment: true }),
      e("5005", "Duplicate pizza", 3000, "2026-09-21", [share("101", 3000, 1500), share("102", 0, 1500)], { deleted: true }),
    ],
  };
}

export class FakeSplitwise implements SplitwiseClient {
  readonly kind = "fake" as const;
  state: FakeState = fakeSeed();

  reset() {
    this.state = fakeSeed();
  }

  async connectUrl(userId: string, callbackUrl: string) {
    // The fake connects instantly; a real connection happens on Composio's page.
    this.state.connected.add(userId);
    return `${callbackUrl}${callbackUrl.includes("?") ? "&" : "?"}status=success&fake=1`;
  }
  private check(userId: string) {
    if (!this.state.connected.has(userId)) throw new SplitwiseNotConnectedError();
  }
  async isConnected(userId: string) {
    return this.state.connected.has(userId);
  }
  async currentUser(userId: string) {
    this.check(userId);
    return this.state.groups[0].members[0];
  }
  async groups(userId: string) {
    this.check(userId);
    return structuredClone(this.state.groups);
  }
  async group(userId: string, groupId: string) {
    this.check(userId);
    const g = this.state.groups.find((x) => x.id === groupId);
    if (!g) throw new Error(`No Splitwise group ${groupId}.`);
    return structuredClone(g);
  }
  async expenses(userId: string, groupId: string, opts: { datedAfter?: string } = {}) {
    this.check(userId);
    return structuredClone(this.state.expenses.filter((e) => e.groupId === groupId && (!opts.datedAfter || e.date > opts.datedAfter))).sort((a, b) => b.date.localeCompare(a.date));
  }
  private validate(input: SwExpenseInput) {
    const paid = input.users.reduce((s, x) => s + x.paidCents, 0);
    const owed = input.users.reduce((s, x) => s + x.owedCents, 0);
    if (paid !== input.costCents || owed !== input.costCents) throw new Error(`Splitwise refused the expense: shares don't add up to ${centsToDecimal(input.costCents)}.`);
    const g = this.state.groups.find((x) => x.id === input.groupId);
    if (!g) throw new Error(`No Splitwise group ${input.groupId}.`);
    const unknown = input.users.find((x) => !g.members.some((m) => m.id === x.userId));
    if (unknown) throw new Error(`Splitwise refused the expense: user ${unknown.userId} isn't in the group.`);
  }
  async createExpense(userId: string, input: SwExpenseInput) {
    this.check(userId);
    this.validate(input);
    const id = `fake-${this.state.next++}`;
    this.state.expenses.push({ id, groupId: input.groupId, description: input.description, costCents: input.costCents, currency: input.currency, date: input.date, createdAt: new Date(), deleted: false, payment: !!input.payment, category: null, notes: input.notes ?? null, users: input.users });
    return { id };
  }
  async updateExpense(userId: string, id: string, input: SwExpenseInput) {
    this.check(userId);
    this.validate(input);
    const e = this.state.expenses.find((x) => x.id === id && !x.deleted);
    if (!e) throw new Error(`Splitwise has no expense ${id}.`);
    Object.assign(e, { description: input.description, costCents: input.costCents, currency: input.currency, date: input.date, notes: input.notes ?? null, users: input.users });
  }
  async deleteExpense(userId: string, id: string) {
    this.check(userId);
    const e = this.state.expenses.find((x) => x.id === id);
    if (e) e.deleted = true;
  }
}

/* ---------- which one ---------- */

let override: SplitwiseClient | null = null;
let fake: FakeSplitwise | null = null;
let real: ComposioSplitwise | null = null;

export const fakeSplitwise = () => (fake ??= new FakeSplitwise());

/** Tests inject a client; SPLITWISE_FAKE=1 picks the in-memory fake; otherwise Composio. */
export function setSplitwiseClient(c: SplitwiseClient | null) {
  override = c;
}

export function splitwiseClient(): SplitwiseClient {
  if (override) return override;
  if (process.env.SPLITWISE_FAKE === "1") return fakeSplitwise();
  return (real ??= new ComposioSplitwise());
}

export type SplitwiseAvailability = { ready: boolean; kind: "composio" | "fake"; reason?: "missing-key" | "invalid-key" | "error"; hint?: string };

/** Whether the Settings card can offer Connect, and why not. */
export async function splitwiseAvailability(): Promise<SplitwiseAvailability> {
  const c = splitwiseClient();
  if (c.kind === "fake") return { ready: true, kind: "fake", hint: "Using the in-memory Splitwise fake (SPLITWISE_FAKE=1)." };
  const health = await composioHealth();
  if (health === "ok") return { ready: true, kind: "composio" };
  if (health === "missing-key") return { ready: false, kind: "composio", reason: health, hint: "Splitwise needs COMPOSIO_API_KEY in the server's .env." };
  if (health === "invalid-key") return { ready: false, kind: "composio", reason: health, hint: "Composio rejected COMPOSIO_API_KEY, so Splitwise is off until the key is fixed." };
  return { ready: false, kind: "composio", reason: "error", hint: "Composio isn't answering right now. Try again in a bit." };
}

let warned = false;
/** dev-chat and scripts: fall back to the fake (once, loudly) when the real client can't work. */
export async function useFakeSplitwiseIfUnavailable(log = console.log): Promise<void> {
  if (process.env.SPLITWISE_FAKE === "1") return;
  const health = await composioHealth();
  if (health === "ok") return;
  process.env.SPLITWISE_FAKE = "1";
  if (!warned) log(`(Splitwise: COMPOSIO_API_KEY is ${health === "missing-key" ? "missing" : health === "invalid-key" ? "invalid" : "unreachable"}; using the in-memory fake)`);
  warned = true;
}
