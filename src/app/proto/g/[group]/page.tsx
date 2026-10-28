import type { Metadata } from "next"

import { HomeScreen } from "../../_components/screens/home"

export const metadata: Metadata = { title: "Apt 4B" }

export default function GroupHomePage() {
  return <HomeScreen />
}
