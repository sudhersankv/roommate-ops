// The Postgres-backed WhatsApp login, on an in-memory wa_sessions: creds and Signal keys survive a round trip through
// JSON (what jsonb keeps), Buffers come back as Buffers, deletes and logout clear rows. No DB, no network.
// Run: npx tsx --test src/channels/whatsapp-auth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initAuthCreds, proto } from "baileys";
import { fromStored, makeAuthState, toStored, type AuthRows } from "./whatsapp-auth";

/** wa_sessions in memory; values go through JSON like jsonb does. */
function memoryRows() {
  const rows = new Map<string, unknown>();
  let writes = 0;
  const store: AuthRows = {
    async get(keys) {
      return new Map(keys.filter((k) => rows.has(k)).map((k) => [k, JSON.parse(JSON.stringify(rows.get(k)))]));
    },
    async set(list) {
      writes++;
      await new Promise((r) => setImmediate(r));
      for (const r of list) rows.set(r.key, JSON.parse(JSON.stringify(r.value)));
    },
    async del(keys) {
      for (const k of keys) rows.delete(k);
    },
    async clear() {
      rows.clear();
    },
  };
  return { store, rows, writes: () => writes };
}

test("fresh: new creds, no session; saved creds come back equal, Buffers revived", async () => {
  const mem = memoryRows();
  const first = await makeAuthState(mem.store);
  assert.equal(first.hasSession, false);
  first.state.creds.me = { id: "15550000000:3@s.whatsapp.net", name: "Roomie" };
  first.state.creds.registered = true;
  await first.saveCreds();

  const stored = mem.rows.get("creds") as { noiseKey: { private: { type: string; data: string } } };
  assert.equal(stored.noiseKey.private.type, "Buffer");
  assert.equal(typeof stored.noiseKey.private.data, "string", "base64 in jsonb");

  const again = await makeAuthState(mem.store);
  assert.equal(again.hasSession, true);
  assert.ok(Buffer.isBuffer(again.state.creds.noiseKey.private));
  assert.deepEqual(Buffer.from(again.state.creds.noiseKey.private), Buffer.from(first.state.creds.noiseKey.private));
  assert.deepEqual(Buffer.from(again.state.creds.signedIdentityKey.public), Buffer.from(first.state.creds.signedIdentityKey.public));
  assert.equal(again.state.creds.signedPreKey.keyId, first.state.creds.signedPreKey.keyId);
  assert.equal(again.state.creds.advSecretKey, first.state.creds.advSecretKey);
  assert.equal(again.state.creds.me?.id, "15550000000:3@s.whatsapp.net");
});

test("Signal keys: set as <type>-<id> rows, get back typed values, null deletes", async () => {
  const mem = memoryRows();
  const { state } = await makeAuthState(mem.store);
  const pair = initAuthCreds().signedIdentityKey;
  await state.keys.set({
    "pre-key": { "1": pair, "2": pair },
    session: { "15551234567.0": Buffer.from([1, 2, 3]) },
    "lid-mapping": { "15551234567": "987654321" },
    "app-state-sync-key": { AAAA: { keyData: Buffer.from([9, 9]), timestamp: 5 } },
  });
  assert.deepEqual([...mem.rows.keys()].sort(), ["app-state-sync-key-AAAA", "lid-mapping-15551234567", "pre-key-1", "pre-key-2", "session-15551234567.0"]);

  const pre = await state.keys.get("pre-key", ["1", "3"]);
  assert.deepEqual(Object.keys(pre), ["1"], "missing ids are left out");
  assert.ok(Buffer.isBuffer(pre["1"].private));
  assert.deepEqual(Buffer.from(pre["1"].public), Buffer.from(pair.public));
  assert.deepEqual((await state.keys.get("session", ["15551234567.0"]))["15551234567.0"], Buffer.from([1, 2, 3]));
  assert.equal((await state.keys.get("lid-mapping", ["15551234567"]))["15551234567"], "987654321");
  const sync = (await state.keys.get("app-state-sync-key", ["AAAA"])).AAAA;
  assert.ok(sync instanceof proto.Message.AppStateSyncKeyData, "app-state-sync-key is a proto again");
  assert.deepEqual(Buffer.from(sync.keyData!), Buffer.from([9, 9]));

  await state.keys.set({ "pre-key": { "1": null } });
  assert.equal(mem.rows.has("pre-key-1"), false);
  assert.equal(mem.rows.has("pre-key-2"), true);
});

test("creds writes fold together; clear() drops the whole session", async () => {
  const mem = memoryRows();
  const auth = await makeAuthState(mem.store);
  await Promise.all([auth.saveCreds(), auth.saveCreds(), auth.saveCreds()]);
  assert.ok(mem.writes() <= 2, `three saves while one is running = at most two writes (got ${mem.writes()})`);
  await auth.state.keys.set({ session: { a: Buffer.from([1]) } });
  await auth.clear();
  assert.equal(mem.rows.size, 0);
  assert.equal((await makeAuthState(mem.store)).hasSession, false);
});

test("toStored / fromStored: nested Buffers and Uint8Arrays survive JSON", () => {
  const value = { a: Buffer.from("hi"), b: [new Uint8Array([1, 2])], c: { d: 1 } };
  const back = fromStored<typeof value>(JSON.parse(JSON.stringify(toStored(value))));
  assert.deepEqual(back.a, Buffer.from("hi"));
  assert.deepEqual(back.b[0], Buffer.from([1, 2]));
  assert.deepEqual(back.c, { d: 1 });
});
