import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { members } from "@/services";
import { ctxOf } from "../util";

export const memberTools = {
  list_members: createTool({
    id: "list_members",
    description: "List the members of this group.",
    inputSchema: z.object({}),
    execute: async (_input, context) => (await members.listMembers(ctxOf(context))).map((m) => m.name),
  }),
};
