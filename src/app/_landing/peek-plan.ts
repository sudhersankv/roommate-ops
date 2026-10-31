// The giant peeking Roomie on the landing page (docs/landing.md "Motion and color"): pure geometry and timing, no DOM,
// so the choreography is tested (peek-plan.test.ts) and peek.tsx only plays it. The dino lives behind a chat window,
// fully hidden; a peek walks it (unseen) to one edge, crouches, pops about 40% of it out past that edge with an
// overshoot, looks at you with a curious tilt, then ducks back fast and walks off. Transforms only.

export type Side = "left" | "right" | "top";
export type Card = { w: number; h: number };
export type Pose = { x: number; y: number; rotate: number };
export type PeekFrame = { offset: number; transform: string; easing?: string; name?: string };

/** One peek, start to finish. */
export const PEEK_MS = 3200;
/** When, as a fraction of the peek, it's out and looking (eyes open) and when it gets caught (a happy squint). */
export const PEEK_MOMENTS = { lookAt: 0.44, caughtAt: 0.8 };
/** How much of it shows past the edge. */
const SHOWN = 0.42;
/** How far it leans out of the side it peeks from, in degrees. */
const LEAN = 10;
/** A chat must be at least this visible for the dino to go there, and not one it peeked from in the last 8 s. */
const MIN_RATIO = 0.5;
const COOLDOWN_MS = 8_000;

/** Giant: ~62% of the chat window's shorter side (up to 320 px), and never too big to hide behind it. */
export function dinoSize(card: Card): number {
  const m = Math.min(card.w, card.h);
  return Math.round(Math.min(320, m * 0.62, m - 8));
}

/** Where the dino's center sits, relative to the card's center: hidden (middle), ready (just inside an edge), peek. */
export function peekPose(side: Side, which: "hidden" | "ready" | "peek", card: Card, size: number): Pose {
  if (which === "hidden") return { x: 0, y: 0, rotate: 0 };
  const half = size / 2;
  if (side === "top") {
    // Over the top edge, a bit left of the middle (the chat's own little dino sits top-right).
    const x = -card.w / 2 + half + 0.2 * (card.w - size);
    const ready = -card.h / 2 + half + 2;
    return which === "ready" ? { x, y: ready, rotate: 0 } : { x, y: -card.h / 2 + half - SHOWN * size, rotate: -6 };
  }
  const dir = side === "right" ? 1 : -1;
  // In the upper part of the card, where a face peeking out reads best.
  const y = -card.h / 2 + half + 0.15 * (card.h - size);
  const ready = dir * (card.w / 2 - half - 2);
  return which === "ready" ? { x: ready, y, rotate: 0 } : { x: dir * (card.w / 2 - half + SHOWN * size), y, rotate: dir * LEAN };
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const tf = (p: Pose, scale?: [number, number]) => `translate(${n(p.x)}px, ${n(p.y)}px) rotate(${n(p.rotate)}deg)${scale ? ` scale(${n(scale[0])}, ${n(scale[1])})` : ""}`;
const lerp = (a: Pose, b: Pose, t: number): Pose => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, rotate: a.rotate + (b.rotate - a.rotate) * t });

/**
 * The keyframes of one peek (Web Animations API): a waddle to the edge (unseen), a crouch, the pop out with an
 * overshoot, a settle, a curious tilt, a hold, a quick duck back with a squash, then a walk off to the middle.
 */
export function peekFrames(side: Side, card: Card, size: number): PeekFrame[] {
  const hidden = peekPose(side, "hidden", card, size);
  const ready = peekPose(side, "ready", card, size);
  const peek = peekPose(side, "peek", card, size);
  const out = side === "top" ? { x: 0, y: -1 } : { x: side === "right" ? 1 : -1, y: 0 };
  const overshoot: Pose = { x: peek.x + out.x * 0.06 * size, y: peek.y + out.y * 0.06 * size, rotate: peek.rotate * 1.25 };
  const tilt = side === "left" ? 7 : -7;
  const bob = (p: Pose, dy: number, r: number): Pose => ({ x: p.x, y: p.y + dy, rotate: r });
  return [
    { offset: 0, transform: tf(hidden), easing: "ease-in-out", name: "start" },
    // The walk over: two little waddle steps (it's behind the chat, so this is felt in the timing, not seen).
    { offset: 0.08, transform: tf(bob(lerp(hidden, ready, 0.4), -6, 4)), easing: "ease-in-out" },
    { offset: 0.15, transform: tf(bob(lerp(hidden, ready, 0.8), 0, -4)), easing: "ease-out" },
    { offset: 0.22, transform: tf(ready), easing: "ease-in-out" },
    // Anticipation: a little crouch before the pop.
    { offset: 0.28, transform: tf(ready, [1.04, 0.94]), easing: "cubic-bezier(.34,1.56,.64,1)" },
    { offset: 0.38, transform: tf(overshoot, [0.98, 1.04]), easing: "ease-out", name: "pop" },
    { offset: PEEK_MOMENTS.lookAt, transform: tf(peek), easing: "ease-in-out", name: "peek" },
    // A curious head tilt while it looks at you.
    { offset: 0.56, transform: tf({ ...peek, rotate: peek.rotate + tilt }), easing: "ease-in-out" },
    { offset: 0.68, transform: tf(peek), easing: "linear" },
    { offset: PEEK_MOMENTS.caughtAt, transform: tf(peek), easing: "cubic-bezier(.55,0,1,.45)", name: "hold" },
    // Caught: back behind the chat, fast, with a squash.
    { offset: 0.85, transform: tf(ready, [1.06, 0.92]), easing: "ease-out", name: "duck" },
    { offset: 0.9, transform: tf(ready), easing: "ease-in-out" },
    { offset: 1, transform: tf(hidden), name: "end" },
  ];
}

/**
 * Which edges a chat's dino may peek from: its free side, and the top unless text sits right above the chat; on a
 * phone (a full-width chat) the top is the only way out.
 */
export function sidesFor(free: "left" | "right", phone: boolean, top = true): Side[] {
  return phone ? ["top"] : top ? [free, "top"] : [free];
}

/**
 * Where the one dino goes next: the most visible chat (at least half on screen) it didn't peek from in the last
 * 8 seconds. null when none qualifies.
 */
export function pickCard(cards: readonly { id: string; ratio: number; lastPeekAt: number }[], now: number): string | null {
  const ok = cards.filter((c) => c.ratio >= MIN_RATIO && now - c.lastPeekAt >= COOLDOWN_MS);
  if (!ok.length) return null;
  return ok.reduce((best, c) => (c.ratio > best.ratio ? c : best)).id;
}

/** The wait before the next peek: 5 to 9 seconds. */
export const nextDelay = (rng: () => number = Math.random) => 5_000 + Math.floor(rng() * 4_000);
