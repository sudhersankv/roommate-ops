import { formatMoney } from "@/lib/money";

// Every service takes a Ctx first. The pipeline (chat), the dashboard (session) and tests all build one.
export type Ctx = {
  groupId: string;
  memberId: string; // members.id of whoever is acting: the sender in chat, the signed-in Member on the dashboard
  /** "dm": a Member's 1:1 chat with Roomie (Activity says so, and a change to shared money is echoed, ADR 0020). */
  source?: "chat" | "ui" | "dm";
};

/** Group-level reads only need the Group. */
export type GroupCtx = Pick<Ctx, "groupId">;

/**
 * Amounts as Roomie says them, in the Group's currency ("₹190.00", "€12.50", "$22.50"): the same formatting as the
 * dashboard (formatMoney). Services read the currency once (groups.currencyOf) and format with the function this returns.
 */
export const moneyIn =
  (currency = "USD") =>
  (cents: number) =>
    formatMoney(cents, currency);
