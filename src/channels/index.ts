// Outbound posts that aren't replies (scheduler). No channel is connected yet, so this only logs; the WhatsApp
// adapter (step 2) plugs in here.
import type { Outgoing } from "./types";

export async function deliver(householdId: string, out: Outgoing): Promise<void> {
  console.log(`[roomie] no channel connected, would send to ${householdId}: ${out.text}`);
}
