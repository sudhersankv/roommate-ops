// Every service takes a Ctx first. The pipeline (chat), the dashboard (session) and tests all build one.
export type Ctx = {
  groupId: string;
  memberId: string; // members.id of whoever is acting: the sender in chat, the signed-in Member on the dashboard
  /** "dm": a Member's 1:1 chat with Roomie (Activity says so, and a change to shared money is echoed, ADR 0020). */
  source?: "chat" | "ui" | "dm";
};

/** Group-level reads only need the Group. */
export type GroupCtx = Pick<Ctx, "groupId">;

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
