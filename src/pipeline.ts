// How a message flows (docs/plan.md), channel-agnostic. Channel adapters call handleIncoming(); the dashboard's
// "Ask Roomie" calls askRoomie(). Both end in respond():
//   resolve Group + Member (unknown Chat -> Onboarding; unknown sender -> Pending member) -> log the chat line
//   -> Gate (hard trigger / follow-up window / Jev) -> roomie.generate(text, { requestContext, memory })
//   -> reply text + links from tool results.
// Each message is one trace: "roomie message" -> "gate" span (+ the agent run, its model calls and tools).
// Roomie's chat replies are logged (memberId null) and open the follow-up window; "[silent]" replies are not.
import "@/lib/env";
import { RequestContext } from "@mastra/core/request-context";
import { SpanType, type AnySpan } from "@mastra/core/observability";
import { deliver } from "@/channels";
import type { Button, IncomingMessage, Outgoing } from "@/channels/types";
import { chatFor, enabledToolkits, getGroup } from "@/services/groups";
import { getMember, listGroupMembers, memberByChannelUser, type Member } from "@/services/members";
import { humanMessagesSince, lastRoomieReplyAt, logMessage, recentChatter } from "@/services/chatlog";
import type { Ctx } from "@/services/types";
import { mastra } from "@/mastra";
import type { RoomieContext } from "@/mastra/context";
import { callsPet, inFollowUpWindow, parseSilent, runGate, type Chattiness, type GateRun } from "@/mastra/gate";
import { threadFor } from "@/mastra/memory";
import { onGroupJoined, onUnknownSender } from "@/onboarding";
import { localDay } from "@/lib/dates";
import { isPetCommand, normalizePersonality, winsFrom, type Personality } from "@/lib/personality";
import { allSquare } from "@/services/personality";
import { claimWins, dayGreeting, dbMoments } from "@/services/pet";

/** How many earlier chat lines Jev sees; the agent sees up to 30 as context. */
const GATE_RECENT = 6;
/** While setup is unfinished, the Admin's Chat messages are for Roomie for this long after it joined. */
const SETUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACK = "👍";

export type RespondInput = {
  groupId: string;
  member: Pick<Member, "id" | "displayName" | "role" | "status">;
  text: string;
  source: "chat" | "ui";
  channel: string;
  isVoice?: boolean;
  imageUrl?: string;
  isReplyToRoomie?: boolean;
  mentionsRoomie?: boolean;
  /** A 1:1 chat with Roomie: addressed, and kept out of the group chat log (no follow-up window). */
  isPrivate?: boolean;
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

/**
 * Resolve the Group and Member for a Channel message. A Chat Roomie never saw a join event for is onboarded with the
 * sender as its Admin; a sender Roomie doesn't know becomes a Pending member and the Admins are asked to approve.
 */
export async function resolveIncoming(msg: IncomingMessage): Promise<{ groupId: string; member: Member }> {
  const sender = { userExternalId: msg.userExternalId, name: msg.userName };
  const known = await chatFor(msg.channel, msg.chatExternalId);
  if (msg.isPrivate && !known) throw new Error("A private message needs a known Chat.");
  if (!known) {
    const joined = await onGroupJoined({ channel: msg.channel, externalId: msg.chatExternalId, title: msg.chatTitle }, [sender], sender);
    if (joined.intro) await deliver(joined.group.id, joined.intro);
    return { groupId: joined.group.id, member: joined.members[0] };
  }
  const groupId = known.group.id;
  const member = await memberByChannelUser(groupId, msg.userExternalId);
  if (member && member.status !== "removed") return { groupId, member };
  if (msg.isPrivate) throw new Error("A private message needs a Member of the Group.");
  // A missed join event fails safe (Pending), except where the Channel can't list members (ADR 0010).
  const joined = await onUnknownSender(known.chat, sender);
  if (joined.announce) await deliver(groupId, joined.announce);
  return { groupId, member: joined.member };
}

export async function respondToIncoming(msg: IncomingMessage): Promise<PipelineResult> {
  const { groupId, member } = await resolveIncoming(msg);
  return respond({
    groupId,
    member,
    text: msg.text,
    source: "chat",
    channel: msg.channel,
    isVoice: msg.isVoice,
    imageUrl: msg.imageUrl,
    isReplyToRoomie: msg.isReplyToRoomie,
    mentionsRoomie: msg.mentionsRoomie,
    isPrivate: msg.isPrivate,
  });
}

/** Dashboard entry point ("Ask Roomie"): always addressed, never logged to the chat. */
export async function askRoomie(ctx: Ctx, text: string): Promise<Outgoing> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me) throw new Error("Not a member of this group.");
  const { out } = await respond({ groupId: ctx.groupId, member: me, text, source: "ui", channel: "dashboard" });
  return out ?? { text: ACK };
}

export async function respond(input: RespondInput): Promise<PipelineResult> {
  const { groupId, member, text, source } = input;
  const chat = source === "chat" && !input.isPrivate;
  const photo = input.imageUrl ? `[photo: ${input.imageUrl}] ` : "";
  const line = `${input.isVoice ? `[voice note from ${member.displayName}]` : `[${member.displayName}]`} ${photo}${text}`;
  if (chat) await logMessage(groupId, member.id, input.isVoice ? `(voice) ${text}` : input.imageUrl ? `(photo) ${text}` : text);

  const [group, people, chatter, toolkits] = await Promise.all([
    getGroup(groupId),
    listGroupMembers({ groupId }),
    source === "chat" ? recentChatter(groupId) : Promise.resolve([]),
    enabledToolkits({ groupId }),
  ]);
  const earlier = chat ? chatter.slice(0, -1) : chatter; // everything before this message
  const personality = normalizePersonality(group?.personality);
  const petted = isPetCommand(text, personality.name);
  let hardTrigger = !chat || petted || !!(input.isVoice || input.isReplyToRoomie || input.mentionsRoomie || callsPet(text, personality.name));
  let inWindow = false;
  const lastRoomieAt = chat ? await lastRoomieReplyAt(groupId) : null;
  if (chat && !hardTrigger) {
    // Counted after the log above, so this includes the current message (see gate/policy.ts).
    inWindow = inFollowUpWindow({ lastRoomieAt, humanSinceRoomie: lastRoomieAt ? await humanMessagesSince(groupId, lastRoomieAt) : 0 });
    // Onboarding asked the Chat a question; an active Member's reply in the window is the answer.
    if (inWindow && group && !group.onboardedAt && member.status === "active") hardTrigger = true;
  }
  // The Admin was asked that question directly, and people answer hours later: until setup is done (for a day), what
  // the Admin says in the Chat is for Roomie.
  if (chat && group && !group.onboardedAt && member.role === "admin" && Date.now() - group.createdAt.getTime() < SETUP_WINDOW_MS) hardTrigger = true;
  // The day's first message gets one hello (services/pet.ts); claimed here so it happens once, whatever the Gate says.
  const greeting =
    chat && group && group.onboardedAt
      ? await dayGreeting(dbMoments, { groupId, chattiness: group.chattiness, personality, timezone: group.timezone, roomieSpokeAt: lastRoomieAt }).catch((e) => {
          console.warn("[pipeline] greeting check failed", e);
          return null;
        })
      : null;

  const root = startSpan("roomie message", { text: line }, { channel: input.channel, source, groupId, memberId: member.id, role: member.role, status: member.status });
  const gateSpan = root?.createChildSpan({ type: SpanType.GENERIC, name: "gate", input: { latest: line, hardTrigger, inWindow } });
  const gate = await runGate({
    latest: line,
    recent: earlier.slice(-GATE_RECENT),
    members: people.map((p) => p.displayName),
    hardTrigger,
    inWindow,
    chattiness: (group?.chattiness ?? "normal") as Chattiness,
    toolkits,
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
    // Nobody needs Roomie, but it's the first message today: just the hello (one line, no link, not logged, so it
    // doesn't open the follow-up window).
    if (greeting) {
      root?.end({ output: { replied: true, greeting }, metadata: gateMeta });
      return { out: { text: greeting }, gate, toolCalls: [], traceId: root?.traceId };
    }
    root?.end({ output: { replied: false }, metadata: gateMeta });
    return { out: null, gate, toolCalls: [], traceId: root?.traceId };
  }

  const ctx: RoomieContext = {
    groupId,
    memberId: member.id,
    memberName: member.displayName,
    role: member.role,
    status: member.status,
    source,
    toolkits,
    ...(gate.toolkit ? { toolkit: gate.toolkit } : {}),
    ...(gate.decision !== "ignore" ? { gate: { decision: gate.decision, unprompted: gate.unprompted } } : {}),
    ...(gate.mayStaySilent ? { mayStaySilent: true } : {}),
    ...(petted ? { pet: "petted" as const } : greeting ? { pet: "greet" as const } : {}),
  };
  const requestContext = new RequestContext<RoomieContext>(Object.entries(ctx) as [keyof RoomieContext, never][]);

  try {
    const res = await mastra.getAgentById("roomie").generate(line, {
      requestContext,
      memory: threadFor(groupId),
      ...(earlier.length ? { context: [{ role: "user" as const, content: `Recent group chat (for context, not addressed to you):\n${earlier.join("\n")}` }] } : {}),
      tracingContext: { currentSpan: root },
      tracingOptions: { metadata: { ...gateMeta, channel: input.channel } },
    });
    const steps = res.steps ?? [];
    const toolCalls = steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.payload.toolName));
    const results = steps.flatMap((s) => (s.toolResults ?? []).map((r) => r.payload));
    const buttons = collectLinks(results.map((r) => r.result));

    // "[silent]" (or nothing, with nothing done) is only honoured in the follow-up window. Otherwise never post the
    // literal token or an empty message: acknowledge instead.
    let replyText = parseSilent(res.text ?? "");
    if (replyText === null) replyText = gate.mayStaySilent ? null : ACK;
    else if (!replyText) replyText = gate.mayStaySilent && !toolCalls.some(isActionTool) ? null : ACK;

    if (replyText === null) {
      root?.end({ output: { replied: false, silent: true }, metadata: gateMeta });
      return { out: null, gate, toolCalls, traceId: root?.traceId };
    }
    // A win (everyone square, a 3/7/30 streak, a Checkout) gets one short line in the pet's voice, once.
    const cheer = await winCheer(groupId, member.displayName, group?.timezone, personality, steps).catch((e) => {
      console.warn("[pipeline] win check failed", e);
      return null;
    });
    if (cheer) replyText = `${replyText} ${cheer}`;
    if (chat) await logMessage(groupId, null, replyText);
    const out: Outgoing = { text: replyText, ...(buttons.length ? { buttons } : {}) };
    root?.end({ output: out, metadata: gateMeta });
    return { out, gate, toolCalls, traceId: root?.traceId };
  } catch (err) {
    root?.error({ error: err instanceof Error ? err : new Error(String(err)), metadata: gateMeta });
    throw err;
  }
}

type StepLike = {
  toolCalls?: { payload: { toolName: string; toolCallId?: string; args?: unknown } }[];
  toolResults?: { payload: { toolName: string; toolCallId?: string; result?: unknown } }[];
};

/** The first new win in this run's tool results, as one line, or null. Claimed in pet_moments so it's said once. */
async function winCheer(groupId: string, senderName: string, tz: string | undefined, personality: Personality, steps: StepLike[]): Promise<string | null> {
  const calls = steps.flatMap((s) => s.toolCalls ?? []).map((c) => c.payload);
  const results = steps.flatMap((s) => s.toolResults ?? []).map((r) => ({
    tool: r.payload.toolName,
    result: r.payload.result,
    args: calls.find((c) => c.toolCallId && c.toolCallId === r.payload.toolCallId)?.args,
  }));
  if (!results.some((r) => ["log_chore", "settle_up", "cart_checkout"].includes(r.tool))) return null;
  const settled = results.some((r) => r.tool === "settle_up" && (r.result as { recorded?: boolean } | null)?.recorded === true);
  const wins = winsFrom(results, { day: localDay(new Date(), tz ?? "America/Chicago"), senderName, allSquareAfter: settled && (await allSquare({ groupId })) });
  const [line] = await claimWins(dbMoments, groupId, wins.slice(0, 1), personality);
  return line ?? null;
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
