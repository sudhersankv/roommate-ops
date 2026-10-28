// Runs before `mastra dev` (npm run mastra:dev): refresh the Studio request-context presets from the DB.
import "../src/lib/env";
import { db } from "../src/db";
import { PRESETS_FILE, writeStudioPresets } from "./lib/presets";

const presets = await writeStudioPresets();
console.log(presets ? `${PRESETS_FILE}: ${Object.keys(presets).length} presets` : `${PRESETS_FILE}: no Group yet, run npm run seed`);
await db.$client.end();
