// Wires the WhatsApp adapter to the app. Unlike Telegram (outbound from Next, inbound from polling or a webhook), the
// Baileys socket does both, so ONE process holds it: on Fly that's the Next server (instrumentation.ts calls
// whatsappChannel() when WHATSAPP_ENABLED=1); locally `npx tsx scripts/whatsapp.ts` can hold it instead. Two processes
// on the same session kick each other off (docs/whatsapp.md).
//
// Built once per process (globalThis survives Next HMR and the separate bundles of instrumentation and route
// handlers). The app (pipeline, onboarding, services, DB) is imported lazily, so registering costs nothing up front.
import { registerChannel } from "./index";
import type { WhatsApp, WhatsAppDeps, WhatsAppOptions } from "./whatsapp";

export const whatsappEnabled = () => process.env.WHATSAPP_ENABLED?.trim() === "1";
export const DISABLED = "WhatsApp is off on this server (WHATSAPP_ENABLED=1 turns it on; docs/whatsapp.md)";

type State = { client?: Promise<WhatsApp>; started?: boolean };
const state = (): State => {
  const g = globalThis as { __roomieWhatsApp?: State };
  return (g.__roomieWhatsApp ??= {});
};

const clip = (s: string, n = 90) => {
  const one = s.replace(/\s+/g, " ").trim();
  return JSON.stringify(one.length > n ? `${one.slice(0, n - 1)}…` : one);
};

export async function whatsappDeps(): Promise<WhatsAppDeps> {
  const [{ respondToIncoming, mediaWantedFor }, onboarding, groups, members, { saveUpload }, voice, { pgContacts }, { whatsappAdmission }, kill] = await Promise.all([
    import("@/pipeline"),
    import("@/onboarding"),
    import("@/services/groups"),
    import("@/services/members"),
    import("@/services/receipts"),
    import("@/lib/voice"),
    import("./whatsapp-store"),
    import("@/services/whatsapp-access"),
    import("@/lib/kill-switch"),
  ]);
  return {
    // One "[roomie]" line per message (what the Gate decided, the tools, the time) and one per reply, for bug reports.
    handleIncoming: async (msg) => {
      const started = Date.now();
      const r = await respondToIncoming(msg);
      const tools = r.toolCalls.filter((t) => t !== "updateWorkingMemory");
      const gate = `${r.gate.decision}/${r.gate.reason}${r.gate.toolkit ? `/${r.gate.toolkit}` : ""}`;
      console.log(`[roomie] ${msg.isPrivate ? "dm" : "chat"} ${msg.chatExternalId} ${msg.userName}: ${clip(msg.text)} | gate ${gate}${tools.length ? ` | tools ${tools.join(",")}` : ""}${r.capped ? ` | capped ${r.capped}` : ""} | ${((Date.now() - started) / 1000).toFixed(1)}s${r.traceId ? ` | trace ${r.traceId}` : ""}`);
      console.log(`[roomie]   ${r.out ? `-> ${clip(r.out.text, 140)}${r.out.buttons?.length ? ` [${r.out.buttons.length} link${r.out.buttons.length === 1 ? "" : "s"}]` : ""}` : "(stays quiet)"}`);
      return r.out;
    },
    onGroupJoined: async (chat, participants, addedBy, opts) => {
      if (kill.roomiePaused()) {
        kill.logPaused(`joining ${chat.externalId}`);
        return { intro: null };
      }
      try {
        const res = await onboarding.onGroupJoined(chat, participants, addedBy, opts);
        console.log(`[roomie] joined ${clip(chat.title ?? "")} (${chat.externalId}), added by ${addedBy.name}; ${res.created ? `new Group ${res.group.id} with ${res.members.length} Members, intro queued` : "already known"}`);
        return res;
      } catch (e) {
        if (e instanceof onboarding.JoinRefusedError) return { intro: null, refused: true };
        throw e;
      }
    },
    onParticipantJoined: async (groupId, user) => {
      const res = await onboarding.onParticipantJoined(groupId, user);
      console.log(`[roomie] ${user.name} joined group ${groupId}: ${res.member.status}${res.announce ? ", asked the Admins to approve" : ""}`);
      // Paused (everywhere, or this Group): the Pending Member is still recorded, the approval ask isn't posted.
      return kill.roomiePaused() || (await groups.getGroup(groupId))?.pausedAt ? { ...res, announce: null } : res;
    },
    chatPaused: async (jid) => !!(await groups.chatFor("whatsapp", jid))?.group.pausedAt,
    groupIdOfChat: async (jid) => (await groups.chatFor("whatsapp", jid))?.group.id,
    chatsOfUser: async (userId) => (await groups.chatsOfChannelUser("whatsapp", userId)).map((c) => c.externalId),
    tricksIn: async (jid) => {
      const known = await groups.chatFor("whatsapp", jid);
      return known ? groups.enabledToolkits({ groupId: known.group.id }) : undefined;
    },
    renameChat: (jid, title) => groups.renameChat("whatsapp", jid, title),
    rekeyUser: async (lid, pn) => {
      const moved = await members.rekeyChannelUser("whatsapp", lid, pn);
      if (moved) console.log(`[whatsapp] ${moved} Member${moved === 1 ? "" : "s"} moved from ${lid} to ${pn}`);
    },
    nameSeen: (id, name, placeholder) => members.fillPlaceholderName("whatsapp", id, placeholder, name),
    contacts: pgContacts,
    saveImage: async (jid, messageId, bytes, mime) => {
      const saved = await saveUpload(`wa/${jid.split("@")[0]}`, bytes, mime, messageId);
      return saved.url || saved.path;
    },
    ...(process.env.OPENROUTER_API_KEY ? { transcribe: voice.transcribe } : {}),
    mediaWanted: mediaWantedFor,
    admission: whatsappAdmission,
  };
}

/** The WhatsApp client over the real pipeline and the Postgres session, built once per process. Not started. */
export function whatsappClient(extra: Partial<Pick<WhatsAppOptions, "onQr" | "onStatus" | "logger">> = {}): Promise<WhatsApp> {
  const s = state();
  return (s.client ??= Promise.all([import("./whatsapp"), import("./whatsapp-auth"), whatsappDeps()]).then(([wa, { postgresAuthState }, deps]) => {
    const client = wa.createWhatsApp({ deps, auth: () => postgresAuthState(), ...extra });
    registerChannel(client.channel);
    return client;
  }));
}

/**
 * instrumentation.ts: when WHATSAPP_ENABLED=1, register the Channel and connect once per process if a linked session
 * is saved (no session: wait for an operator to log in at /admin/whatsapp, instead of cycling QR codes nobody sees).
 */
export async function whatsappChannel(): Promise<WhatsApp | null> {
  if (!whatsappEnabled()) return null;
  const s = state();
  const client = await whatsappClient();
  if (!s.started) {
    s.started = true;
    if (await client.hasSession()) await client.start();
    else console.log("[whatsapp] no linked session yet: log in at /admin/whatsapp (docs/whatsapp.md)");
  }
  return client;
}
