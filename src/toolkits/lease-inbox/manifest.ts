import { defineManifest } from "../define";

// The Group's own email address for the landlord (ADR 0016). Off by default: it needs a connection step (forward the
// lease, CC the address, or give it to the leasing office), so Onboarding only offers it (offerLine).
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
  persona: [
    `- Landlord: "the sink's leaking, tell them" (any repair to report) is report_issue with what = the problem in a few words ("the leaking kitchen sink"); it emails the landlord at once. Say its line as it is ("Sent: ...").`,
    `- Answering the landlord ("ask them to move the inspection to Thursday", "tell them Tuesday works") is send_to_landlord with intent reply, about = what the thread is about, and a short, polite body in the Member's words. Never add an amount, a date or a lease term they didn't say.`,
    `- When report_issue or send_to_landlord returns ask, nothing was sent: ask those questions in one message. Only when the Member answers yes, call it again exactly the same way (same body); a changed email gets the questions again. "Tell them we're not renewing" always gets the questions first.`,
    `- "What's up with the sink?" is work_order_status; when it returns choices, ask which one. "Want me to follow up?" answered yes is send_to_landlord with intent reply about that work order.`,
    `- "Is this your building?" (or "is this your landlord?") answered yes is trust_sender with that sender's address or domain.`,
    `- A question about the lease ("what's the notice period?", "are pets allowed?") is ask_lease; answer from what it returns and name the clause.`,
    `- "What's our email address?" or how to connect the landlord is inbox_status: say the address and the three ways (forward the lease or their last email, CC it next time, or give it to the leasing office).`,
  ].join("\n"),
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
    trust_sender: { action: String.raw`\b(?:yes|yep|yeah|yup|trust\w*|landlord|building|leasing office|that'?s (?:them|ours|us))\b`, ask: `Treat that sender as the landlord from now on? Say "roomie, yes trust them".` },
    release_inbox: { action: String.raw`\b(?:release|delete|close|shut\b.*\bdown|get rid|give up)\b`, ask: `Give up the group's email address? Mail sent to it will bounce from then on. Say "roomie, yes release the inbox".` },
    send_intro: { action: String.raw`\b(?:intro\w*|introduce|send it)\b`, ask: `Send the landlord the intro email from all of you? Say "roomie, yes send the intro".` },
  },
  offerLine: `Want me to handle the landlord's emails too? Say "roomie, learn lease inbox".`,
  // Money, the landlord, then the house (ADR 0017).
  postOrder: 20,
  dashboard: {
    nav: { label: "Inbox", href: (g) => `/g/${g}/inbox`, icon: "Inbox", order: 35 },
    pages: ["inbox"],
  },
});
