// The giant peeking dino's plan (docs/landing.md "Motion and color"): pure geometry and timing, no DOM.
// Run: npx tsx --test src/app/_landing/peek-plan.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dinoSize, nextDelay, peekFrames, peekPose, pickCard, PEEK_MS, sidesFor, type Card, type Side } from "./peek-plan";

const HERO: Card = { w: 503, h: 543 };
const DEMO: Card = { w: 520, h: 333 };
const PHONE: Card = { w: 350, h: 460 };

/** The dino's box (centered at its pose) and how much of it is outside the card, as a fraction of its width/height. */
function outside(card: Card, size: number, pose: { x: number; y: number }) {
  const left = pose.x - size / 2;
  const right = pose.x + size / 2;
  const top = pose.y - size / 2;
  const bottom = pose.y + size / 2;
  return {
    right: Math.max(0, right - card.w / 2) / size,
    left: Math.max(0, -card.w / 2 - left) / size,
    top: Math.max(0, -card.h / 2 - top) / size,
    bottom: Math.max(0, bottom - card.h / 2) / size,
  };
}

describe("size", () => {
  test("giant, but it always hides completely behind its chat", () => {
    for (const card of [HERO, DEMO, PHONE]) {
      const s = dinoSize(card);
      assert.ok(s <= Math.min(card.w, card.h) - 8, `${s} fits ${card.w}x${card.h}`);
      assert.ok(s >= Math.min(card.w, card.h) * 0.5, `${s} is giant for ${card.w}x${card.h}`);
    }
    assert.ok(dinoSize(HERO) >= 280);
  });
});

describe("poses", () => {
  for (const side of ["left", "right", "top"] as Side[]) {
    test(`${side}: hidden and ready are fully behind the card; the peek shows about 40% of it past that edge`, () => {
      for (const card of [HERO, DEMO, PHONE]) {
        const s = dinoSize(card);
        for (const which of ["hidden", "ready"] as const) {
          const o = outside(card, s, peekPose(side, which, card, s));
          assert.ok(o.left + o.right + o.top + o.bottom === 0, `${side} ${which} hidden in ${card.w}x${card.h}: ${JSON.stringify(o)}`);
        }
        const o = outside(card, s, peekPose(side, "peek", card, s));
        const shown = o[side];
        assert.ok(shown > 0.3 && shown < 0.5, `${side} peek shows ${shown.toFixed(2)}`);
        const others = (["left", "right", "top", "bottom"] as const).filter((k) => k !== side).reduce((n, k) => n + o[k], 0);
        assert.equal(others, 0, "only past its own edge");
      }
    });
  }

  test("it leans out of the side it peeks from", () => {
    const s = dinoSize(HERO);
    assert.ok(peekPose("right", "peek", HERO, s).rotate > 0, "right: clockwise");
    assert.ok(peekPose("left", "peek", HERO, s).rotate < 0, "left: counter-clockwise");
  });
});

describe("the choreography", () => {
  test("starts and ends hidden, peeks once, ducks back faster than it came out", () => {
    const s = dinoSize(HERO);
    const f = peekFrames("right", HERO, s);
    assert.equal(f[0].transform, f.at(-1)!.transform, "back where it started");
    assert.ok(f.every((k, i) => i === 0 || (k.offset ?? 0) > (f[i - 1].offset ?? 0)), "offsets increase");
    const peekAt = f.findIndex((k) => k.name === "peek");
    const duckAt = f.findIndex((k) => k.name === "duck");
    const outAt = f.findIndex((k) => k.name === "pop");
    assert.ok(outAt > 0 && peekAt > outAt && duckAt > peekAt);
    const comeOut = (f[outAt].offset! - f[outAt - 1].offset!) * PEEK_MS;
    const goBack = (f[duckAt].offset! - f[duckAt - 1].offset!) * PEEK_MS;
    assert.ok(goBack < comeOut, `ducks back in ${goBack} ms, came out in ${comeOut} ms`);
    assert.ok(goBack <= 200, "back quickly");
    for (const k of f) assert.match(k.transform, /^translate\(-?[\d.]+px, -?[\d.]+px\) rotate\(-?[\d.]+deg\)( scale\([\d.]+, [\d.]+\))?$/, "transform only");
  });
});

describe("where and when", () => {
  test("sides: away from the text; only over the top on a phone", () => {
    assert.deepEqual(sidesFor("right", false), ["right", "top"]);
    assert.deepEqual(sidesFor("left", false), ["left", "top"]);
    assert.deepEqual(sidesFor("right", true), ["top"]);
    assert.deepEqual(sidesFor("left", false, false), ["left"], "a chat with text right above it: its free side only");
    assert.deepEqual(sidesFor("left", true, false), ["top"], "on a phone the top is the only way out");
  });

  test("the dino goes to the chat you're looking at, not the one it just left, not one barely on screen", () => {
    const now = 100_000;
    const cards = [
      { id: "hero", ratio: 0.9, lastPeekAt: now - 2_000 },
      { id: "money", ratio: 0.7, lastPeekAt: 0 },
      { id: "house", ratio: 0.2, lastPeekAt: 0 },
    ];
    assert.equal(pickCard(cards, now), "money", "the most visible one it didn't just peek from");
    assert.equal(pickCard([{ id: "house", ratio: 0.2, lastPeekAt: 0 }], now), null, "nothing well on screen");
    assert.equal(pickCard([{ id: "hero", ratio: 1, lastPeekAt: now - 20_000 }], now), "hero");
  });

  test("the next peek comes 5 to 9 seconds later", () => {
    for (const r of [0, 0.5, 0.999]) {
      const d = nextDelay(() => r);
      assert.ok(d >= 5_000 && d <= 9_000, String(d));
    }
  });
});
