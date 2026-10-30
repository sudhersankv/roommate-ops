// Local scripts must not touch production by accident (audit B1).
//   - The Telegram bot: polling deletes its webhook, and the webhook script moves it. getMe tells which bot the token
//     is; the production bot (@imroomiebot) needs ALLOW_PROD_BOT=1 to poll, lose its webhook or point it elsewhere.
//   - The database: seed, dev-chat, evals and test:tools write throwaway Groups. They refuse on the production Neon
//     branch (prod's DATABASE_URL lives only in `fly secrets`; .env points at the `dev` branch).
import { sql } from "drizzle-orm";

export const PROD_APP_URL = "https://roomie.fly.dev";
/** The production Telegram bot. */
export const PROD_BOT_USERNAME = "imroomiebot";
/** Neon project `roomie`, branch `production`. */
export const PROD_BRANCH_ID = "br-dawn-darkness-b48156vf";

const norm = (u: string | undefined) => (u ?? "").trim().replace(/\/+$/, "").toLowerCase();

export const isProdAppUrl = (url: string | undefined) => norm(url) === PROD_APP_URL;

export const prodBotAllowed = () => process.env.ALLOW_PROD_BOT === "1";

/** Whether the token is the production bot (asks Telegram: getMe, read-only). */
export async function isProdBot(api: { getMe: () => Promise<{ username?: string }> }): Promise<boolean> {
  const me = await api.getMe();
  return (me.username ?? "").toLowerCase() === PROD_BOT_USERNAME;
}

/** Exits with a clear message. */
export function refuseProdBot(why: string): never {
  console.error(
    `Refusing: ${why}\nThat would take Roomie away from every real group on ${PROD_APP_URL}. Use a separate dev bot (its own TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME), or set ALLOW_PROD_BOT=1 if you really mean to.`,
  );
  process.exit(1);
}

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

/** The Neon branch DATABASE_URL points at (null when it isn't Neon). */
export async function neonBranch(db: Executor): Promise<string | null> {
  const { rows } = await db.execute(sql`select current_setting('neon.branch_id', true) as branch`);
  return (rows[0] as { branch: string | null } | undefined)?.branch || null;
}

/** Throws when DATABASE_URL is the production branch. */
export async function assertNotProdDb(db: Executor, what: string): Promise<void> {
  if ((await neonBranch(db)) === PROD_BRANCH_ID) {
    throw new Error(`Refusing to run ${what}: DATABASE_URL is the production Neon branch. Point .env at the dev branch (CLAUDE.md, "Commands").`);
  }
}
