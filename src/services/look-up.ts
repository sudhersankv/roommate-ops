// Look things up (#78): one question to a web search service, answered in one or two lines with one source. Only
// when someone asked; it never acts on what it finds (no adds, no emails, no reminders). In order:
//   look-up off (no key)          -> says so, nothing counted
//   names one of the group's Members -> refused, nothing sent anywhere, nothing counted
//   over the Group's daily cap    -> says so (lib/caps.ts, 30 a day)
//   "near us" + a saved place     -> the place goes in the question (services/place.ts)
//   the answer                    -> `say` (<= 2 sentences), one source as a button, a pin when it's one place
import { caps } from "@/lib/caps";
import { cleanPin, type Pin } from "@/lib/place";
import { SearchUnavailableError, hostOf, searchAvailability, searchClient } from "@/integrations/search";
import { listGroupMembers } from "./members";
import { getPlace } from "./place";
import { localQuery, memberNamed, shortAnswer, wantsNearUs } from "./look-up-rules";
import type { Ctx } from "./types";

export const LOOK_UP_OFF = "I can't look things up yet.";
export const LOOK_UP_MEMBER = "I don't look up people in the group.";
export const LOOK_UP_CAPPED = "That's all the looking up I can do today. Back tomorrow.";
export const LOOK_UP_NOTHING = "I couldn't find a clear answer to that.";

export type LookUpResult =
  | { refused: "off" | "member" | "capped"; say: string }
  | { unavailable: true; say: string }
  | {
      say: string;
      /** One source, as a button (the pipeline collects `links`). */
      links: { text: string; url: string }[];
      /** One place with coordinates: sent as a pin after the line (Outgoing.location). */
      location?: Pin & { name: string };
      /** "near us" was asked, but the group has no saved place yet. */
      noPlace?: true;
      /** The question used the group's saved place. */
      usedPlace?: true;
    };

export async function lookUp(ctx: Ctx, input: { query: string; nearUs?: boolean }): Promise<LookUpResult> {
  const query = input.query.trim().slice(0, 300);
  if (!searchAvailability().ready) return { refused: "off", say: LOOK_UP_OFF };
  const names = (await listGroupMembers({ groupId: ctx.groupId })).map((m) => m.displayName);
  if (memberNamed(query, names)) return { refused: "member", say: LOOK_UP_MEMBER };
  if (!(await (await caps()).lookUp(ctx.groupId))) return { refused: "capped", say: LOOK_UP_CAPPED };

  const near = !!input.nearUs || wantsNearUs(query);
  const place = near ? await getPlace(ctx) : null;
  let found;
  try {
    found = await searchClient().answer(localQuery(query, place, near));
  } catch (e) {
    if (e instanceof SearchUnavailableError) return { unavailable: true, say: e.message };
    throw e;
  }
  const say = shortAnswer(found.answer) || LOOK_UP_NOTHING;
  const source = found.sources[0];
  const pin = found.place ? cleanPin(found.place) : null;
  return {
    say,
    links: source ? [{ text: `Source: ${hostOf(source.url)}`, url: source.url }] : [],
    ...(pin?.name ? { location: { ...pin, name: pin.name } } : {}),
    ...(near && !place ? { noPlace: true as const } : {}),
    ...(place ? { usedPlace: true as const } : {}),
  };
}
