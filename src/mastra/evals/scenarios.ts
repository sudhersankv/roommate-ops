// The fixed scenario set for `npm run evals` (scripts/evals.ts). Each scenario runs through the real pipeline
// (Gate + Sonnet + tools) in its own throwaway household with Maya, Dev and Sam; the sender is Maya unless set.
// A scenario passes when every check in `expect` holds, or every check in `alt` does (two acceptable behaviours).
import { cart, chores, money, reminders, upkeep } from "@/services";
import type { Ctx } from "@/services/types";

export const EVAL_MEMBERS = ["Maya", "Dev", "Sam"] as const;
export type EvalMember = (typeof EVAL_MEMBERS)[number];

export type Turn = { text: string; from?: EvalMember; isReplyToRoomie?: boolean };

export type EvalEnv = {
  /** Ctx acting as Maya. */
  ctx: Ctx;
  member: Record<EvalMember, string>;
  as: (name: EvalMember) => Ctx;
};

export type Expect = {
  /** Roomie replies at all (default true). */
  speaks?: boolean;
  /** Every one of these tools is called. */
  tools?: string[];
  /** None of these tools is called; "actions" = anything but read-only tools and working memory. */
  noTools?: string[] | "actions";
  /** Case-insensitive substrings (or regexes) the reply must contain. */
  replyIncludes?: (string | RegExp)[];
  /** The reply asks something. */
  asks?: boolean;
  /** Allow more than 3 lines. */
  long?: boolean;
  /** State check after the turn; return an error message or null. */
  check?: (env: EvalEnv) => Promise<string | null>;
};

export type Scenario = {
  id: string;
  area: "splitting" | "groceries" | "chores" | "upkeep" | "reminders" | "core" | "gate";
  /** Rows to create with services before the turn (no LLM). */
  seed?: (env: EvalEnv) => Promise<void>;
  /** Earlier chat turns through the pipeline; their replies aren't checked. */
  setup?: Turn[];
  turn: Turn;
  expect: Expect;
  alt?: Expect;
};

/** Tools that only read. Anything else is an action. */
export const READ_ONLY_TOOLS = new Set([
  "list_members",
  "get_balances",
  "list_expenses",
  "cart_view",
  "chore_status",
  "list_reminders",
  "maintenance_status",
  "group_report",
  "updateWorkingMemory",
]);

const balanceOf = async (env: EvalEnv, name: EvalMember) => (await money.getBalances(env.ctx)).find((b) => b.name === name)?.cents ?? 0;
const expenseCount = async (env: EvalEnv) => (await money.listExpenses(env.ctx, 50)).length;
const internet = (env: EvalEnv) => money.logExpense(env.ctx, { cents: 6000, description: "internet" });
const fail = (ok: boolean, msg: string) => (ok ? null : msg);

export const SCENARIOS: Scenario[] = [
  /* ---------- splitting ---------- */
  {
    id: "split-basic",
    area: "splitting",
    turn: { text: "roomie I paid $60 for internet" },
    expect: { tools: ["log_expense"], replyIncludes: ["60"], check: async (e) => fail((await balanceOf(e, "Dev")) === -2000, "Dev should owe $20.00") },
  },
  {
    id: "split-subset",
    area: "splitting",
    turn: { text: "roomie Dev and I split a $30 uber, I paid", from: "Sam" },
    expect: { tools: ["log_expense"], replyIncludes: ["15"], check: async (e) => fail((await balanceOf(e, "Dev")) === -1500 && (await balanceOf(e, "Maya")) === 0, "Dev -$15, Maya untouched") },
  },
  {
    id: "split-uneven-50-25-25",
    area: "splitting",
    turn: { text: "roomie $90 dinner, I paid. I had the steak so 50/25/25" },
    // Exact shares aren't a tool yet (step 5): either get the cents right with the tools there are, or ask.
    expect: {
      check: async (e) => fail((await balanceOf(e, "Maya")) === 4500 && (await balanceOf(e, "Dev")) === -2250 && (await balanceOf(e, "Sam")) === -2250, "balances should be Maya +45.00, Dev -22.50, Sam -22.50"),
    },
    alt: { asks: true, check: async (e) => fail((await expenseCount(e)) === 0, "asked, so nothing should be logged") },
  },
  {
    id: "owes-named",
    area: "splitting",
    seed: async (e) => void (await internet(e)),
    turn: { text: "roomie who owes what", from: "Dev" },
    expect: { tools: ["get_balances"], replyIncludes: ["20"] },
  },
  {
    id: "owes-unaddressed-question",
    area: "splitting",
    seed: async (e) => void (await internet(e)),
    turn: { text: "who owes what?", from: "Sam" },
    expect: { tools: ["get_balances"], replyIncludes: ["20"] },
  },
  {
    id: "settle-up",
    area: "splitting",
    seed: async (e) => void (await internet(e)),
    turn: { text: "roomie I paid Maya back $20", from: "Dev" },
    expect: { tools: ["settle_up"], check: async (e) => fail((await balanceOf(e, "Dev")) === 0, "Dev should be square") },
  },
  {
    id: "list-expenses",
    area: "splitting",
    seed: async (e) => {
      await internet(e);
      await money.logExpense(e.as("Dev"), { cents: 2400, description: "pizza" });
    },
    turn: { text: "roomie what have we spent money on lately?" },
    expect: { tools: ["list_expenses"], replyIncludes: ["pizza", "internet"] },
  },
  {
    id: "unknown-name",
    area: "splitting",
    turn: { text: "roomie Jordan owes me $15 for lunch" },
    expect: { asks: true, check: async (e) => fail((await expenseCount(e)) === 0, "nothing should be logged for an unknown member") },
  },
  {
    id: "unprompted-pizza-asks-first",
    area: "splitting",
    turn: { text: "I paid 40 for pizza", from: "Dev" },
    expect: { asks: true, noTools: "actions", replyIncludes: ["40"] },
  },
  {
    id: "spanish",
    area: "splitting",
    turn: { text: "roomie pagué 30 por el uber" },
    expect: { tools: ["log_expense"], replyIncludes: [/(listo|anotad|registr|pagaste|cada un|dividid|hecho|apuntad)/i], check: async (e) => fail((await balanceOf(e, "Maya")) === 2000, "Maya +$20.00") },
  },

  /* ---------- groceries ---------- */
  {
    id: "add-milk-eggs",
    area: "groceries",
    turn: { text: "roomie add milk and eggs" },
    expect: { tools: ["cart_add"], check: async (e) => fail((await cart.listOpenItems(e.ctx)).length === 2, "2 items in the cart") },
    alt: { asks: true, noTools: ["cart_add"] },
  },
  {
    id: "add-shared",
    area: "groceries",
    turn: { text: "roomie add dish soap for the whole house" },
    expect: { tools: ["cart_add"], check: async (e) => fail((await cart.listOpenItems(e.ctx)).some((i) => /soap/i.test(i.name) && i.shared), "dish soap, shared") },
  },
  {
    id: "view-cart",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.as("Dev"), { items: [{ name: "oat milk" }, { name: "bananas", qty: "6" }] })),
    turn: { text: "roomie what's in the cart?" },
    expect: { tools: ["cart_view"], replyIncludes: ["oat milk", "banana"] },
  },
  {
    id: "remove-item",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.ctx, { items: [{ name: "milk" }, { name: "bread" }] })),
    turn: { text: "roomie take milk off the list" },
    expect: { tools: ["cart_remove"], check: async (e) => fail(!(await cart.listOpenItems(e.ctx)).some((i) => i.name === "milk"), "milk removed") },
  },
  {
    id: "checkout-coming-soon",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.ctx, { items: [{ name: "milk" }] })),
    turn: { text: "roomie order the groceries" },
    expect: { tools: ["cart_checkout"], replyIncludes: [/soon|not (live|ready|available|wired)|can't .* yet|yet/i] },
  },
  {
    id: "cart-purchased",
    area: "groceries",
    seed: async (e) => {
      await cart.addItems(e.ctx, { items: [{ name: "chips" }] });
      await cart.addItems(e.as("Dev"), { items: [{ name: "salsa" }] });
    },
    turn: { text: "roomie I bought the groceries, $42", from: "Sam" },
    expect: {
      tools: ["cart_purchased"],
      check: async (e) => {
        const [x] = await money.listExpenses(e.ctx, 1);
        return fail(x?.cents === 4200 && x.payerName === "Sam", "one $42.00 expense paid by Sam");
      },
    },
  },
  {
    id: "follow-up-window-chips",
    area: "groceries",
    setup: [{ text: "roomie add salsa", from: "Sam" }],
    turn: { text: "and 2 bags of chips too", from: "Sam" },
    expect: { tools: ["cart_add"], check: async (e) => fail((await cart.listOpenItems(e.ctx)).some((i) => /chip/i.test(i.name)), "chips in the cart") },
    // The persona asks "for you or the whole group?" before adding; picking up the follow-up is what's tested.
    alt: { asks: true, replyIncludes: ["chip"], noTools: "actions" },
  },

  /* ---------- chores ---------- */
  {
    id: "did-dishes",
    area: "chores",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 })),
    turn: { text: "roomie I did the dishes", from: "Dev" },
    expect: { tools: ["log_chore"], check: async (e) => fail((await chores.choreStatus(e.ctx)).find((c) => c.name === "Dishes")?.lastDoneBy === "Dev", "Dishes done by Dev") },
  },
  {
    id: "did-dishes-unprompted-asks",
    area: "chores",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 })),
    turn: { text: "I did the dishes", from: "Dev" },
    expect: { asks: true, noTools: ["log_chore"] },
  },
  {
    id: "whose-turn",
    area: "chores",
    seed: async (e) => {
      await chores.addChore(e.ctx, { name: "Take out trash", everyDays: 3 });
      await chores.logChore(e.ctx, { chore: "trash" });
    },
    turn: { text: "roomie whose turn is it to take out the trash?", from: "Sam" },
    expect: { tools: ["chore_status"], replyIncludes: [/dev|sam/i] },
  },
  {
    id: "add-chore",
    area: "chores",
    turn: { text: "roomie add vacuuming to the chart, every 7 days" },
    expect: { tools: ["add_chore"], check: async (e) => fail((await chores.choreStatus(e.ctx)).some((c) => /vacuum/i.test(c.name)), "vacuuming on the chart") },
  },
  {
    id: "chore-for-someone-else",
    area: "chores",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Take out trash", everyDays: 3 })),
    turn: { text: "roomie Dev took out the trash" },
    expect: { tools: ["log_chore"], check: async (e) => fail((await chores.choreStatus(e.ctx)).find((c) => /trash/i.test(c.name))?.lastDoneBy === "Dev", "trash done by Dev") },
  },

  /* ---------- upkeep ---------- */
  {
    id: "track-ac-filter",
    area: "upkeep",
    turn: { text: "roomie track the AC filter, it needs changing every 90 days" },
    expect: { tools: ["add_maintenance"], check: async (e) => fail((await upkeep.listMaintenance(e.ctx)).some((m) => m.everyDays === 90), "an upkeep item every 90 days") },
  },
  {
    id: "maintenance-done",
    area: "upkeep",
    seed: async (e) => void (await upkeep.addMaintenance(e.ctx, { item: "Replace HVAC filter", everyDays: 90 })),
    turn: { text: "roomie I replaced the hvac filter", from: "Dev" },
    expect: { tools: ["maintenance_done"], check: async (e) => fail((await upkeep.listMaintenance(e.ctx))[0]?.status === "ok", "filter marked done") },
  },

  /* ---------- reminders + core ---------- */
  {
    id: "remind-trash-tuesday",
    area: "reminders",
    turn: { text: "roomie remind everyone trash goes out tuesday 8pm", from: "Sam" },
    expect: {
      tools: ["set_reminder"],
      check: async (e) => {
        const [r] = await reminders.listReminders(e.ctx);
        if (!r) return "no reminder";
        const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hourCycle: "h23" }).format(r.dueAt);
        return fail(/Tue/.test(local) && /\b20\b/.test(local) && r.memberId === null, `Tuesday 20:00 Chicago for everyone, got ${local}`);
      },
    },
  },
  {
    id: "list-reminders",
    area: "reminders",
    seed: async (e) => void (await reminders.setReminder(e.ctx, { text: "Rent is due", dueAt: new Date(Date.now() + 5 * 86_400_000) })),
    turn: { text: "roomie what reminders do we have coming up?" },
    expect: { tools: ["list_reminders"], replyIncludes: ["rent"] },
  },
  {
    id: "group-report",
    area: "core",
    seed: async (e) => void (await internet(e)),
    turn: { text: "roomie give us the group report" },
    expect: { tools: ["group_report"], replyIncludes: ["Group report"], long: true },
  },
  {
    id: "members",
    area: "core",
    turn: { text: "roomie who's in this group?", from: "Dev" },
    expect: { replyIncludes: ["Maya", "Dev", "Sam"] },
  },

  /* ---------- the Gate ---------- */
  {
    id: "chatter-game",
    area: "gate",
    turn: { text: "did you see the game last night", from: "Dev" },
    expect: { speaks: false },
  },
  {
    id: "chatter-see-you",
    area: "gate",
    turn: { text: "ok see you at 7", from: "Sam" },
    expect: { speaks: false },
  },
  {
    id: "window-chatter-stays-quiet",
    area: "gate",
    setup: [{ text: "roomie add salsa", from: "Sam" }],
    turn: { text: "lol same", from: "Dev" },
    expect: { speaks: false },
  },
  {
    id: "thanks-roomie",
    area: "gate",
    setup: [{ text: "roomie add salsa", from: "Sam" }],
    turn: { text: "thanks roomie", from: "Sam" },
    expect: { noTools: "actions" },
  },
  {
    id: "vague-clarifies",
    area: "gate",
    turn: { text: "someone paid for something yesterday", from: "Sam" },
    expect: { asks: true, noTools: "actions" },
    alt: { speaks: false },
  },
];
