import { permanentRedirect } from "next/navigation"

// The Chores page is the House page now (Chores and Upkeep tabs); its Reminders tab is a page of its own.
export default async function ChoresPage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ groupId }, { tab }] = await Promise.all([params, searchParams])
  permanentRedirect(tab === "reminders" ? `/g/${groupId}/reminders` : `/g/${groupId}/house${tab === "upkeep" ? "?tab=upkeep" : ""}`)
}
