import { leaseBundleLine, leaseReportParts, startLeaseInbox } from "@/services/lease-inbox-toolkit";
import { defineToolkit } from "../define";
import { leaseInbox as manifest } from "./manifest";
import { leaseInboxTools } from "./tools";
import { skill } from "./skill";

export const leaseInbox = defineToolkit(manifest, {
  skill,
  tools: leaseInboxTools,
  dashboard: {
    settings: () => import("./dashboard").then((m) => m.LeaseInboxSettings),
  },
  // The address (made once; AgentMail dedupes on the Group) and the connect line in the Chat.
  onEnable: async (ctx) => {
    await startLeaseInbox(ctx);
  },
  bundle: (ctx, now) => leaseBundleLine(ctx, now),
  report: (ctx, now) => leaseReportParts(ctx, now),
});
