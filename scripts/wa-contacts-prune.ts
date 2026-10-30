// One-off cleanup for audit H3: delete wa_contacts rows for people who aren't a Member anywhere (neither their LID nor
// their phone JID is any Member's channel_user_id). Before the fix every LID <-> phone pair Baileys saw was stored.
//   npx tsx scripts/wa-contacts-prune.ts          # counts only
//   npx tsx scripts/wa-contacts-prune.ts --yes    # deletes them
// On Fly: fly ssh console -C "npx tsx scripts/wa-contacts-prune.ts --yes" (or run it locally against the prod URL).
import "../src/lib/env";

const { pruneNonMemberContacts } = await import("../src/channels/whatsapp-store");
const { db } = await import("../src/db");

const yes = process.argv.includes("--yes");
const r = await pruneNonMemberContacts({ dryRun: !yes });
console.log(`wa_contacts: ${r.total} rows, ${r.stale} for nobody who's a Member${yes ? `; deleted ${r.deleted}` : " (dry run: --yes deletes them)"}`);
await db.$client.end();
