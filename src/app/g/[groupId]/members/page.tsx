import type { Metadata } from "next"

import { MembersScreen } from "../_components/screens/members"

export const metadata: Metadata = { title: "Members" }

// The layout already loaded the Members (with handles) for the signed-in Member; admin controls follow their role.
export default function MembersPage() {
  return <MembersScreen />
}
