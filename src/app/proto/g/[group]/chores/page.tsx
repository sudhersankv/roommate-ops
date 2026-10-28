import type { Metadata } from "next"

import { ChoresScreen } from "../../../_components/screens/chores"

export const metadata: Metadata = { title: "Chores" }

export default function ChoresPage() {
  return <ChoresScreen />
}
