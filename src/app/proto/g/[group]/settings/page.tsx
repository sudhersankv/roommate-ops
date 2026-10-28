import type { Metadata } from "next"

import { SettingsScreen } from "../../../_components/screens/settings"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return <SettingsScreen />
}
