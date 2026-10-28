import type { Metadata } from "next"

import { SettingsScreen } from "../_components/screens/settings"

export const metadata: Metadata = { title: "Settings" }

// Admins get every setting; everyone else only Appearance. The server actions check the role again.
export default function SettingsPage() {
  return <SettingsScreen />
}
