// House's dashboard sections (server components; the agent runtime never loads this file).
import { choresView, scheduleView } from "@/app/g/[groupId]/_components/data"
import { ChoresToday, UpkeepToday } from "@/app/g/[groupId]/_components/screens/home"
import { HouseSettingsSection } from "@/app/g/[groupId]/_components/screens/settings"
import type { ToolkitSectionCtx } from "../types"

/** Today: your chores due, then the next upkeep item that's due (nothing when the house is fine). */
export async function HouseHome({ ctx }: { ctx: ToolkitSectionCtx }) {
  const { chores, upkeep } = await choresView(ctx.session)
  return (
    <>
      <ChoresToday chores={chores} />
      <UpkeepToday upkeep={upkeep} />
    </>
  )
}

/** Admins: the hour of the morning nudge. Everyone else sees nothing here. */
export async function HouseSettings({ ctx }: { ctx: ToolkitSectionCtx }) {
  if (!ctx.isAdmin) return null
  return <HouseSettingsSection schedule={await scheduleView(ctx.session)} />
}
