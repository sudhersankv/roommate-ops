// "Knows you": what Roomie remembers about a Member (Member note facts). Your own note, or an Admin for anyone;
// "roomie forget me" (forget_me) wipes it.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { members } from "@/services";
import { ctxOf, memberIdByName } from "../util";

export const peopleTools = {
  remember: createTool({
    id: "remember",
    description:
      "The sender tells you something lasting about themselves ('remember I'm vegetarian', 'call me May', 'I'm allergic to peanuts', 'my birthday is March 3', 'I care about the plant'). Saves it to their Member note. Only for the sender. Pass only what they said; an empty string clears that fact.",
    inputSchema: z.object({
      preferredName: z.string().optional().describe("What they want to be called"),
      diet: z.string().optional().describe("e.g. vegetarian, vegan, halal, no pork"),
      allergies: z.string().optional(),
      timezone: z.string().optional().describe("IANA name if you can tell, else as said"),
      caresAbout: z.string().optional().describe("One thing they care about (kept: the newest 3)"),
      birthday: z.string().optional().describe("As said, e.g. 'March 3'"),
      other: z.string().optional().describe("Anything else lasting, one short phrase"),
    }),
    execute: async (input, context) => {
      const note = await members.rememberAboutMe(ctxOf(context), input);
      return { remembered: members.describeFacts({ ...note, handles: undefined }) };
    },
  }),
  what_do_you_know_about_me: createTool({
    id: "what_do_you_know_about_me",
    description:
      "'What do you know about me?': the sender's own Member note. `who` (another member) works only for an admin; for anyone else it refuses. Say it back briefly, and mention 'roomie forget me' wipes it.",
    inputSchema: z.object({ who: z.string().optional().describe("Another member's name (admins only)") }),
    execute: async ({ who }, context) => {
      const ctx = ctxOf(context);
      const memberId = who ? await memberIdByName(ctx, who, { includePending: true }) : undefined;
      const known = await members.knownAbout(ctx, { memberId });
      const { memberLineInMemory } = await import("@/mastra/forget");
      const line = await memberLineInMemory(ctx.groupId, known.name).catch(() => null);
      return { name: known.name, facts: known.summary || "nothing yet", ...(line ? { alsoInMemory: line } : {}), forget: "Say 'roomie forget me' to wipe it." };
    },
  }),
};
