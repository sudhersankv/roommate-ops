// Lease Inbox's dashboard sections (server components; the agent runtime never loads this file).
import { inboxView } from "@/app/g/[groupId]/_components/data"
import { LeaseInboxSettingsSection } from "@/app/g/[groupId]/_components/screens/inbox"
import type { ToolkitSectionCtx } from "../types"

/** The address with Copy for everyone; Admins also manage the trusted senders and can release the address. */
export async function LeaseInboxSettings({ ctx }: { ctx: ToolkitSectionCtx }) {
  const view = await inboxView(ctx.session)
  return <LeaseInboxSettingsSection address={view.address} senders={view.senders} isAdmin={ctx.isAdmin} />
}
