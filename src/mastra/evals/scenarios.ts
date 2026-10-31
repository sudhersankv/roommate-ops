// The fixed scenario set for `npm run evals` (scripts/evals.ts). Each scenario runs through the real pipeline
// (Gate + Sonnet + tools) in its own throwaway Group with Maya (Admin), Dev and Sam; the sender is Maya unless set.
// A scenario passes when every check in `expect` holds, or every check in `alt` does (two acceptable behaviours).
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { groupReportText } from "@/jobs/report-text";
import { emptyLearned } from "@/lib/personality";
import { nextWeekday, zonedParts } from "@/lib/time";
import { cart, chatlog, chores, groups, joins, members, money, pantry, personality, receipts, recipes, reminders, toolkits, upkeep } from "@/services";
import type { Ctx } from "@/services/types";

export const EVAL_MEMBERS = ["Maya", "Dev", "Sam"] as const;
export type EvalMember = (typeof EVAL_MEMBERS)[number];

/** `photo` sends the photo the scenario's seed saved (env.photo) with the message. */
export type Turn = { text: string; from?: EvalMember; isReplyToRoomie?: boolean; photo?: boolean; /** A 1:1 message with Roomie. */ private?: boolean };

export type EvalEnv = {
  /** Ctx acting as Maya. */
  ctx: Ctx;
  member: Record<EvalMember, string>;
  as: (name: EvalMember) => Ctx;
  photo?: string;
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
  /** At most this many non-empty lines. */
  maxLines?: number;
  /** Emoji count bounds for the reply. */
  emoji?: { min?: number; max?: number };
  /** Case-insensitive substrings (or regexes) the reply must NOT contain. */
  excludes?: (string | RegExp)[];
  /** No buttons on the reply. */
  noButtons?: boolean;
  /** The Gate's reason, e.g. "hard-trigger". */
  gateReason?: string;
  /** State check after the turn (with Roomie's reply); return an error message or null. */
  check?: (env: EvalEnv, reply: string) => Promise<string | null>;
};

export type Scenario = {
  id: string;
  area: "splitting" | "groceries" | "house" | "reminders" | "core" | "gate" | "personality" | "lease";
  /** Leave the day's greeting unclaimed (the runner claims it for every other scenario so it doesn't add a line). */
  greet?: boolean;
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
  "pantry_list",
  "recipe_link",
  "chore_status",
  "list_reminders",
  "upkeep_status",
  "hall_of_shame",
  "group_report",
  "splitwise_status",
  "list_toolkits",
  "work_order_status",
  "ask_lease",
  "inbox_status",
  "what_do_you_know_about_me",
  "updateWorkingMemory",
]);

/** Words a reply never uses for what Roomie can do: it's Tricks, and learn / forget. */
const TOOLKIT_WORDS = [/toolkit/i, /\bfeatures?\b/i, /\bmodules?\b/i, /\bplugins?\b/i, /\bcapabilit/i, /\benabled?\b/i];

const balanceOf = async (env: EvalEnv, name: EvalMember) => (await money.getBalances(env.ctx)).find((b) => b.name === name)?.cents ?? 0;
const expenseCount = async (env: EvalEnv) => (await money.listExpenses(env.ctx, 50)).length;
const lastExpense = async (env: EvalEnv) => (await money.listExpenses(env.ctx, 1))[0];
const ORDER: EvalMember[] = ["Maya", "Dev", "Sam"];
/** "Maya 4500, Dev 2250, Sam 2250" for the newest Expense. */
const sharesOf = async (env: EvalEnv) =>
  ((await lastExpense(env))?.splits ?? [])
    .sort((a, b) => ORDER.indexOf(a.name as EvalMember) - ORDER.indexOf(b.name as EvalMember))
    .map((s) => `${s.name} ${s.cents}`)
    .join(", ");
const internet = (env: EvalEnv) => money.logExpense(env.ctx, { cents: 6000, description: "internet" });
/** Maya paid $90 for all three, Dev $60 for Dev and Sam: pairwise Dev->Maya 30, Sam->Maya 30, Sam->Dev 30; simplified Sam->Maya 60. */
const dinnerAndCab = async (env: EvalEnv) => {
  await money.logExpense(env.ctx, { cents: 9000, description: "dinner", category: "food" });
  await money.logExpense(env.as("Dev"), { cents: 6000, description: "cab", category: "transport", splitAmong: [env.member.Dev, env.member.Sam] });
};
const fail = (ok: boolean, msg: string) => (ok ? null : msg);
/** The Join code a rotate scenario started with (scenarios run one at a time). */
let joinCodeBefore = "";
/** Groceries has no prices: a "$4.29" in a cart reply is made up. */
const NO_PRICE: RegExp[] = [/\$\d/];
/**
 * ~90 days of purchases ending so that milk (every 9 days) and dish soap (every 14) are probably low today and eggs
 * aren't; with `bundle`, the morning Bundle's "Probably low: milk, dish soap. Add them?" logged as Roomie's line, as
 * the scheduler does, so the next message is in the follow-up window.
 */
const restockHistory = async (env: EvalEnv, opts: { bundle?: boolean } = {}) => {
  const restock = await import("@/services/restock");
  const { addDaysToDay } = await import("@/lib/time");
  const today = await restock.localDay(env.ctx.groupId);
  const habit = (name: string, gap: number, lastAgo: number) =>
    Array.from({ length: Math.floor((90 - lastAgo) / gap) + 1 }, (_, k) => ({ name, memberId: null, occurredOn: addDaysToDay(today, -(lastAgo + k * gap)), source: "cart" as const, sourceId: null }));
  await restock.recordPurchases(env.ctx, [...habit("milk", 9, 8), ...habit("dish soap", 14, 12), ...habit("eggs", 10, 3)]);
  const line = await restock.restockBundleLine(env.ctx);
  if (opts.bundle && line) await chatlog.logMessage(env.ctx.groupId, null, line);
};

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
    expect: {
      tools: ["log_expense"],
      check: async (e) =>
        fail(
          (await sharesOf(e)) === "Maya 4500, Dev 2250, Sam 2250" && (await lastExpense(e))?.method === "percent",
          `percent split 4500/2250/2250, got ${await sharesOf(e)} (${(await lastExpense(e))?.method})`,
        ),
    },
  },
  {
    id: "split-shares-2-2-1",
    area: "splitting",
    turn: { text: "roomie I paid $41.25 for wine and cheese, split it 2:2:1 between me, Dev and Sam" },
    expect: {
      tools: ["log_expense"],
      check: async (e) => fail((await sharesOf(e)) === "Maya 1650, Dev 1650, Sam 825", `shares 1650/1650/825, got ${await sharesOf(e)}`),
    },
  },
  {
    id: "split-exact-doesnt-add-up-asks",
    area: "splitting",
    turn: { text: "roomie I paid $50 for groceries: Dev's part is 30, Sam's 15 and mine 10" },
    expect: { asks: true, check: async (e) => fail((await expenseCount(e)) === 0, "amounts add up to $55, so nothing should be logged") },
  },
  {
    id: "multi-payer",
    area: "splitting",
    turn: { text: "roomie concert tickets were $100, Dev paid 60 and I paid 40, split between the three of us" },
    expect: {
      tools: ["log_expense"],
      check: async (e) => {
        const x = await lastExpense(e);
        const paid = (x?.payers ?? []).map((p) => `${p.name} ${p.cents}`).join(", ");
        return fail(paid === "Dev 6000, Maya 4000" && (await balanceOf(e, "Dev")) === 2666 && (await balanceOf(e, "Maya")) === 667 && (await balanceOf(e, "Sam")) === -3333, `payers Dev 6000 + Maya 4000 and balances +26.66/+6.67/-33.33, got ${paid}`);
      },
    },
  },
  {
    id: "delete-expense",
    area: "splitting",
    seed: async (e) => void (await money.logExpense(e.as("Dev"), { cents: 2400, description: "pizza", category: "food" })),
    turn: { text: "roomie delete the pizza expense" },
    expect: { tools: ["delete_expense"], check: async (e) => fail((await expenseCount(e)) === 0, "pizza deleted") },
  },
  {
    id: "delete-then-undo",
    area: "splitting",
    seed: async (e) => void (await money.logExpense(e.as("Dev"), { cents: 2400, description: "pizza", category: "food" })),
    setup: [{ text: "roomie delete the pizza expense" }],
    turn: { text: "wait no, undo that", isReplyToRoomie: true },
    expect: { tools: ["restore_expense"], check: async (e) => fail((await expenseCount(e)) === 1 && (await balanceOf(e, "Dev")) === 1600, "pizza back, Dev +16.00") },
  },
  {
    id: "set-venmo",
    area: "core",
    turn: { text: "roomie set my venmo to @maya" },
    expect: { tools: ["set_payment_handle"], check: async (e) => fail((await members.getNote(e.member.Maya)).handles?.venmo === "@maya", "Maya's venmo is @maya") },
  },
  {
    id: "owes-pairwise-simplify-off",
    area: "splitting",
    seed: async (e) => {
      await groups.setSimplifyDebts(e.ctx, { on: false });
      await dinnerAndCab(e);
    },
    turn: { text: "roomie who owes what?", from: "Sam" },
    // Pairwise: Dev -> Maya 30, Sam -> Maya 30, Sam -> Dev 30 (simplified would be one $60 payment).
    expect: { tools: ["get_balances"], replyIncludes: ["30"] },
  },
  {
    id: "owes-simplified",
    area: "splitting",
    seed: async (e) => void (await dinnerAndCab(e)),
    turn: { text: "roomie who owes what?", from: "Sam" },
    expect: { tools: ["get_balances"], replyIncludes: ["60"] },
  },
  {
    id: "category-utilities",
    area: "splitting",
    turn: { text: "roomie I paid 54 for the water bill" },
    expect: { tools: ["log_expense"], check: async (e) => fail((await lastExpense(e))?.category === "utilities", `category utilities, got ${(await lastExpense(e))?.category}`) },
  },
  {
    id: "settle-up-pay-links",
    area: "splitting",
    seed: async (e) => {
      await internet(e);
      await members.setPaymentHandles(e.ctx, { venmo: "@maya-r" });
    },
    turn: { text: "roomie settle up with Maya", from: "Dev" },
    expect: { tools: ["settle_up"], replyIncludes: ["20"], check: async (e) => fail((await balanceOf(e, "Dev")) === -2000, "nothing recorded until Dev says it's paid") },
  },
  {
    id: "receipt-photo",
    area: "splitting",
    seed: async (e) => {
      e.photo = (await receipts.saveUpload(e.ctx, Buffer.from("fake receipt"), "image/jpeg")).path;
    },
    turn: { text: "roomie log this receipt, I paid. The steak was Dev's, the rest we all shared", photo: true },
    expect: {
      tools: ["expense_from_receipt"],
      check: async (e) => {
        const x = await lastExpense(e);
        const dev = x?.splits?.find((s) => s.name === "Dev")?.cents ?? 0;
        const maya = x?.splits?.find((s) => s.name === "Maya")?.cents ?? 0;
        return fail(x?.cents === 13797 && x.method === "exact" && dev > maya, `one $137.97 exact expense with Dev's steak, got ${x?.cents} ${x?.method}`);
      },
    },
    alt: { tools: ["expense_from_receipt"], asks: true, check: async (e) => fail((await expenseCount(e)) === 0, "asked first, so nothing logged yet") },
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
    turn: { text: "roomie pagu+� 30 por el uber" },
    expect: { tools: ["log_expense"], replyIncludes: [/(listo|anotad|registr|pagaste|cada un|dividid|hecho|apuntad)/i], check: async (e) => fail((await balanceOf(e, "Maya")) === 2000, "Maya +$20.00") },
  },

  /* ---------- groceries (no prices in any reply, no Cart link unless asked) ---------- */
  {
    id: "add-milk-eggs",
    area: "groceries",
    turn: { text: "roomie add milk and eggs" },
    expect: { tools: ["cart_add"], excludes: NO_PRICE, noButtons: true, maxLines: 2, check: async (e) => fail((await cart.listOpenItems(e.ctx)).length === 2, "2 items in the cart") },
    alt: { asks: true, noTools: ["cart_add"], excludes: NO_PRICE },
  },
  {
    id: "add-eggs-ambiguous-qty",
    area: "groceries",
    turn: { text: "roomie add eggs, 12, 18 for the house" },
    expect: { asks: true, excludes: NO_PRICE, maxLines: 2, check: async (e) => fail(!(await cart.listOpenItems(e.ctx)).some((i) => /egg/i.test(i.name)), "eggs held back until the quantity is clear") },
  },
  {
    id: "add-shared",
    area: "groceries",
    turn: { text: "roomie add dish soap for the whole house" },
    expect: { tools: ["cart_add"], excludes: NO_PRICE, noButtons: true, check: async (e) => fail((await cart.listOpenItems(e.ctx)).some((i) => /soap/i.test(i.name) && i.shared), "dish soap, shared") },
  },
  {
    id: "view-cart",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.as("Dev"), { items: [{ name: "oat milk" }, { name: "bananas", qty: "6" }] })),
    turn: { text: "roomie what's in the cart?" },
    expect: { tools: ["cart_view"], replyIncludes: ["oat milk", "banana"], excludes: NO_PRICE, noButtons: true },
  },
  {
    id: "cart-page-when-asked",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.ctx, { items: [{ name: "oat milk" }] })),
    turn: { text: "roomie where's the cart page?" },
    expect: { tools: ["cart_view"], excludes: [...NO_PRICE, /https?:\/\//] },
    alt: { tools: ["get_dashboard_link"], excludes: NO_PRICE },
  },
  {
    id: "remove-item",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.ctx, { items: [{ name: "milk" }, { name: "bread" }] })),
    turn: { text: "roomie take milk off the list" },
    expect: { tools: ["cart_remove"], excludes: NO_PRICE, noButtons: true, check: async (e) => fail(!(await cart.listOpenItems(e.ctx)).some((i) => i.name === "milk"), "milk removed") },
  },
  {
    id: "removed-on-dashboard-then-asked",
    area: "groceries",
    seed: async (e) => {
      const [eggs] = await cart.addItems(e.as("Dev"), { items: [{ name: "eggs" }] });
      await cart.removeItemById({ ...e.as("Dev"), source: "ui" }, { id: eggs.id });
    },
    turn: { text: "roomie what do I have in the cart?", from: "Dev" },
    expect: {
      replyIncludes: [/egg/i, /dashboard|took .*off|took off|removed/i],
      excludes: [...NO_PRICE, /went through|isn't showing|sorry|apolog/i],
      maxLines: 2,
      noButtons: true,
    },
  },
  {
    id: "photo-list-all-common",
    area: "groceries",
    seed: async (e) => {
      e.photo = (await receipts.saveUpload(e.ctx, Buffer.from("a shopping list"), "image/jpeg")).path;
    },
    turn: { text: "roomie all common", photo: true },
    // Either it asks once with the list in one line, or (the caption said "all common") it adds them as shared.
    expect: { tools: ["cart_from_photo"], asks: true, maxLines: 2, excludes: [...NO_PRICE, /can't (open|see|read)/i], check: async (e) => fail((await cart.listOpenItems(e.ctx)).length === 0, "asked first, so nothing added yet") },
    alt: { tools: ["cart_from_photo"], excludes: [...NO_PRICE, /can't (open|see|read)/i], check: async (e) => fail((await cart.listOpenItems(e.ctx)).filter((i) => i.shared).length >= 4, "the list's items, shared") },
  },
  {
    // Groceries needs Money, so a receipt with Money off means both are off: Roomie says it hasn't learned Money here.
    id: "photo-receipt-money-off",
    area: "groceries",
    seed: async (e) => {
      await toolkits.setToolkit(e.ctx, { toolkit: "groceries", enabled: false });
      await toolkits.setToolkit(e.ctx, { toolkit: "splitting", enabled: false });
      e.photo = (await receipts.saveUpload(e.ctx, Buffer.from("a receipt"), "image/jpeg")).path;
    },
    turn: { text: "roomie split this", photo: true },
    // "I haven't learned Money here ... say 'roomie, learn money'".
    expect: { replyIncludes: [/money/i], noTools: "actions", maxLines: 2, excludes: [/can't (open|see)/i], check: async (e) => fail((await expenseCount(e)) === 0 && (await cart.listOpenItems(e.ctx)).length === 0, "nothing logged or added") },
  },
  {
    id: "checkout-link",
    area: "groceries",
    seed: async (e) => void (await cart.addItems(e.ctx, { items: [{ name: "milk" }, { name: "eggs", qty: "1 dozen" }], shared: true })),
    turn: { text: "roomie checkout" },
    expect: {
      tools: ["cart_checkout"],
      replyIncludes: [/\b(2|two)\b/i],
      excludes: NO_PRICE,
      check: async (e) => fail(!!(await cart.lastUnpaidCheckout(e.ctx))?.url?.startsWith("https://instacart.example/lists/"), "a Checkout with the (fake) Instacart list link"),
    },
  },
  {
    id: "paid-84-after-checkout",
    area: "groceries",
    seed: async (e) => {
      await cart.addItems(e.ctx, { items: [{ name: "oat milk" }] });
      await cart.addItems(e.as("Dev"), { items: [{ name: "greek yogurt" }] });
      await cart.addItems(e.as("Sam"), { items: [{ name: "coffee" }, { name: "dish soap" }], shared: true });
      await cart.checkout(e.ctx);
    },
    turn: { text: "roomie I paid 84 for the groceries" },
    expect: {
      tools: ["cart_purchased"],
      noTools: ["log_expense"],
      replyIncludes: ["Dev", "Sam"],
      check: async (e) => {
        const x = await lastExpense(e);
        const paid = await cart.lastUnpaidCheckout(e.ctx);
        return fail(x?.cents === 8400 && x.method === "exact" && x.category === "groceries" && x.payerName === "Maya" && !paid && (await cart.listOpenItems(e.ctx)).length === 0, `one $84 exact groceries Expense paid by Maya and the Checkout paid, got ${x?.cents} ${x?.method} ${x?.category}`);
      },
    },
  },
  {
    id: "add-chicken-for-house",
    area: "groceries",
    turn: { text: "roomie add 2 lb chicken for the house", from: "Dev" },
    expect: {
      tools: ["cart_add"],
      excludes: NO_PRICE,
      noButtons: true,
      check: async (e) => {
        const c = (await cart.listOpenItems(e.ctx)).find((i) => /chicken/i.test(i.name));
        return fail(!!c && c.shared && c.quantity === 2 && c.unit === "pound", `shared chicken, 2 pound, got ${JSON.stringify(c ?? null)}`);
      },
    },
  },
  {
    id: "out-of-dish-soap",
    area: "groceries",
    turn: { text: "roomie we're out of dish soap", from: "Sam" },
    expect: { tools: ["cart_add"], excludes: NO_PRICE, check: async (e) => fail((await cart.listOpenItems(e.ctx)).some((i) => /soap/i.test(i.name) && i.shared), "dish soap, shared") },
    alt: { asks: true, noTools: "actions" },
  },
  {
    id: "recipe-tacos-friday",
    area: "groceries",
    turn: { text: "roomie tacos for 5 on friday" },
    expect: {
      tools: ["recipe_draft"],
      noTools: ["cart_add", "recipe_add_to_cart"],
      asks: true,
      long: true,
      check: async (e) => {
        const [r] = await recipes.listRecipes(e.ctx, 1);
        const friday = !!r?.plannedFor && new Date(`${r.plannedFor}T12:00:00Z`).getUTCDay() === 5;
        return fail(!!r && r.servings === 5 && friday && (await cart.listOpenItems(e.ctx)).length === 0, `a Recipe for 5 planned on a Friday and an empty Cart, got ${r?.servings} ${r?.plannedFor}`);
      },
    },
  },
  {
    id: "recipe-yes-add-them",
    area: "groceries",
    setup: [{ text: "roomie tacos for 5 on friday" }],
    turn: { text: "yes add them, we have onions" },
    expect: {
      tools: ["recipe_add_to_cart"],
      check: async (e) => {
        const open = await cart.listOpenItems(e.ctx);
        const fromRecipe = open.filter((i) => i.recipeId);
        return fail(fromRecipe.length >= 3 && fromRecipe.every((i) => i.shared) && !open.some((i) => /onion/i.test(i.name)), `the Recipe's ingredients, shared, minus onions; got ${open.map((i) => i.name).join(", ")}`);
      },
    },
  },
  {
    id: "recipe-explicit-add",
    area: "groceries",
    turn: { text: "roomie make us a pasta recipe for 3 and put the ingredients in the cart", from: "Sam" },
    expect: { tools: ["recipe_draft", "recipe_add_to_cart"], long: true, check: async (e) => fail((await cart.listOpenItems(e.ctx)).filter((i) => i.recipeId).length >= 3, "ingredients in the cart") },
  },
  {
    id: "recipe-instacart-link",
    area: "groceries",
    seed: async (e) => void (await recipes.saveRecipe(e.ctx, recipes.parseRecipeJson(recipes.SAMPLE_RECIPE_JSON))),
    turn: { text: "roomie send me the instacart link for the tacos", from: "Dev" },
    expect: { tools: ["recipe_link"], noTools: ["recipe_add_to_cart", "cart_add"] },
  },
  {
    id: "view-cart-recipe",
    area: "groceries",
    seed: async (e) => {
      const r = await recipes.saveRecipe(e.ctx, recipes.parseRecipeJson(recipes.SAMPLE_RECIPE_JSON));
      await recipes.addRecipeToCart(e.ctx, r.id);
      await cart.addItems(e.as("Dev"), { items: [{ name: "oat milk" }] });
    },
    turn: { text: "roomie what's in the cart?", from: "Sam" },
    expect: { tools: ["cart_view"], replyIncludes: ["oat milk", /taco|tortilla/i], excludes: NO_PRICE, long: true },
  },
  {
    id: "pantry-set",
    area: "groceries",
    turn: { text: "roomie we always have salt and oil" },
    expect: {
      tools: ["pantry_set"],
      check: async (e) => {
        const p = await pantry.getPantry(e.ctx);
        return fail(p.includes("salt") && p.some((x) => /oil/.test(x)), `salt and oil in the Pantry, got ${p.join(", ")}`);
      },
    },
  },
  {
    id: "pantry-list",
    area: "groceries",
    seed: async (e) => void (await pantry.updatePantry(e.ctx, { add: ["salt", "oil", "rice"] })),
    turn: { text: "roomie what do we always have?", from: "Dev" },
    expect: { tools: ["pantry_list"], replyIncludes: ["salt", "oil", "rice"] },
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
    expect: { tools: ["cart_add"], excludes: NO_PRICE, check: async (e) => fail((await cart.listOpenItems(e.ctx)).some((i) => /chip/i.test(i.name)), "chips in the cart") },
    // The persona asks "for you or the whole group?" before adding; picking up the follow-up is what's tested.
    alt: { asks: true, replyIncludes: ["chip"], noTools: "actions" },
  },

  /* ---------- chores ---------- */
  {
    id: "did-dishes",
    area: "house",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 })),
    turn: { text: "roomie I did the dishes", from: "Dev" },
    expect: { tools: ["log_chore"], check: async (e) => fail((await chores.choreStatus(e.ctx)).find((c) => c.name === "Dishes")?.lastDoneBy === "Dev", "Dishes done by Dev") },
  },
  {
    id: "did-dishes-unprompted-asks",
    area: "house",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 })),
    turn: { text: "I did the dishes", from: "Dev" },
    expect: { asks: true, noTools: ["log_chore"] },
  },
  {
    id: "whose-turn",
    area: "house",
    seed: async (e) => {
      await chores.addChore(e.ctx, { name: "Take out trash", everyDays: 3 });
      await chores.logChore(e.ctx, { chore: "trash" });
    },
    turn: { text: "roomie whose turn is it to take out the trash?", from: "Sam" },
    expect: { tools: ["chore_status"], replyIncludes: [/dev|sam/i] },
  },
  {
    id: "add-chore",
    area: "house",
    turn: { text: "roomie add vacuuming to the chart, every 7 days" },
    expect: { tools: ["chore_add"], check: async (e) => fail((await chores.choreStatus(e.ctx)).some((c) => /vacuum/i.test(c.name)), "vacuuming on the chart") },
  },
  {
    id: "chore-for-someone-else",
    area: "house",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Take out trash", everyDays: 3 })),
    turn: { text: "roomie Dev took out the trash" },
    expect: { tools: ["log_chore"], check: async (e) => fail((await chores.choreStatus(e.ctx)).find((c) => /trash/i.test(c.name))?.lastDoneBy === "Dev", "trash done by Dev") },
  },
  {
    id: "whose-turn-rotation",
    area: "house",
    seed: async (e) => {
      await chores.addChore(e.ctx, { name: "Take out trash", everyDays: 2, rotation: [e.member.Maya, e.member.Dev, e.member.Sam] });
      await chores.logChore(e.ctx, { chore: "trash" });
    },
    turn: { text: "roomie whose turn is trash?", from: "Sam" },
    expect: { tools: ["chore_status"], replyIncludes: ["Dev"] },
  },
  {
    id: "skip-my-turn",
    area: "house",
    seed: async (e) => void (await chores.addChore(e.ctx, { name: "Take out trash", everyDays: 2, rotation: [e.member.Dev, e.member.Sam, e.member.Maya] })),
    turn: { text: "roomie can you skip my turn on trash? I'm away tonight", from: "Dev" },
    expect: {
      tools: ["chore_skip"],
      replyIncludes: ["Sam"],
      check: async (e) => fail((await chores.choreStatus(e.ctx)).find((c) => c.name === "Take out trash")?.whoseTurn === "Sam", "Sam is up after Dev passes"),
    },
  },
  {
    id: "add-chore-rotation",
    area: "house",
    turn: { text: "roomie add mopping every 3 days: Sam first, then Dev, then me" },
    expect: {
      tools: ["chore_add"],
      check: async (e) => {
        const c = (await chores.choreStatus(e.ctx)).find((x) => /mop/i.test(x.name));
        const order = c?.order.map((p) => p.name).join(",");
        return fail(c?.everyDays === 3 && !!c.rotation && order === "Sam,Dev,Maya", `mopping every 3 days, Sam, Dev, Maya; got ${c?.everyDays} ${order}`);
      },
    },
  },
  {
    id: "the-chart",
    area: "house",
    seed: async (e) => {
      await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 });
      await chores.logChore(e.ctx, { chore: "dishes" });
      await chores.logChore(e.as("Dev"), { chore: "dishes" });
    },
    turn: { text: "roomie who's been slacking on chores this week?", from: "Dev" },
    expect: { tools: ["hall_of_shame"], replyIncludes: ["Sam"] },
    alt: { tools: ["chore_status"], replyIncludes: ["Sam"] },
  },

  /* ---------- upkeep ---------- */
  {
    id: "track-ac-filter",
    area: "house",
    turn: { text: "roomie track the AC filter, it needs changing every 90 days" },
    expect: { tools: ["upkeep_add"], check: async (e) => fail((await upkeep.listMaintenance(e.ctx)).some((m) => m.everyDays === 90), "an upkeep item every 90 days") },
  },
  {
    id: "maintenance-done",
    area: "house",
    seed: async (e) => void (await upkeep.addMaintenance(e.ctx, { item: "Replace HVAC filter", everyDays: 90 })),
    turn: { text: "roomie I replaced the hvac filter", from: "Dev" },
    expect: { tools: ["upkeep_done"], check: async (e) => fail((await upkeep.listMaintenance(e.ctx))[0]?.status === "ok", "filter marked done") },
  },
  {
    id: "air-filter-done",
    area: "house",
    seed: async (e) => void (await upkeep.addDefaults(e.ctx)),
    turn: { text: "roomie changed the air filter", from: "Sam" },
    expect: {
      tools: ["upkeep_done"],
      check: async (e) => fail((await upkeep.listMaintenance(e.ctx)).find((m) => /filter/i.test(m.item))?.status === "ok", "the filter is marked done"),
    },
  },
  {
    id: "whats-due-this-week",
    area: "house",
    seed: async (e) => {
      await upkeep.addDefaults(e.ctx);
      await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 });
    },
    turn: { text: "roomie what's due this week?" },
    expect: { tools: ["upkeep_status"], replyIncludes: [/smoke|filter|dryer|extinguisher|coffee/i] },
    alt: { tools: ["chore_status"], replyIncludes: [/dishes/i] },
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
        // The stored instant is 20:00 Chicago on the coming Tuesday, whatever the offset that day (CST after Nov 1).
        const want = nextWeekday("America/Chicago", 2, 20, new Date(Date.now() - 5 * 60_000));
        return fail(r.dueAt.getTime() === want.getTime() && r.memberId === null, `${want.toISOString()} for everyone, got ${r.dueAt.toISOString()} (${r.memberName ?? "everyone"})`);
      },
    },
  },
  {
    id: "remind-rent-monthly",
    area: "reminders",
    turn: { text: "roomie remind me to pay rent on the 1st, every month" },
    expect: {
      tools: ["set_reminder"],
      check: async (e) => {
        const [r] = await reminders.listReminders(e.ctx);
        if (!r) return "no reminder";
        const p = zonedParts("America/Chicago", r.dueAt);
        return fail(r.memberId === e.member.Maya && r.recurring === "monthly" && p.day === 1 && r.dueAt.getTime() > Date.now(), `Maya's monthly reminder on the 1st, got ${r.memberName} ${r.recurring} day ${p.day}`);
      },
    },
  },
  {
    id: "remind-dev-private",
    area: "reminders",
    turn: { text: "roomie remind Dev to pay me back for brunch on friday at 6pm" },
    expect: {
      tools: ["set_reminder"],
      check: async (e) => {
        const [r] = await reminders.listReminders(e.ctx);
        if (!r) return "no reminder";
        const p = zonedParts("America/Chicago", r.dueAt);
        return fail(r.memberId === e.member.Dev && r.createdBy === e.member.Maya && p.weekday === 5 && p.hour === 18, `Dev, set by Maya, Friday 18:00, got ${r.memberName} weekday ${p.weekday} ${p.hour}:00`);
      },
    },
  },
  {
    id: "weekly-report-verbatim",
    area: "core",
    seed: async (e) => {
      await internet(e);
      await chores.addChore(e.ctx, { name: "Dishes", everyDays: 1 });
      await chores.logChore(e.as("Dev"), { chore: "dishes" });
    },
    turn: { text: "roomie weekly report please" },
    expect: {
      tools: ["group_report"],
      long: true,
      check: async (e, reply) => {
        const want = await groupReportText(e.ctx.groupId);
        return fail(reply.trim() === want.trim(), `reply isn't the report verbatim:\n${reply}`);
      },
    },
  },
  {
    id: "setup-india-household",
    area: "core",
    seed: async (e) => void (await db.update(schema.groups).set({ onboardedAt: null }).where(eq(schema.groups.id, e.ctx.groupId))),
    setup: [{ text: "roomie hi" }],
    turn: { text: "we're roommates, INR, India time" },
    expect: {
      tools: ["set_group_settings"],
      check: async (e) => {
        const g = await groups.getGroup(e.ctx.groupId);
        const chart = await chores.choreStatus(e.ctx);
        const items = await upkeep.listMaintenance(e.ctx);
        return fail(g?.timezone === "Asia/Kolkata" && g.currency === "INR" && chart.length === 3 && items.length === 5, `India, INR, 3 starter chores, 5 upkeep; got ${g?.timezone} ${g?.currency} ${chart.length} ${items.length}`);
      },
      replyIncludes: [/learned/i],
      excludes: TOOLKIT_WORDS,
    },
  },
  {
    id: "setup-trip",
    area: "core",
    seed: async (e) => {
      await db.update(schema.groups).set({ onboardedAt: null }).where(eq(schema.groups.id, e.ctx.groupId));
      await groups.initToolkits(e.ctx.groupId); // the join-time default: every defaultOn Trick
    },
    setup: [{ text: "roomie hi" }],
    turn: { text: "it's a trip! EUR, Lisbon time" },
    expect: {
      tools: ["set_group_settings"],
      replyIncludes: [/learned money and groceries/i],
      excludes: [...TOOLKIT_WORDS, /learned[^.]*house/i],
      check: async (e) => {
        const g = await groups.getGroup(e.ctx.groupId);
        const on = [...(await groups.enabledToolkits(e.ctx))].sort().join(",");
        return fail(g?.purpose === "trip" && g.currency === "EUR" && on === "groceries,splitting", `trip, EUR, Money + Groceries only; got ${g?.purpose} ${g?.currency} ${on}`);
      },
    },
  },
  {
    id: "setup-from-dm",
    area: "core",
    seed: async (e) => {
      await db.update(schema.groups).set({ onboardedAt: null }).where(eq(schema.groups.id, e.ctx.groupId));
      await groups.initToolkits(e.ctx.groupId);
    },
    turn: { text: "roommates, USD, Chicago", private: true },
    expect: {
      tools: ["set_group_settings"],
      replyIncludes: [/learned/i],
      excludes: [...TOOLKIT_WORDS, /\/claim\//],
      check: async (e) => {
        const g = await groups.getGroup(e.ctx.groupId);
        const posted = (await chatlog.roomieLines(e.ctx.groupId, 10)).map((l) => l.text);
        const inGroup = posted.some((t) => /^Learned /.test(t) && /\/j\/[a-z2-7]{10}\. Sign in with Google and pick your name\./.test(t));
        return fail(g?.purpose === "roommates" && g.timezone === "America/Chicago" && inGroup, `roommates in Chicago, and the learned + Join link lines in the group chat; got ${g?.purpose} ${g?.timezone} / ${posted.join(" | ")}`);
      },
    },
  },
  {
    id: "dashboard-for-everyone",
    area: "core",
    turn: { text: "roomie send us the dashboard", from: "Dev" },
    expect: { tools: ["get_dashboard_link"], replyIncludes: [/\/j\/[a-z2-7]{10}/], excludes: [/\/claim\//, /\/g\/[0-9a-f-]{36}/], noButtons: true },
  },
  {
    id: "rotate-join-link-admin",
    area: "core",
    seed: async (e) => void (joinCodeBefore = await joins.ensureJoinCode(e.ctx.groupId)),
    turn: { text: "roomie rotate the join link, the old one got shared outside the group" },
    expect: {
      tools: ["rotate_join_link"],
      replyIncludes: [/\/j\/[a-z2-7]{10}/],
      check: async (e) => {
        const now = await joins.ensureJoinCode(e.ctx.groupId);
        return fail(now !== joinCodeBefore && !(await joins.groupByCode(joinCodeBefore)), "a new code, the old one dead");
      },
    },
  },
  {
    id: "rotate-join-link-member-refused",
    area: "core",
    seed: async (e) => void (joinCodeBefore = await joins.ensureJoinCode(e.ctx.groupId)),
    turn: { text: "roomie rotate the join link", from: "Sam" },
    expect: {
      replyIncludes: [/admin|maya/i],
      check: async (e) => fail((await joins.ensureJoinCode(e.ctx.groupId)) === joinCodeBefore, "the code changed for a non-admin"),
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
    // Dev asked, so "you" counts for Dev.
    expect: { replyIncludes: ["Maya", /Dev|you/, "Sam"] },
  },

  /* ---------- Tricks (teaching Roomie from the chat; Toolkits in code) ---------- */
  {
    id: "what-can-you-do",
    area: "core",
    turn: { text: "roomie what can you do?", from: "Sam" },
    expect: { tools: ["list_toolkits"], noTools: "actions", replyIncludes: [/money|split|expense|cost|paid/i], excludes: TOOLKIT_WORDS },
  },
  {
    id: "what-tricks-brief",
    area: "core",
    seed: async (e) => void (await toolkits.setToolkit(e.ctx, { toolkit: "house", enabled: false })),
    turn: { text: "roomie what tricks do you have?", from: "Sam" },
    // "Money and Groceries here. Admins can add House."
    expect: { tools: ["list_toolkits"], noTools: "actions", replyIncludes: [/money|split/i, /groceries/i], maxLines: 2, excludes: [...TOOLKIT_WORDS, /https?:\/\//, /coming (soon|later)|research|stickers/i] },
  },
  {
    id: "learn-outings-not-yet",
    area: "core",
    turn: { text: "roomie learn outings" },
    expect: {
      noTools: ["set_group_settings"],
      replyIncludes: [/not (ready|yet|there)|on the list|coming soon|can't learn/i],
      excludes: TOOLKIT_WORDS,
      check: async (e) => fail(!(await toolkits.catalogFor(e.ctx)).some((t) => t.manifest.id === "outings" && t.enabled), "outings stays off"),
    },
  },
  {
    id: "learn-house",
    area: "core",
    seed: async (e) => void (await toolkits.setToolkit(e.ctx, { toolkit: "house", enabled: false })),
    turn: { text: "roomie learn house" },
    expect: {
      tools: ["toggle_toolkit"],
      replyIncludes: [/learn|house/i],
      excludes: TOOLKIT_WORDS,
      check: async (e) => fail((await groups.enabledToolkits(e.ctx)).includes("house"), "house is learned"),
    },
  },
  {
    id: "forget-groceries-member",
    area: "core",
    turn: { text: "roomie forget groceries", from: "Dev" },
    expect: {
      replyIncludes: [/admin|Maya/i],
      excludes: TOOLKIT_WORDS,
      check: async (e) => fail((await groups.enabledToolkits(e.ctx)).includes("groceries"), "groceries is still learned"),
    },
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

  /* ---------- personality (ADR 0012, one voice since ADR 0020) ---------- */
  // The same message in the one voice: brief, at most one emoji, whatever a Group stored before.
  {
    id: "one-voice-chill",
    area: "personality",
    turn: { text: "roomie I paid $60 for internet" },
    expect: { tools: ["log_expense"], replyIncludes: ["60"], maxLines: 2, emoji: { max: 1 } },
  },
  {
    id: "one-voice-ignores-stored-hype",
    area: "personality",
    seed: async (e) => void (await personality.updatePersonality(e.ctx, { base: "hype", name: "Dino", quirks: ["loves confetti"] })),
    turn: { text: "roomie I paid $60 for internet" },
    expect: { tools: ["log_expense"], replyIncludes: ["60"], maxLines: 2, emoji: { max: 1 }, excludes: [/!!|=���|=�Ѧ|let'?s go/i] },
  },
  {
    id: "one-voice-ignores-stored-deadpan",
    area: "personality",
    seed: async (e) => void (await personality.updatePersonality(e.ctx, { base: "deadpan" })),
    turn: { text: "roomie I paid $60 for internet" },
    expect: { tools: ["log_expense"], replyIncludes: ["60"], maxLines: 2, emoji: { max: 1 } },
  },
  // A stored pet name is no longer a trigger word (ADR 0020): "dino ..." is an ordinary line for the Gate.
  {
    id: "name-dino-is-not-a-trigger",
    area: "personality",
    seed: async (e) => void (await personality.updatePersonality(e.ctx, { name: "Dino" })),
    turn: { text: "dino add oat milk for me", from: "Dev" },
    expect: { gateReason: "jev-act", tools: ["cart_add"] },
    alt: { speaks: false },
  },
  {
    id: "nickname-not-before-3",
    area: "personality",
    seed: async (e) => {
      await internet(e);
      await personality.saveLearned(e.ctx.groupId, { ...emptyLearned(), messagesSeen: 90, confidence: 0.42, nicknames: [{ nickname: "Devvy", member: "Dev", count: 2 }], tone: ["teasing"] });
      await chatlog.logMessage(e.ctx.groupId, e.member.Maya, "devvy you still owe me lol");
      await chatlog.logMessage(e.ctx.groupId, e.member.Sam, "classic devvy");
    },
    turn: { text: "roomie who owes what?", from: "Sam" },
    expect: { tools: ["get_balances"], replyIncludes: ["Dev", "20"], excludes: [/devvy/i] },
  },
  {
    id: "slang-low-confidence",
    area: "personality",
    seed: async (e) =>
      void (await personality.saveLearned(e.ctx.groupId, { ...emptyLearned(), messagesSeen: 40, confidence: 0.22, slang: [{ phrase: "no cap", count: 12 }, { phrase: "bussin", count: 9 }], slangRate: 0.5 })),
    turn: { text: "roomie I paid 30 for pizza no cap, it was bussin", from: "Dev" },
    expect: { tools: ["log_expense"], excludes: [/\bno cap\b/i, /\bbussin\b/i] },
  },
  {
    id: "slang-budget-spent",
    area: "personality",
    seed: async (e) => {
      await personality.saveLearned(e.ctx.groupId, { ...emptyLearned(), messagesSeen: 110, confidence: 0.5, slang: [{ phrase: "no cap", count: 20 }, { phrase: "bussin", count: 9 }], slangRate: 0.4 });
      await chatlog.logMessage(e.ctx.groupId, null, "logged, no cap. $10 each");
    },
    turn: { text: "roomie I paid 30 for pizza, it was bussin", from: "Dev" },
    expect: { tools: ["log_expense"], excludes: [/\bno cap\b/i, /\bbussin\b/i] },
  },
  {
    id: "greeting-first-message",
    area: "personality",
    greet: true,
    turn: { text: "morning all", from: "Dev" },
    expect: { maxLines: 1, noButtons: true, noTools: "actions" },
  },
  {
    id: "greeting-once-a-day",
    area: "personality",
    greet: true,
    setup: [{ text: "morning all", from: "Dev" }],
    turn: { text: "ok see you at 7", from: "Sam" },
    expect: { speaks: false },
  },
  {
    id: "pet-command",
    area: "personality",
    turn: { text: "/pet", from: "Sam" },
    expect: { gateReason: "hard-trigger", maxLines: 2, noTools: "actions" },
  },
  {
    id: "remember-vegetarian",
    area: "personality",
    turn: { text: "roomie remember I'm vegetarian" },
    expect: { tools: ["remember"], check: async (e) => fail(/vegetarian/i.test((await members.getNote(e.member.Maya)).diet ?? ""), "Maya's diet: vegetarian") },
  },
  {
    id: "recipe-respects-diet",
    area: "personality",
    seed: async (e) => void (await members.rememberAboutMe(e.ctx, { diet: "vegetarian" })),
    turn: { text: "roomie write me a dinner recipe for tonight, just for me" },
    expect: {
      tools: ["recipe_draft"],
      long: true,
      check: async (e) => {
        const [r] = await recipes.listRecipes(e.ctx, 1);
        const meat = (r?.ingredients ?? []).filter((i) => /\b(chicken|beef|pork|bacon|meat|steak|fish|salmon|tuna|shrimp|turkey|sausage|ham|lamb|anchov)/i.test(i.name));
        return fail(!!r && meat.length === 0, `a Recipe with no meat, got ${r ? meat.map((i) => i.name).join(", ") || "none" : "no recipe"}`);
      },
    },
  },
  {
    id: "what-do-you-know-about-me",
    area: "personality",
    seed: async (e) => void (await members.rememberAboutMe(e.as("Dev"), { diet: "vegan", caresAbout: "the plant" })),
    turn: { text: "roomie what do you know about me?", from: "Dev" },
    expect: { tools: ["what_do_you_know_about_me"], replyIncludes: ["vegan"] },
  },
  {
    id: "what-do-you-know-about-others",
    area: "personality",
    seed: async (e) => void (await members.rememberAboutMe(e.as("Dev"), { diet: "vegan", allergies: "peanuts" })),
    turn: { text: "roomie what do you know about Dev?", from: "Sam" },
    expect: { excludes: [/vegan/i, /peanut/i] },
  },

  /* ---------- polls and DMs (#24B, ADR 0018, ADR 0020) ---------- */
  {
    id: "pizza-no-poll",
    area: "splitting",
    turn: { text: "roomie I paid 60 for pizza" },
    expect: {
      tools: ["log_expense"],
      noTools: ["ask_poll"],
      check: async (e) => fail((await balanceOf(e, "Dev")) === -2000 && (await balanceOf(e, "Sam")) === -2000, "an even split at once, no poll"),
    },
  },
  {
    id: "pizza-not-sure-who-polls",
    area: "splitting",
    turn: { text: "roomie I paid 60 for pizza, not sure who was in though" },
    expect: {
      tools: ["ask_poll"],
      noTools: ["log_expense"],
      check: async (e) => {
        const open = await db.select().from(schema.polls).where(eq(schema.polls.groupId, e.ctx.groupId));
        const about = open[0]?.about as { kind?: string; cents?: number } | undefined;
        return fail(open.length === 1 && about?.kind === "who-in" && about.cents === 6000 && open[0].options.length <= 4 && (await expenseCount(e)) === 0, "one who's-in poll about $60, nothing logged yet");
      },
    },
  },
  {
    id: "dm-paid-maya",
    area: "splitting",
    seed: async (e) => void (await money.logExpense(e.as("Maya"), { cents: 6000, description: "internet", category: "utilities" })),
    turn: { text: "paid Maya", from: "Dev", private: true },
    expect: {
      tools: ["settle_up"],
      check: async (e) => {
        const posted = (await chatlog.roomieLines(e.ctx.groupId, 10)).map((l) => l.text);
        return fail((await balanceOf(e, "Dev")) === 0 && !posted.some((t) => /paid|\$20/i.test(t)), `a Settlement, and nothing in the group; group lines: ${posted.join(" | ")}`);
      },
    },
  },
  {
    id: "dm-pizza-echoes",
    area: "splitting",
    turn: { text: "I paid 40 for pizza", from: "Dev", private: true },
    expect: {
      tools: ["log_expense"],
      check: async (e) => {
        const posted = (await chatlog.roomieLines(e.ctx.groupId, 10)).map((l) => l.text);
        return fail(posted.filter((t) => /^Dev logged \$40\.00 pizza, split 3 ways\.$/.test(t)).length === 1, `one group line; got ${posted.join(" | ")}`);
      },
    },
  },
  {
    id: "stop-nudging-me",
    area: "core",
    turn: { text: "roomie stop nudging me", from: "Sam" },
    expect: { tools: ["set_nudges"], maxLines: 1, check: async (e) => fail(await members.nudgesOff(e.member.Sam), "Sam's nudges are off") },
  },
  // ---------- rent and bills (#25) ----------
  {
    id: "set-rent",
    area: "splitting",
    turn: { text: "roomie rent is 2400 on the 1st, I pay it" },
    expect: {
      tools: ["set_rent"],
      maxLines: 2,
      check: async (e) => {
        const { getRent } = await import("@/services/rent");
        const r = await getRent(e.ctx);
        return fail(!!r && r.cents === 240000 && r.dueDay === 1 && r.payerId === e.member.Maya, `rent $2,400 on the 1st paid by Maya, got ${r ? `${r.cents} on ${r.dueDay}` : "none"}`);
      },
    },
  },
  {
    id: "rent-status",
    area: "splitting",
    seed: async (e) => {
      const { setRent } = await import("@/services/rent");
      await setRent(e.ctx, { cents: 240000, dueDay: 1 });
    },
    turn: { text: "roomie what's our rent?", from: "Sam" },
    expect: { tools: ["rent_status"], replyIncludes: ["2,400"], maxLines: 2 },
  },
  {
    id: "answer-amount",
    area: "splitting",
    seed: async (e) => {
      const { runRecurring, setVariableExpense } = await import("@/services/recurring");
      const { zonedTimeToUtc } = await import("@/lib/time");
      const bill = await setVariableExpense(e.as("Dev"), { description: "Electric", dueDay: 20 });
      const [year, month, day] = bill.occurredOn!.split("-").map(Number);
      await runRecurring(zonedTimeToUtc("America/Chicago", { year, month, day, hour: 10, minute: 0 }), { groupId: e.ctx.groupId });
    },
    turn: { text: "roomie electric was 92", from: "Dev" },
    expect: { tools: ["answer_amount"], replyIncludes: ["92"] },
  },
  // ---------- restock (#26) ----------
  {
    id: "restock-yes-adds-listed",
    area: "groceries",
    seed: async (e) => void (await restockHistory(e, { bundle: true })),
    turn: { text: "yes add them", from: "Dev" },
    expect: {
      tools: ["restock_add_listed"],
      excludes: NO_PRICE,
      maxLines: 2,
      noButtons: true,
      check: async (e) => {
        const open = await cart.listOpenItems(e.ctx);
        return fail(["milk", "dish soap"].every((n) => open.some((i) => i.name === n && i.shared)), `milk and dish soap, shared, got ${open.map((i) => i.name).join(", ")}`);
      },
    },
  },
  {
    id: "restock-just-the-milk",
    area: "groceries",
    seed: async (e) => void (await restockHistory(e, { bundle: true })),
    turn: { text: "just the milk", from: "Sam" },
    expect: {
      tools: ["restock_add_listed"],
      excludes: NO_PRICE,
      maxLines: 2,
      check: async (e) => {
        const names = (await cart.listOpenItems(e.ctx)).map((i) => i.name);
        return fail(names.includes("milk") && !names.includes("dish soap"), `only milk, got ${names.join(", ")}`);
      },
    },
  },
  {
    id: "restock-mute-dish-soap",
    area: "groceries",
    seed: async (e) => void (await restockHistory(e, { bundle: true })),
    turn: { text: "roomie we don't buy dish soap anymore" },
    expect: {
      tools: ["restock_mute"],
      noTools: ["restock_add_listed", "cart_add"],
      excludes: NO_PRICE,
      maxLines: 2,
      check: async (e) => {
        const { getMutes } = await import("@/services/restock");
        return fail((await getMutes(e.ctx)).includes("dish soap"), "dish soap muted");
      },
    },
  },
  {
    id: "restock-status",
    area: "groceries",
    seed: async (e) => void (await restockHistory(e)),
    turn: { text: "roomie what are we low on?", from: "Dev" },
    expect: { tools: ["restock_status"], replyIncludes: ["milk", "dish soap"], excludes: NO_PRICE, maxLines: 2 },
  },
  {
    id: "checkout-asks-about-low",
    area: "groceries",
    seed: async (e) => {
      await restockHistory(e);
      await cart.addItems(e.ctx, { items: [{ name: "bread" }], shared: true });
    },
    turn: { text: "roomie checkout" },
    expect: {
      tools: ["cart_checkout"],
      asks: true,
      replyIncludes: ["milk", /probably low/i],
      excludes: NO_PRICE,
      noButtons: true,
      maxLines: 2,
      check: async (e) => fail(!(await cart.lastUnpaidCheckout(e.ctx)), "no Instacart list before they answer"),
    },
  },
  {
    id: "checkout-just-checkout",
    area: "groceries",
    seed: async (e) => {
      await restockHistory(e);
      await cart.addItems(e.ctx, { items: [{ name: "bread" }], shared: true });
    },
    turn: { text: "roomie just checkout" },
    expect: {
      tools: ["cart_checkout"],
      excludes: [...NO_PRICE, /probably low/i, /want me to add/i],
      check: async (e) => fail(!!(await cart.lastUnpaidCheckout(e.ctx)), "a Checkout, no question"),
    },
  },
  // ---------- Lease Inbox (#27; MAIL_FAKE=1, MAIL_CLASSIFIER_FAKE=1) ----------
  {
    id: "lease-learn",
    area: "lease",
    turn: { text: "roomie learn lease inbox" },
    expect: {
      tools: ["toggle_toolkit"],
      excludes: TOOLKIT_WORDS,
      check: async (e) => {
        const { inboxOf } = await import("@/services/lease-inbox");
        const inbox = await inboxOf(e.ctx.groupId);
        if (!inbox) return "no address made";
        const said = (await chatlog.roomieLines(e.ctx.groupId, 10)).some((l) => l.text.includes(inbox.address));
        return fail(said, `the address ${inbox.address} wasn't said in the chat`);
      },
    },
  },
  {
    id: "lease-report-issue",
    area: "lease",
    seed: async (e) => void (await landlordKnown(e)),
    turn: { text: "roomie the sink's leaking, tell them", from: "Dev" },
    expect: {
      tools: ["report_issue"],
      replyIncludes: [/sent/i],
      maxLines: 2,
      check: async (e) => {
        const rows = await db.select().from(schema.workOrders).where(eq(schema.workOrders.groupId, e.ctx.groupId));
        return fail(rows.length === 1 && rows[0].reportedBy === e.member.Dev && /sink/i.test(rows[0].title), `one work order about the sink by Dev, got ${rows.map((r) => r.title).join(", ") || "none"}`);
      },
    },
  },
  {
    id: "lease-not-renewing-asks",
    area: "lease",
    seed: async (e) => void (await landlordKnown(e)),
    turn: { text: "roomie tell them we're not renewing" },
    expect: {
      asks: true,
      check: async (e) => {
        const rows = await db.select().from(schema.sentMail).where(eq(schema.sentMail.groupId, e.ctx.groupId));
        return fail(rows.length === 0, `nothing should be sent before the questions are answered, got ${rows.length}`);
      },
    },
  },
  {
    id: "lease-work-order-status",
    area: "lease",
    seed: async (e) => {
      await landlordKnown(e);
      const { reportIssue } = await import("@/services/lease-inbox");
      await reportIssue(e.as("Dev"), { what: "the leaking kitchen sink", instruction: "roomie the sink's leaking, tell them" });
    },
    turn: { text: "roomie what's up with the sink?", from: "Sam" },
    expect: { tools: ["work_order_status"], noTools: "actions", replyIncludes: [/sink/i], maxLines: 2 },
  },
  {
    id: "lease-notice-period",
    area: "lease",
    seed: async (e) => {
      await landlordKnown(e);
      const { fileDocument } = await import("@/services/documents");
      const doc = await fileDocument(e.ctx, { kind: "lease", title: "Lease Agreement Apt 4B 2026", bytes: Buffer.from("%PDF lease"), contentType: "application/pdf" });
      await db
        .update(schema.documents)
        .set({ text: "Section 14.2 Notice to Vacate. Resident shall give Landlord not less than sixty (60) days' written notice before vacating.\n\nSection 9 Pets. No pets without written consent." })
        .where(eq(schema.documents.id, doc.id));
    },
    turn: { text: "roomie what's the notice period in our lease?", from: "Sam" },
    expect: { tools: ["ask_lease"], noTools: "actions", replyIncludes: [/60|sixty/i] },
  },
];


/** Lease Inbox taught and the landlord known (Apt 4B's leasing office), without the model. */
async function landlordKnown(e: EvalEnv) {
  await toolkits.setToolkit(e.ctx, { toolkit: "lease inbox", enabled: true });
  const { trustSender } = await import("@/services/lease-inbox");
  await trustSender(e.ctx, "leasing@brookfieldresidential.com", "admin");
}
