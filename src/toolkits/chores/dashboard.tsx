// Chores' dashboard sections (server components; the agent runtime never loads this file).
import { choresView } from "@/app/g/[groupId]/_components/data"
import { ChoresToday } from "@/app/g/[groupId]/_components/screens/home"
import type { ToolkitSectionCtx } from "../types"

export async function ChoresHome({ ctx }: { ctx: ToolkitSectionCtx }) {
  const { chores } = await choresView(ctx.session)
  return <ChoresToday chores={chores} />
}
