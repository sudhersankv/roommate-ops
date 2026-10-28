import type { Metadata } from "next"

import { MembersScreen } from "../../../_components/screens/members"

export const metadata: Metadata = { title: "Members" }

export default function MembersPage() {
  return <MembersScreen />
}
