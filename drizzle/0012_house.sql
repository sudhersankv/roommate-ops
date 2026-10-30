-- Chores and Upkeep merge into House (ADR 0015): one group_toolkits row per Group for "house", on when either was on
-- (a missing row counted as on, its default), settings merged (the chores row's nudgeHour carried over), then the
-- old rows go. Idempotent: a second run finds no chores / upkeep rows and changes nothing. The chores, chore_logs and
-- maintenance tables, Activity and scheduled_posts are untouched.
WITH old AS (
  SELECT
    t.group_id,
    coalesce(bool_or(t.enabled) FILTER (WHERE t.toolkit = 'chores'), true) AS chores_on,
    coalesce(bool_or(t.enabled) FILTER (WHERE t.toolkit = 'upkeep'), true) AS upkeep_on,
    coalesce((SELECT u.settings FROM "group_toolkits" u WHERE u.group_id = t.group_id AND u.toolkit = 'upkeep'), '{}'::jsonb)
      || coalesce((SELECT c.settings FROM "group_toolkits" c WHERE c.group_id = t.group_id AND c.toolkit = 'chores'), '{}'::jsonb) AS settings
  FROM "group_toolkits" t
  WHERE t.toolkit IN ('chores', 'upkeep')
  GROUP BY t.group_id
)
INSERT INTO "group_toolkits" ("group_id", "toolkit", "enabled", "settings")
SELECT group_id, 'house', chores_on OR upkeep_on, settings FROM old
ON CONFLICT ("group_id", "toolkit") DO UPDATE
  SET "enabled" = "group_toolkits"."enabled" OR excluded."enabled",
      "settings" = excluded."settings" || "group_toolkits"."settings";--> statement-breakpoint
DELETE FROM "group_toolkits" WHERE "toolkit" IN ('chores', 'upkeep');
