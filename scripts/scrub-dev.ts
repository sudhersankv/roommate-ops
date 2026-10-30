// npx tsx scripts/scrub-dev.ts: makes a fresh copy of production safe to develop on (audit B1). A Neon `dev` branch
// starts as a copy of prod, real people included. This keeps only the `dev` Channel Groups (seed, evals, dev-chat) and
// drops everything else that's personal or live: the Telegram / WhatsApp Groups (with their memory), Roomie's WhatsApp
// login (a local run must never take over the prod number), wa_contacts, beta requests, Trick votes, every trace and
// score, memory of Groups that are gone, and Accounts no remaining Member uses. Refuses to run on the production branch.
import "../src/lib/env";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { deleteGroup } from "../src/services/groups";
import { neonBranch, PROD_BRANCH_ID } from "./lib/prod-guard";

const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
const count = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rowCount ?? 0;

async function main() {
  const branch = await neonBranch(db);
  if (!branch || branch === PROD_BRANCH_ID) {
    console.error(`Refusing: DATABASE_URL is ${branch ? "the production branch" : "not a Neon branch I can identify"}. Point .env at the dev branch.`);
    process.exit(1);
  }
  console.log(`Scrubbing Neon branch ${branch}`);

  const live = await rows<{ id: string; name: string; channel: string }>(
    sql`select g.id, g.name, c.channel from groups g left join chats c on c.group_id = g.id where c.channel is distinct from 'dev' order by g.created_at`,
  );
  for (const g of live) {
    await deleteGroup(g.id);
    console.log(`deleted Group (${g.channel ?? "no chat"}) ${g.id}`);
  }

  for (const t of ["wa_sessions", "wa_contacts", "beta_requests", "trick_votes", "mastra_scorers", "mastra_ai_spans", "mastra_workflow_snapshot"]) {
    console.log(`${t}: deleted ${await count(sql.raw(`delete from ${t}`))}`);
  }
  // Memory of Groups that no longer exist (older thread names included).
  const keep = sql`(select id::text from groups)`;
  console.log(`mastra_messages: deleted ${await count(sql`delete from mastra_messages where "resourceId" is null or "resourceId" not in ${keep}`)}`);
  console.log(`memory_messages_1024: deleted ${await count(sql`delete from memory_messages_1024 where metadata->>'thread_id' is null or metadata->>'thread_id' not in (select id from mastra_threads where "resourceId" in ${keep})`)}`);
  console.log(`mastra_threads: deleted ${await count(sql`delete from mastra_threads where "resourceId" not in ${keep}`)}`);
  console.log(`mastra_resources: deleted ${await count(sql`delete from mastra_resources where id not in ${keep}`)}`);
  console.log(`accounts: deleted ${await count(sql`delete from accounts a where not exists (select 1 from members m where m.account_id = a.id)`)}`);

  const left = await rows<{ channel: string; n: number }>(sql`select c.channel, count(*)::int as n from chats c group by 1`);
  console.log("Chats left:", left);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
