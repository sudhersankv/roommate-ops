// How a message flows (docs/plan.md), channel-agnostic. Channel adapters call handleIncoming(); the dashboard's
// "Ask Roomie" calls askRoomie(). Both end in respond():
//   resolve household + member -> log the chat line -> Gate (hard trigger / follow-up window / Jev)
//   -> roomie.generate(text, { requestContext, memory }) -> reply text + links from tool results.
// Each message is one trace: "roomie message" -> "gate" span (+ the agent run, its model calls and tools).
// Roomie's chat replies are logged (memberId null) and open the follow-up window; "[silent]" replies are not.
import "@/lib/env";
import { RequestContext } from "@mastra/core/request-context";
import { SpanType, type AnySpan } from "@mastra/core/observability";
import type { Button, IncomingMessage, Outgoing } from "@/channels/types";
import { getHousehold, householdForChat, linkChannelUser, listMembers, type Member } from "@/services/members";
import { humanMessagesSince, lastRoomieReplyAt, logMessage, recentChatter } from "@/services/chatlog";
import type { Ctx } from "@/services/types";
import { mastra } from "@/mastra";
import type { RoomieContext } from "@/mastra/context";
import { inFollowUpWindow, parseSilent, runGate, saysRoomie, type Chattiness, type GateRun } from "@/mastra/gate";
import { threadFor } from "@/mastra/memory";

/** How many earlier chat lines Jev sees; the agent sees up to 30 as context. */
const GATE_RECENT = 6;
const ACK = "👍";

export type RespondInput = {
  householdId: string;
  member: Pick<Member, "id" | "name">;
  text: string;
  source: "chat" | "ui";
  channel: string;
  isVoice?: boolean;
  isReplyToRoomie?: boolean;
  mentionsRoomie?: boolean;
};

export type PipelineResult = {
  /** null = Roomie stays quiet. */
  out: Outgoing | null;
  gate: GateRun;
  /** Tool ids the agent called, in order (working-memory updates included). */
  toolCalls: string[];
  traceId?: string;
};

/** Channel entry point: a normalized chat message in, Roomie's reply (or null) out. */
export async function handleIncoming(msg: IncomingMessage): Promise<Outgoing | null> {
  return (await respondToIncoming(msg)).out;
}

export async function respondToIncoming(msg: IncomingMessage): Promise<PipelineResult> {
  const house = await householdForChat(msg.chatId, msg.chatTitle);
  const member = await linkChannelUser(house.id, msg.userId, msg.userName);
  return respond({
    householdId: house.id,
    member,
    text: msg.text,
    source: "chat",
    channel: msg.channel,
    isVoice: msg.isVoice,
    isReplyToRoomie: msg.isReplyToRoomie,
    mentionsRoomie: msg.mentionsRoomie,
  });
}

/** Dashboard entry point ("Ask Roomie"): always addressed, never logged to the chat. */
export async function askRoomie(ctx: Ctx, text: string): Promise<Outgoing> {
  const me = (await listMembers(ctx)).find((m) => m.id === ctx.actorId);
  const { out } = await respond({ householdId: ctx.householdId, member: { id: ctx.actorId, name: me?.name ?? "Someone" }, text, source: "ui", channel: "dashboard" });
  return out ?? { text: ACK };
}

export async function respond(input: RespondInput): Promise<PipelineResult> {
  const { householdId, member, text, source } = input;
  const chat = source === "chat";
  const line = `${input.isVoice ? `[voice note from ${member.name}]` : `[${member.name}]`} ${text}`;
  if (chat) await logMessage(householdId, member.id, input.isVoice ? `(voice) ${text}` : text);

  const [house, people, chatter] = await Promise.all([getHousehold(householdId), listMembers({ householdId }), chat ? recentChatter(householdId) : Promise.resolve([])]);
  const earlier = chatter.slice(0, -1); // everything before this message
  const hardTrigger = !chat || !!(input.isVoice || input.isReplyToRoomie || input.mentionsRoomie || saysRoomie(text));
  let inWindow = false;
  if (chat && !hardTrigger) {
    const lastRoomieAt = await lastRoomieReplyAt(householdId);
    // Counted after the log above, so this includes the current message (see gate/policy.ts).
    inWindow = inFollowUpWindow({ lastRoomieAt, humanSinceRoomie: lastRoomieAt ? await humanMessagesSince(householdId, lastRoomieAt) : 0 });
  }

  const root = startSpan("roomie message", { text: line }, { channel: input.channel, source, householdId, actorId: member.id });
  const gateSpan = root?.createChildSpan({ type: SpanType.GENERIC, name: "gate", input: { latest: line, hardTrigger, inWindow } });
  const gate = await runGate({
    latest: line,
    recent: earlier.slice(-GATE_RECENT),
    members: people.map((p) => p.name),
    hardTrigger,
    inWindow,
    chattiness: (house?.chattiness ?? "normal") as Chattiness,
  });
  const gateMeta = {
    gateDecision: gate.decision,
    gateReason: gate.reason,
    gateToolkit: gate.toolkit ?? "all",
    unprompted: gate.unprompted,
    jevMs: gate.jevMs,
    ...(gate.jev ? { pAct: gate.jev.intent.act, pClarify: gate.jev.intent.clarify, pIgnore: gate.jev.intent.ignore, addressed: gate.jev.addressed } : {}),
    ...(gate.jevError ? { jevError: gate.jevError.slice(0, 200) } : {}),
  };
  gateSpan?.end({ output: { speak: gate.speak, decision: gate.decision, toolkit: gate.toolkit }, metadata: gateMeta });

  if (!gate.speak) {
    root?.end({ output: { replied: false }, metadata: gateMeta });
    return { out: null, gate, toolCalls: [], traceId: root?.traceId };
  }

  const ctx: RoomieContext = {
    householdId,
    actorId: member.id,
    actorName: member.name,
    source,
    ...(gate.toolkit ? { toolkit: gate.toolkit } : {}),
    ...(gate.decision !== "ignore" ? { gate: { decision: gate.decision, unprompted: gate.unprompted } } : {}),
    ...(gate.mayStaySilent ? { mayStaySilent: true } : {}),
  };
  const requestContext = new RequestContext<RoomieContext>(Object.entries(ctx) as [keyof RoomieContext, never][]);

  try {
    const res = await mastra.getAgentById("roomie").generate(line, {
      requestContext,
      memory: threadFor(householdId),
      ...(earlier.length ? { context: [{ role: "user" as const, content: `Recent group chat (for context, not addressed to you):\n${earlier.join("\n")}` }] } : {}),
      tracingContext: { currentSpan: root },
      tracingOptions: { metadata: { ...gateMeta, channel: input.channel } },
    });
    const steps = res.steps ?? [];
    const toolCalls = steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.payload.toolName));
    const buttons = collectLinks(steps.flatMap((s) => (s.toolResults ?? []).map((r) => r.payload.result)));

    // "[silent]" (or nothing, with nothing done) is only honoured in the follow-up window. Otherwise never post the
    // literal token or an empty message: acknowledge instead.
    let replyText = parseSilent(res.text ?? "");
    if (replyText === null) replyText = gate.mayStaySilent ? null : ACK;
    else if (!replyText) replyText = gate.mayStaySilent && !toolCalls.some(isActionTool) ? null : ACK;

    if (replyText === null) {
      root?.end({ output: { replied: false, silent: true }, metadata: gateMeta });
      return { out: null, gate, toolCalls, traceId: root?.traceId };
    }
    if (chat) await logMessage(householdId, null, replyText);
    const out: Outgoing = { text: replyText, ...(buttons.length ? { buttons } : {}) };
    root?.end({ output: out, metadata: gateMeta });
    return { out, gate, toolCalls, traceId: root?.traceId };
  } catch (err) {
    root?.error({ error: err instanceof Error ? err : new Error(String(err)), metadata: gateMeta });
    throw err;
  }
}

/** Tools that change something (anything but Mastra's working-memory bookkeeping). */
const isActionTool = (id: string) => id !== "updateWorkingMemory";

/** `links` from every tool result, deduped by url, in call order. */
export function collectLinks(results: unknown[]): Button[] {
  const seen = new Set<string>();
  const out: Button[] = [];
  for (const r of results) {
    const links = (r as { links?: unknown } | null)?.links;
    if (!Array.isArray(links)) continue;
    for (const l of links as Button[]) {
      if (l?.url && !seen.has(l.url)) {
        seen.add(l.url);
        out.push({ text: l.text, url: l.url });
      }
    }
  }
  return out;
}

function startSpan(name: string, input: unknown, metadata: Record<string, unknown>): AnySpan | undefined {
  try {
    return mastra.observability.getDefaultInstance()?.startSpan({ type: SpanType.GENERIC, name, input, metadata }) as AnySpan | undefined;
  } catch (e) {
    console.warn("[pipeline] tracing unavailable", e);
    return undefined;
  }
}
