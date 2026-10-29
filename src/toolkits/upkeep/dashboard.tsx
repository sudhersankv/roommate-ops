// Upkeep's dashboard sections (server components; the agent runtime never loads this file).
import { choresView } from "@/app/g/[groupId]/_components/data"
import { UpkeepToday } from "@/app/g/[groupId]/_components/screens/home"
import type { ToolkitSectionCtx } from "../types"

export async function UpkeepHome({ ctx }: { ctx: ToolkitSectionCtx }) {
  const { upkeep } = await choresView(ctx.session)
  return <UpkeepToday upkeep={upkeep} />
}
