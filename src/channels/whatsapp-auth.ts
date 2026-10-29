// The WhatsApp login in Postgres instead of Baileys' useMultiFileAuthState folder, so a redeploy (a new Fly machine,
// a fresh disk) keeps Roomie linked. Rows of wa_sessions: "creds" and "<type>-<id>" for every Signal key, each value
// in Baileys' BufferJSON form (Buffers as base64). Keys are written as Baileys sets them; creds are written behind
// creds.update (coalesced: one write in flight, the latest state wins).
//
// makeAuthState() only needs an AuthRows store, so whatsapp-auth.test.ts runs on an in-memory one; postgresAuthState()
// loads the real store lazily (nothing here builds a DB client at import).
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataSet, type SignalDataTypeMap } from "baileys";

/** Raw rows of one session (jsonb values as stored). */
export type AuthRows = {
  get(keys: string[]): Promise<Map<string, unknown>>;
  set(rows: { key: string; value: unknown }[]): Promise<void>;
  del(keys: string[]): Promise<void>;
  /** Drop the whole session (logged out). */
  clear(): Promise<void>;
};

export type StoredAuth = {
  state: AuthenticationState;
  /** Persist creds (wire to creds.update). Calls while a write is running fold into one more write. */
  saveCreds(): Promise<void>;
  /** Forget the login: the next connect shows a new QR. */
  clear(): Promise<void>;
  /** Whether a linked login was found (creds.registered or a known account). */
  hasSession: boolean;
};

/** JSON-safe form for jsonb (Buffers / Uint8Arrays -> { type: "Buffer", data: base64 }). */
export const toStored = (value: unknown): unknown => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
/** Back from jsonb, Buffers revived. */
export const fromStored = <T>(value: unknown): T => JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;

const CREDS = "creds";
const keyOf = (type: string, id: string) => `${type}-${id}`;

export async function makeAuthState(rows: AuthRows): Promise<StoredAuth> {
  const stored = (await rows.get([CREDS])).get(CREDS);
  const creds: AuthenticationCreds = stored ? fromStored<AuthenticationCreds>(stored) : initAuthCreds();

  let writing: Promise<void> | null = null;
  let again = false;
  const writeCreds = async () => {
    do {
      again = false;
      await rows.set([{ key: CREDS, value: toStored(creds) }]);
    } while (again);
  };
  const saveCreds = () => {
    if (writing) {
      again = true;
      return writing;
    }
    writing = writeCreds().finally(() => (writing = null));
    return writing;
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const found = await rows.get(ids.map((id) => keyOf(type, id)));
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const raw = found.get(keyOf(type, id));
          if (raw === undefined || raw === null) continue;
          let value = fromStored<SignalDataTypeMap[T]>(raw);
          if (type === "app-state-sync-key") value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
          out[id] = value;
        }
        return out;
      },
      set: async (data: SignalDataSet) => {
        const put: { key: string; value: unknown }[] = [];
        const drop: string[] = [];
        for (const [type, byId] of Object.entries(data)) {
          for (const [id, value] of Object.entries(byId ?? {})) {
            if (value) put.push({ key: keyOf(type, id), value: toStored(value) });
            else drop.push(keyOf(type, id));
          }
        }
        if (put.length) await rows.set(put);
        if (drop.length) await rows.del(drop);
      },
      clear: () => rows.clear(),
    },
  };

  return {
    state,
    saveCreds,
    clear: async () => {
      await writing?.catch(() => {});
      await rows.clear();
    },
    hasSession: !!stored && (creds.registered || !!creds.me?.id),
  };
}

/** The auth state in wa_sessions (one row set per `sessionId`). */
export async function postgresAuthState(sessionId = "default"): Promise<StoredAuth> {
  const { pgAuthRows } = await import("./whatsapp-store");
  return makeAuthState(pgAuthRows(sessionId));
}
