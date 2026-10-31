// Pure tests for the Gate: decideGate with Jev answers recorded from the real gateway (2026-10-28, jev-1.14.0,
// QUESTIONS in jev.ts), the follow-up window, parseSilent and parseJev. No DB, no network.
// Run: npx tsx --test src/mastra/gate/gate.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  callsPet,
  decideGate,
  FOLLOW_UP_MAX,
  FOLLOW_UP_WINDOW_MS,
  inFollowUpWindow,
  isHardTrigger,
  mediaWanted,
  parseSilent,
  saysRoomie,
  THRESHOLDS,
  type Chattiness,
  type JevAnswers,
  replyText,
  staleReply,
  onlyAQuestion,
} from "./policy";
import { parseJev, questionsFor, toolkitCriteria } from "./jev";
import { MANIFESTS, TOOLKIT_IDS } from "@/toolkits/manifests";

const jev = (act: number, clarify: number, chat: number, ignore: number, addressed: number, choice: JevAnswers["toolkit"]["choice"], p: number): JevAnswers => ({
  intent: { act, clarify, chat, ignore },
  addressed,
  toolkit: { choice, p },
});

/** Recorded answers. Members Maya, Dev, Sam; `inWindow` = Roomie had just spoken. */
const REC = {
  pizza: jev(0.81, 0.19, 0, 0, 0.21, "splitting", 0.99), // "[Maya] I paid 40 for pizza"
  game: jev(0, 0, 0.02, 0.98, 0.06, "none", 1), // "[Dev] did you see the game last night"
  milk: jev(0.92, 0.08, 0, 0, 0.83, "groceries", 1), // "[Sam] add milk and eggs"
  thanks: jev(0, 0, 0.99, 0.01, 0.95, "splitting", 0.89), // "[Maya] thanks roomie" (in window)
  owesNamed: jev(0.92, 0.08, 0, 0, 0.96, "splitting", 1), // "[Dev] roomie who owes what"
  owes: jev(0.94, 0.06, 0, 0, 0.58, "splitting", 1), // "[Sam] who owes what?"
  lol: jev(0.01, 0, 0.12, 0.87, 0.1, "groceries", 0.92), // "[Maya] lol same" (in window)
  chipsToo: jev(0.78, 0.21, 0, 0.01, 0.66, "groceries", 1), // "[Dev] and 2 bags of chips too" (in window)
  dishes: jev(0.93, 0.04, 0.01, 0.02, 0.1, "house", 1), // "[Sam] I did the dishes" (recorded as "chores", now House's choice)
  vague: jev(0.02, 0.97, 0, 0.01, 0.17, "splitting", 1), // "[Maya] someone paid for something yesterday"
  trash: jev(0.99, 0.01, 0, 0, 0.58, "house", 0.48), // "[Dev] remind everyone trash goes out tuesday 8pm" (recorded as "chores")
  uber: jev(0.76, 0.24, 0, 0, 0.16, "splitting", 1), // "[Maya] pagué 30 por el uber"
  seeYou: jev(0.01, 0.03, 0.01, 0.95, 0.04, "core", 0.79), // "[Sam] ok see you at 7" (recorded as "reminders", now core's choice)
  // Recorded with step 6's groceries wording (recipes, cooking, meal planning, pantry).
  tacosNamed: jev(0.35, 0.61, 0.01, 0.03, 0.6, "groceries", 0.99), // "[Maya] roomie tacos for 5 on friday"
  tacos: jev(0.22, 0.73, 0, 0.05, 0.25, "groceries", 0.99), // "[Dev] tacos for 5 friday"
  addThem: jev(0.96, 0.04, 0, 0, 0.95, "groceries", 1), // "[Maya] yes add them, we have onions" (in window, after a recipe)
  outOfSoap: jev(0.86, 0.13, 0, 0.01, 0.17, "groceries", 0.98), // "[Sam] we're out of dish soap"
};

const gate = (j: JevAnswers | null, o: { hardTrigger?: boolean; inWindow?: boolean; chattiness?: Chattiness } = {}) =>
  decideGate({ hardTrigger: o.hardTrigger ?? false, inWindow: o.inWindow ?? false, jev: j, chattiness: o.chattiness ?? "normal" });

describe("decideGate with recorded Jev answers (normal chattiness)", () => {
  test("logging statements nobody addressed: act, unprompted (ask before logging), narrowed", () => {
    for (const [j, tk] of [
      [REC.pizza, "splitting"],
      [REC.dishes, "house"],
      [REC.uber, "splitting"],
    ] as const) {
      const d = gate(j);
      assert.equal(d.speak, true);
      assert.equal(d.decision, "act");
      assert.equal(d.unprompted, true);
      assert.equal(d.toolkit, tk);
      assert.equal(d.mayStaySilent, false);
    }
  });

  test("requests and questions that sound addressed: act, prompted", () => {
    for (const j of [REC.milk, REC.owes]) {
      const d = gate(j);
      assert.equal(d.decision, "act");
      assert.equal(d.unprompted, false);
    }
    assert.equal(gate(REC.milk).toolkit, "groceries");
  });

  test("a photo never narrows the tools: a receipt is Money, a list is Groceries, and only the tools can tell", () => {
    const sure = jev(0.9, 0.1, 0, 0, 0.9, "splitting", 0.97); // "[Dev] [photo] roomie all common"
    assert.equal(gate(sure, { hardTrigger: true }).toolkit, "splitting", "without a photo Jev's pick stands");
    const d = decideGate({ hardTrigger: true, inWindow: false, jev: sure, chattiness: "normal", hasPhoto: true });
    assert.equal(d.speak, true);
    assert.equal(d.toolkit, undefined);
  });

  test("chatter between people is ignored", () => {
    for (const j of [REC.game, REC.seeYou]) {
      const d = gate(j);
      assert.equal(d.speak, false);
      assert.equal(d.reason, "jev-ignore");
    }
  });

  test("something to log with details missing: clarify", () => {
    const d = gate(REC.vague);
    assert.equal(d.decision, "clarify");
    assert.equal(d.unprompted, true);
  });

  test("recipes and meal plans route to groceries, never to ignore", () => {
    const named = gate(REC.tacosNamed, { hardTrigger: true });
    assert.equal(named.speak, true);
    assert.equal(named.toolkit, "groceries", "the recipe tools are in groceries");
    const unaddressed = gate(REC.tacos);
    assert.equal(unaddressed.speak, true, "a meal plan nobody addressed is worth a question");
    assert.equal(unaddressed.decision, "clarify");
    assert.equal(unaddressed.toolkit, "groceries");
    const add = gate(REC.addThem, { inWindow: true });
    assert.equal(add.decision, "act");
    assert.equal(add.toolkit, "groceries");
    const soap = gate(REC.outOfSoap);
    assert.equal(soap.decision, "act");
    assert.equal(soap.unprompted, true, "'we're out of dish soap' unaddressed: ask before adding");
  });

  test("toolkit narrowing only when Jev is sure enough", () => {
    assert.equal(gate(REC.trash).toolkit, undefined, "chores at .48 is below TOOLKIT_MIN: every tool");
    assert.equal(gate(REC.game, { hardTrigger: true }).toolkit, undefined, "'none' never narrows");
  });
});

describe("hard triggers and fallback", () => {
  test("a hard trigger always speaks, even when Jev says ignore or is down", () => {
    for (const j of [REC.game, REC.owesNamed, null]) {
      const d = gate(j, { hardTrigger: true });
      assert.equal(d.speak, true);
      assert.equal(d.reason, "hard-trigger");
      assert.equal(d.unprompted, false);
      assert.equal(d.mayStaySilent, false);
    }
    assert.equal(gate(REC.owesNamed, { hardTrigger: true }).toolkit, "splitting");
  });

  test("Jev unavailable: hard triggers only, so everything else stays quiet (window too)", () => {
    for (const o of [{}, { inWindow: true }, { chattiness: "chatty" as const }]) {
      const d = gate(null, o);
      assert.equal(d.speak, false);
      assert.equal(d.reason, "jev-unavailable");
    }
  });
});

describe("follow-up window", () => {
  test("a follow-up Jev wants to act on: act, not unprompted", () => {
    const d = gate(REC.chipsToo, { inWindow: true });
    assert.equal(d.decision, "act");
    assert.equal(d.unprompted, false);
    assert.equal(d.toolkit, "groceries");
  });

  test("addressed small talk in the window: the agent may answer or stay [silent]", () => {
    const d = gate(REC.thanks, { inWindow: true });
    assert.equal(d.decision, "maybe");
    assert.equal(d.mayStaySilent, true);
    assert.equal(gate(REC.thanks).speak, false, "outside the window, no reply (the word roomie is a hard trigger anyway)");
  });

  test("a follow-up Jev would clarify goes to the agent with the thread instead of a forced question", () => {
    // An eval run gated "[Sam] and 2 bags of chips too" (right after Roomie added Sam's salsa) as clarify; shaped like that.
    const d = gate(jev(0.35, 0.63, 0, 0.02, 0.7, "groceries", 1), { inWindow: true });
    assert.equal(d.decision, "maybe");
    assert.equal(d.toolkit, "groceries");
    assert.equal(gate(REC.vague, { inWindow: true }).decision, "maybe");
  });

  test("chatter in the window Jev is sure about skips the agent", () => {
    assert.equal(gate(REC.lol, { inWindow: true }).speak, false);
  });
});

describe("Chattiness", () => {
  test("thresholds", () => {
    assert.deepEqual(THRESHOLDS, { quiet: { act: 0.9, clarify: 0.8 }, normal: { act: 0.75, clarify: 0.6 }, chatty: { act: 0.6, clarify: 0.45 } });
  });

  test("quiet stays out of borderline logging, chatty jumps in", () => {
    assert.equal(gate(REC.pizza, { chattiness: "quiet" }).speak, false, "act .81 < .9");
    assert.equal(gate(REC.dishes, { chattiness: "quiet" }).decision, "act", "act .93 >= .9");
    assert.equal(gate(REC.vague, { chattiness: "quiet" }).decision, "clarify", "clarify .97 >= .8");
    const borderline = jev(0.5, 0.48, 0, 0.02, 0.3, "splitting", 1);
    assert.equal(gate(borderline).speak, false);
    assert.equal(gate(borderline, { chattiness: "chatty" }).decision, "clarify", "clarify .48 >= .45");
    assert.equal(gate(jev(0.65, 0.3, 0, 0.05, 0.3, "groceries", 1), { chattiness: "chatty" }).decision, "act");
  });

  test("an unknown chattiness value falls back to normal", () => {
    assert.equal(gate(REC.pizza, { chattiness: "loud" as Chattiness }).decision, "act");
  });
});

// Recorded 2026-10-28 (jev-1.14.0) with questionsFor(enabled): the toolkit question only offers the Group's
// enabled Toolkits, core and none.
const ENABLED_REC = [
  {
    latest: "[Maya] I paid 40 for pizza",
    enabled: ["groceries"],
    toolkit: { type: "choice", choice: "none", confidence: 0.4, probabilities: { groceries: 0.38, core: 0.02, none: 0.6 } },
    intent: { act: 0.81, clarify: 0.19, chat: 0, ignore: 0 },
    addressed: 0.2,
  },
  {
    latest: "[Maya] I paid 40 for pizza",
    enabled: ["splitting", "groceries", "house"],
    toolkit: { type: "choice", choice: "splitting", confidence: 0.95, probabilities: { splitting: 0.96, groceries: 0.04, house: 0, core: 0, none: 0 } },
    intent: { act: 0.75, clarify: 0.25, chat: 0, ignore: 0 },
    addressed: 0.22,
  },
  {
    latest: "[Sam] I did the dishes",
    enabled: ["splitting", "groceries"],
    toolkit: { type: "choice", choice: "none", confidence: 0.88, probabilities: { splitting: 0, groceries: 0.01, core: 0.08, none: 0.91 } },
    intent: { act: 0.89, clarify: 0.05, chat: 0.01, ignore: 0.05 },
    addressed: 0.07,
  },
  {
    latest: "[Sam] add milk and eggs",
    enabled: ["splitting"],
    toolkit: { type: "choice", choice: "none", confidence: 0.97, probabilities: { splitting: 0.01, core: 0.01, none: 0.98 } },
    intent: { act: 0.94, clarify: 0.06, chat: 0, ignore: 0 },
    addressed: 0.81,
  },
  {
    latest: "[Maya] roomie what can you do?",
    enabled: ["splitting", "groceries"],
    toolkit: { type: "choice", choice: "core", confidence: 0.96, probabilities: { splitting: 0, groceries: 0, core: 0.97, none: 0.03 } },
    intent: { act: 0.43, clarify: 0.05, chat: 0.52, ignore: 0 },
    addressed: 0.99,
  },
] as const;

describe("the toolkit question comes from the enabled manifests", () => {
  test("criteria: each enabled Toolkit's gate criterion, then core and none", () => {
    const c = toolkitCriteria(["groceries", "house"]);
    assert.deepEqual(Object.keys(c), ["groceries", "house", "core", "none"]);
    assert.equal(c.groceries, MANIFESTS.find((m) => m.id === "groceries")!.gate.criterion);
    assert.deepEqual(Object.keys(questionsFor(["splitting"]).toolkit.criteria), ["splitting", "core", "none"]);
    assert.deepEqual(Object.keys(questionsFor().toolkit.criteria), [...TOOLKIT_IDS, "core", "none"]);
  });

  test("recorded answers route only among enabled Toolkits; a disabled one is never picked or narrowed to", () => {
    for (const r of ENABLED_REC) {
      const parsed = parseJev(
        { answers: { intent: { type: "choice", choice: "act", probabilities: r.intent }, addressed: { type: "noul", noul: r.addressed }, toolkit: r.toolkit } },
        r.enabled,
      );
      assert.ok(parsed, r.latest);
      assert.ok([...r.enabled, "core", "none"].includes(parsed.toolkit.choice), `${r.latest}: ${parsed.toolkit.choice}`);
      for (const k of Object.keys(r.toolkit.probabilities)) assert.ok([...r.enabled, "core", "none"].includes(k), `Jev only saw enabled choices (${k})`);
      const d = gate(parsed, { hardTrigger: r.latest.includes("roomie") });
      if (d.toolkit) assert.ok([...r.enabled, "core"].includes(d.toolkit), `${r.latest} narrowed to ${d.toolkit}`);
    }
    // With Splitting off, the pizza goes nowhere in particular; with it on, to Splitting.
    assert.equal(gate(parseJev({ answers: { intent: { type: "choice", choice: "act", probabilities: ENABLED_REC[0].intent }, addressed: { type: "noul", noul: 0.2 }, toolkit: ENABLED_REC[0].toolkit } }, ["groceries"])).toolkit, undefined);
    assert.equal(gate(parseJev({ answers: { intent: { type: "choice", choice: "act", probabilities: ENABLED_REC[1].intent }, addressed: { type: "noul", noul: 0.22 }, toolkit: ENABLED_REC[1].toolkit } })).toolkit, "splitting");
    // "what can you do?" goes to core, where list_toolkits lives.
    assert.equal(gate(parseJev({ answers: { intent: { type: "choice", choice: "chat", probabilities: ENABLED_REC[4].intent }, addressed: { type: "noul", noul: 0.99 }, toolkit: ENABLED_REC[4].toolkit } }, ["splitting", "groceries"]), { hardTrigger: true }).toolkit, "core");
  });

  test("a choice for a Toolkit that's off (stale answer) never narrows", () => {
    const parsed = parseJev(
      { answers: { intent: { type: "choice", choice: "act", probabilities: { act: 0.9 } }, addressed: { type: "noul", noul: 0.9 }, toolkit: { type: "choice", choice: "house", probabilities: { house: 0.99 } } } },
      ["splitting"],
    );
    assert.deepEqual(parsed?.toolkit, { choice: "none", p: 0 });
  });
});

describe("parseJev", () => {
  test("the gateway's shape", () => {
    const parsed = parseJev({
      answers: {
        intent: { type: "choice", choice: "act", confidence: 0.81, probabilities: { act: 0.81, clarify: 0.19, chat: 0, ignore: 0 } },
        addressed: { type: "noul", noul: 0.21 },
        toolkit: { type: "choice", choice: "splitting", confidence: 0.99, probabilities: { splitting: 0.99, groceries: 0.01 } },
      },
    });
    assert.deepEqual(parsed, REC.pizza);
  });

  test("missing answers -> null (the Gate treats it as Jev unavailable)", () => {
    assert.equal(parseJev({}), null);
    assert.equal(parseJev({ answers: { intent: { type: "choice", choice: "act" } } }), null);
  });

  test("a toolkit choice that isn't offered -> 'none' at p 0 (no narrowing), the rest kept", () => {
    const parsed = parseJev({
      answers: {
        intent: { type: "choice", choice: "act", probabilities: { act: 1 } },
        addressed: { type: "noul", noul: 0.5 },
        toolkit: { type: "choice", choice: "recipes", probabilities: { recipes: 1 } },
      },
    });
    assert.deepEqual(parsed?.toolkit, { choice: "none", p: 0 });
    assert.equal(parsed?.intent.act, 1);
  });
});

/* ---------- carried over from router.test.ts ---------- */

const now = new Date("2026-10-04T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const min = 60_000;

describe("saysRoomie", () => {
  test("the word roomie, any case, anywhere", () => {
    for (const t of ["roomie add milk", "Roomie, who owes what?", "ok ROOMIE", "thanks roomie!"]) assert.equal(saysRoomie(t), true, t);
  });

  test("not inside other words", () => {
    for (const t of ["my roomies are out", "roomiebot", "add milk", ""]) assert.equal(saysRoomie(t), false, t);
  });

  test("callsPet: 'roomie' is the one name (ADR 0020); a name a Group once stored is not a trigger", () => {
    assert.equal(callsPet("roomie add milk"), true);
    assert.equal(callsPet("dino add milk"), false, "only roomie");
    assert.equal(callsPet("dinosaurs rule"), false);
  });
});

describe("inFollowUpWindow", () => {
  test("defaults: 3 minutes, 4 messages", () => {
    assert.equal(FOLLOW_UP_WINDOW_MS, 3 * min);
    assert.equal(FOLLOW_UP_MAX, 4);
  });

  test("no Roomie reply ever -> no window", () => {
    assert.equal(inFollowUpWindow({ lastRoomieAt: null, humanSinceRoomie: 1, now }), false);
  });

  test("within 3 min and fewer than 4 human messages (including this one) -> window", () => {
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(5_000), humanSinceRoomie: 1, now }), true);
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(2 * min), humanSinceRoomie: 2, now }), true);
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(3 * min), humanSinceRoomie: 3, now }), true); // edges inclusive
  });

  test("4th follow-up, a stale reply, or clock skew closes it", () => {
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(5_000), humanSinceRoomie: 4, now }), false);
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(3 * min + 1), humanSinceRoomie: 1, now }), false);
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(-5_000), humanSinceRoomie: 1, now }), false);
  });

  test("windowMs and maxFollowUps are tunable", () => {
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(9 * min), humanSinceRoomie: 1, now, windowMs: 10 * min }), true);
    assert.equal(inFollowUpWindow({ lastRoomieAt: ago(5_000), humanSinceRoomie: 2, now, maxFollowUps: 2 }), false);
  });
});

describe("hard triggers (audit H2: a voice note is not one by itself)", () => {
  const chat = (o: Partial<Parameters<typeof isHardTrigger>[0]>) => isHardTrigger({ groupChat: true, text: "", ...o });

  test("a voice note in the group isn't a hard trigger; replying to Roomie with one, or saying roomie in it, is", () => {
    assert.equal(chat({ isVoice: true, text: "did anyone see my keys" }), false);
    assert.equal(chat({ isVoice: true, isReplyToRoomie: true, text: "yes, split it" }), true);
    assert.equal(chat({ isVoice: true, mentionsRoomie: true, text: "hi" }), true);
    assert.equal(chat({ isVoice: true, text: "roomie add milk" }), true);
  });

  test("DMs and the dashboard, /pet, @mention, reply, the word roomie; never another name", () => {
    assert.equal(isHardTrigger({ groupChat: false, text: "anything" }), true);
    assert.equal(chat({ petted: true }), true);
    assert.equal(chat({ text: "roomie add milk" }), true);
    assert.equal(chat({ text: "dino add milk" }), false);
    assert.equal(chat({ text: "lol same" }), false);
  });
});

describe("mediaWanted (photos and voice notes are only fetched when Roomie is talked to)", () => {
  test("photos: an addressed caption, a reply, an @mention, the window, a DM", () => {
    assert.equal(mediaWanted({ kind: "photo", caption: "roomie split this" }), true);
    assert.equal(mediaWanted({ kind: "photo", caption: "Dino split this" }), false, "a stored name is not a trigger");
    assert.equal(mediaWanted({ kind: "photo", isReplyToRoomie: true }), true);
    assert.equal(mediaWanted({ kind: "photo", mentionsRoomie: true }), true);
    assert.equal(mediaWanted({ kind: "photo", inWindow: true }), true);
    assert.equal(mediaWanted({ kind: "photo", isPrivate: true }), true);
    assert.equal(mediaWanted({ kind: "photo", caption: "sunset" }), false);
    assert.equal(mediaWanted({ kind: "photo" }), false);
    assert.equal(mediaWanted({ kind: "photo", setupPending: true }), false, "setup answers are words, not pictures");
  });

  test("voice: a reply to Roomie, an @mention, the window, setup waiting on this Admin, a DM; nothing else", () => {
    assert.equal(mediaWanted({ kind: "voice" }), false);
    assert.equal(mediaWanted({ kind: "voice", isReplyToRoomie: true }), true);
    assert.equal(mediaWanted({ kind: "voice", mentionsRoomie: true }), true);
    assert.equal(mediaWanted({ kind: "voice", inWindow: true }), true);
    assert.equal(mediaWanted({ kind: "voice", setupPending: true }), true);
    assert.equal(mediaWanted({ kind: "voice", isPrivate: true }), true);
  });
});

describe("parseSilent", () => {
  test("[silent] variants mean no reply", () => {
    for (const t of ["[silent]", "[SILENT]", "  [Silent]  ", "[silent].", "[silent]!!", "*[silent]*", "\"[silent]\"", "([silent])", "\n[silent]\n"]) {
      assert.equal(parseSilent(t), null, JSON.stringify(t));
    }
  });

  test("normal text passes through (trimmed)", () => {
    assert.equal(parseSilent("Bet. Chips added 🛒"), "Bet. Chips added 🛒");
    assert.equal(parseSilent("  two lines\nhere  "), "two lines\nhere");
  });

  test("the word silent without brackets, or mid-text, is a normal reply", () => {
    assert.equal(parseSilent("silent"), "silent");
    assert.equal(parseSilent("ok staying [silent] on that one"), "ok staying [silent] on that one");
  });

  test("a leading [silent] followed by real text is stripped and sent", () => {
    assert.equal(parseSilent("[silent] actually wait, chips are already in the cart"), "actually wait, chips are already in the cart");
    assert.equal(parseSilent("[silent]\n\nLogged it anyway 👍"), "Logged it anyway 👍");
    assert.equal(parseSilent("[silent] - Ryan owes $20 btw"), "Ryan owes $20 btw");
  });
});

describe("replyText: only what Roomie said after its last tool ran (live test #11)", () => {
  test("text before a tool call is dropped when there's text after it", () => {
    const steps = [
      { text: 'Say "add it" and I\'ll put "Trash run" on the chart that way.', toolCalls: [{}] },
      { text: "Trash run is on the chart: every 3 days, Sreyas first.", toolCalls: [] },
    ];
    assert.equal(replyText(steps, steps.map((s) => s.text).join("")), "Trash run is on the chart: every 3 days, Sreyas first.");
  });
  test("no text after the tools: the whole text stays; no tools: unchanged", () => {
    assert.equal(replyText([{ text: "Added it.", toolCalls: [{}] }, { text: "", toolCalls: [] }], "Added it."), "Added it.");
    assert.equal(replyText([{ text: "Hey!", toolCalls: [] }], "Hey!"), "Hey!");
    assert.equal(replyText([], "Hey!"), "Hey!");
  });
});

describe("staleReply (#41): Roomie already answered this Member since their message came in", () => {
  // The live example: the tacos recipe went out while "roomie suggest" waited its turn; its own run then asked.
  const recipe = "Tacos for 3: tortillas, beef, onion, cheese, salsa. Add the 12 missing ingredients to the cart?";

  test("a question after Roomie answered them: dropped", () => {
    assert.equal(staleReply({ reply: "Suggest what, sudhersan? A different dinner than tacos, or something else?", changed: false, answeredSince: [recipe] }), true);
  });

  test("a repeat of what Roomie just said (case, spacing and punctuation aside): dropped", () => {
    assert.equal(staleReply({ reply: "tacos for 3:  tortillas, beef, onion, cheese, salsa", changed: false, answeredSince: [recipe] }), true);
  });

  test("nothing said to them since: sent, question or not", () => {
    assert.equal(staleReply({ reply: "Suggest what?", changed: false, answeredSince: [] }), false);
  });

  test("the run changed something (a tool ran): always sent", () => {
    assert.equal(staleReply({ reply: "Added the 12 taco ingredients. Anything else?", changed: true, answeredSince: [recipe] }), false);
  });

  test("a new statement (no question, not a repeat): sent", () => {
    assert.equal(staleReply({ reply: "Dev owes you $12.50.", changed: false, answeredSince: [recipe] }), false);
  });
});

describe("staleReply review fixes (#51)", () => {
  const recipe = "Tacos for 3: tortillas, beef, onion, cheese, salsa. Want the missing ones on the list?";
  test("a full new answer that ends with a question is sent", () => {
    assert.equal(staleReply({ reply: "Dev owes you $12.50 and Sam is square. Want me to nudge Dev?", changed: false, answeredSince: [recipe] }), false);
  });
  test("only a short single question counts as 'only a question'", () => {
    assert.equal(onlyAQuestion("Suggest what, sudhersan? A different dinner than tacos, or something else?"), true);
    assert.equal(onlyAQuestion("Dev owes you $12.50. Want me to nudge him?"), false);
    assert.equal(onlyAQuestion("Added eggs."), false);
  });
  test("a repeat is whole words: 'ok' doesn't repeat 'book'", () => {
    assert.equal(staleReply({ reply: "ok", changed: false, answeredSince: ["I'll book it."] }), false);
    assert.equal(staleReply({ reply: "tortillas, beef", changed: false, answeredSince: [recipe] }), true);
  });
});
