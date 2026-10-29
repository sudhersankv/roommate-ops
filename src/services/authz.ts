// Permissions (ADR 0005: checked in services, never in prompts). The pure rules are unit-tested in authz.test.ts;
// requireActive / requireAdmin load the acting Member from the DB so a stale or forged Ctx can't skip them.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./types";

type MemberRow = typeof schema.members.$inferSelect;
export type Actor = Pick<MemberRow, "id" | "displayName" | "role" | "status">;

/** Thrown for "you can't do that". Tools return its message as text so Roomie can relay it kindly. */
export class NotAllowedError extends Error {
  constructor(
    message: string,
    readonly code: "pending" | "removed" | "not-member" | "admin-only" | "not-yours" | "operator-only",
  ) {
    super(message);
    this.name = "NotAllowedError";
  }
}

export const isNotAllowed = (e: unknown): e is NotAllowedError => e instanceof NotAllowedError;

const askWho = (admins: string[]) => (admins.length ? ` ${joinNames(admins)} can do that.` : "");
const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} or ${n[n.length - 1]}`);

/* ---------- pure rules ---------- */

/** Active Members may write. Pending ones may chat and read; removed ones nothing. */
export function checkActive(actor: Actor | undefined, adminNames: string[] = []): void {
  if (!actor) throw new NotAllowedError("You're not a member of this group.", "not-member");
  if (actor.status === "pending") {
    throw new NotAllowedError(`Hang on, an admin needs to approve you first.${askWho(adminNames).replace("do that", "approve you")}`, "pending");
  }
  if (actor.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
}

/** Admin-only: Members, roles, settings, Toolkits, deleting group data. */
export function checkAdmin(actor: Actor | undefined, adminNames: string[] = []): void {
  checkActive(actor, adminNames);
  if (actor!.role !== "admin") throw new NotAllowedError(`Only an admin can do that.${askWho(adminNames)}`, "admin-only");
}

/**
 * Who may edit or delete an Expense: whoever added it, its payer, anyone with a Share in it, or an Admin.
 * (Everyone else would be changing money they have nothing to do with.)
 */
export function canChangeExpense(
  actor: Actor,
  expense: { createdBy: string | null; payerId: string; participantIds: readonly string[] },
): boolean {
  if (actor.status !== "active") return false;
  if (actor.role === "admin") return true;
  return expense.createdBy === actor.id || expense.payerId === actor.id || expense.participantIds.includes(actor.id);
}

/* ---------- DB-backed ---------- */

async function load(ctx: Pick<Ctx, "groupId" | "memberId">): Promise<{ actor: Actor | undefined; admins: string[] }> {
  const rows = await db
    .select({ id: schema.members.id, displayName: schema.members.displayName, role: schema.members.role, status: schema.members.status })
    .from(schema.members)
    .where(eq(schema.members.groupId, ctx.groupId));
  const actor = rows.find((m) => m.id === ctx.memberId);
  const admins = rows.filter((m) => m.role === "admin" && m.status === "active" && m.id !== ctx.memberId).map((m) => m.displayName);
  return { actor, admins };
}

export async function requireActive(ctx: Pick<Ctx, "groupId" | "memberId">): Promise<Actor> {
  const { actor, admins } = await load(ctx);
  checkActive(actor, admins);
  return actor!;
}

export async function requireAdmin(ctx: Pick<Ctx, "groupId" | "memberId">): Promise<Actor> {
  const { actor, admins } = await load(ctx);
  checkAdmin(actor, admins);
  return actor!;
}

/** The acting Member, any status (reads that depend on who's asking). */
export async function actorOf(ctx: Pick<Ctx, "groupId" | "memberId">): Promise<Actor | undefined> {
  const [m] = await db
    .select({ id: schema.members.id, displayName: schema.members.displayName, role: schema.members.role, status: schema.members.status })
    .from(schema.members)
    .where(and(eq(schema.members.groupId, ctx.groupId), eq(schema.members.id, ctx.memberId)));
  return m;
}
