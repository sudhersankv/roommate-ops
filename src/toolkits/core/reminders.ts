import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { REMINDER_REPEATS } from "@/db/schema";
import { parseInZone } from "@/lib/time";
import { reminders, schedule } from "@/services";
import { ctxOf, memberIdByName } from "../util";

const ME = /^(me|myself|i|mine)$/i;

export const reminderTools = {
  set_reminder: createTool({
    id: "set_reminder",
    description:
      "Set a reminder. For the whole group, omit who ('remind everyone trash goes out Tuesday 8pm': posted in the chat). For one person, who = their name or 'me' ('remind me to pay rent on the 1st': sent to them privately). dueAt is the local wall-clock time in the Group's time zone WITHOUT an offset, e.g. 2026-11-03T20:00; work out the date from the local 'Now' in your instructions. repeat for daily / weekly / monthly.",
    inputSchema: z.object({
      text: z.string().min(1).describe("What to say when it fires, short, e.g. 'Trash goes out'"),
      dueAt: z.string().describe("Local wall-clock 'YYYY-MM-DDTHH:mm' in the Group's time zone (an ISO time with an offset also works)"),
      who: z.string().optional().describe("Member name, or 'me' for the sender; omit for everyone"),
      repeat: z.enum(REMINDER_REPEATS).optional().describe("Repeat daily, weekly or monthly"),
    }),
    execute: async ({ text, dueAt, who, repeat }, context) => {
      const ctx = ctxOf(context);
      const tz = await schedule.groupTimezone(ctx.groupId);
      const memberId = who ? (ME.test(who.trim()) ? ctx.memberId : await memberIdByName(ctx, who)) : undefined;
      const r = await reminders.setReminder(ctx, { text, dueAt: parseInZone(dueAt, tz), memberId, recurring: repeat ?? null });
      return { id: r.id, text: r.text, when: r.when, for: r.memberName ?? "everyone", private: !!r.memberId, repeat: r.recurring };
    },
  }),
  list_reminders: createTool({
    id: "list_reminders",
    description: "Upcoming reminders the sender can see (the group's, theirs and the ones they set), soonest first, with ids.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const tz = await schedule.groupTimezone(ctx.groupId);
      const list = await reminders.listReminders(ctx, { viewerId: ctx.memberId });
      return list.map((r) => ({ id: r.id, text: r.text, when: reminders.whenLabel(r, tz), for: r.memberName ?? "everyone", setBy: r.createdByName }));
    },
  }),
  cancel_reminder: createTool({
    id: "cancel_reminder",
    description: "Cancel an upcoming reminder by id (from list_reminders) or by a few words of its text.",
    inputSchema: z.object({
      reminderId: z.string().optional(),
      text: z.string().optional().describe("Words from the reminder text, case-insensitive"),
    }),
    execute: async ({ reminderId, text }, context) => {
      const ctx = ctxOf(context);
      const upcoming = await reminders.listReminders(ctx, { viewerId: ctx.memberId });
      const q = text?.trim().toLowerCase();
      const hit = upcoming.find((r) => (reminderId && r.id === reminderId) || (q && r.text.toLowerCase().includes(q)));
      if (!hit) {
        throw new Error(
          upcoming.length
            ? `No upcoming reminder matches that. Upcoming: ${upcoming.map((r) => `"${r.text}"`).join(", ")}`
            : "There are no upcoming reminders to cancel.",
        );
      }
      const res = await reminders.cancelReminder(ctx, { reminderId: hit.id });
      return { ...res, id: hit.id };
    },
  }),
};
