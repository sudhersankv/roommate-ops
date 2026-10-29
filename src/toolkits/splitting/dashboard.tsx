// Splitting's dashboard sections (server components; the agent runtime never loads this file).
import { moodForBalance } from "@/components/roomie/mascot"
import { balancesView, splitwiseView } from "@/app/g/[groupId]/_components/data"
import { BalanceSection } from "@/app/g/[groupId]/_components/screens/home"
import { SplittingSettingsSection } from "@/app/g/[groupId]/_components/screens/settings"
import type { ToolkitSectionCtx } from "../types"

export async function SplittingHome({ ctx }: { ctx: ToolkitSectionCtx }) {
  const { you, plan } = await balancesView(ctx.session)
  return <BalanceSection you={you} plan={plan} />
}

/** Admins: simplify debts and Splitwise. Everyone else sees nothing here. */
export async function SplittingSettings({ ctx }: { ctx: ToolkitSectionCtx }) {
  if (!ctx.isAdmin) return null
  return <SplittingSettingsSection splitwise={await splitwiseView(ctx.session)} />
}

/** Owed: happy; deep in the red: worried; square: sleepy. */
export async function splittingMood(ctx: ToolkitSectionCtx) {
  const { you } = await balancesView(ctx.session)
  return moodForBalance(you, true)
}
