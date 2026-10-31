import { defineManifest } from "../define";

// The Group's own email address for the landlord (ADR 0016). Off by default: it needs a connection step (forward the
// lease, CC the address, or give it to the leasing office), so Roomie mentions it when the landlord comes up and it isn't learned (#44).
export const leaseInbox = defineManifest({
  id: "lease-inbox",
  name: "Lease Inbox",
  description: "The Group's own email address for the landlord: notices to the chat and a Reminder the evening before, rent changes to the Admin, work orders emailed from the chat and followed, the rest filed.",
  summary: "Your group's own email address for the landlord.",
  longDescription:
    "Roomie gets an email address you give the landlord or leasing office. Notices (an inspection, a water shut-off) become one line in the chat and a reminder the evening before; \"the sink's leaking, tell them\" sends a work order with your name on it and tracks the reply; everything else is filed where you can find it.",
  icon: "Mail",
  category: "home",
  tags: ["lease", "landlord", "email", "notices", "work orders", "leasing office", "inbox"],
  defaultOn: false,
  // The email service: a key, or the fake on purpose (MAIL_FAKE=1), integrations/mail.ts mailAvailability.
  requires: { integrations: ["agentmail"] },
  status: "stable",
  gate: {
    criterion: "The landlord or leasing office and its emails: notices, inspections, shut-offs, rent or lease changes, reporting something broken for the landlord to fix (a work order: the sink, the heat, a leak) and asking how that's going, replying to them, the group's email address, what the lease says.",
    examples: ["the sink's leaking, tell them", "what's up with the sink?", "did the landlord email about the inspection?", "ask them to move the inspection to Thursday", "what's the notice period in our lease?"],
  },
  abilities: {
    report_issue: "Email the landlord a repair request with your name on it, and follow it",
    send_to_landlord: "Reply to the landlord or email them, asking first when it's about money, dates or the lease",
    work_order_status: "Say where a repair request is and what the landlord last said",
    trust_sender: "Admins: treat a sender as the landlord from now on",
    send_intro: "Send the landlord a one-time intro email from everyone",
    ask_lease: "Answer a question from the lease Roomie has on file",
    inbox_status: "Say the group's email address and how to connect it",
    release_inbox: "Admins: give up the group's email address",
  },
  adminOnly: {
    trust_sender: { action: String.raw`\b(?:yes|yep|yeah|yup|trust\w*|landlord|building|leasing office|that'?s (?:them|ours|us))\b`, ask: `Treat that sender as the landlord from now on?` },
    release_inbox: { action: String.raw`\b(?:release|delete|close|shut\b.*\bdown|get rid|give up)\b`, ask: `Give up the group's email address? Mail sent to it will bounce from then on.` },
    send_intro: { action: String.raw`\b(?:intro\w*|introduce|send it)\b`, ask: `Send the landlord the intro email from all of you?` },
  },
  // Money, the landlord, then the house (ADR 0017).
  postOrder: 20,
  dashboard: {
    nav: { label: "Inbox", href: (g) => `/g/${g}/inbox`, icon: "Inbox", order: 35 },
    pages: ["inbox"],
  },
});
