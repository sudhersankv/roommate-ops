// npm run db:migrate: apply drizzle/*.sql in order (tracked in drizzle.__drizzle_migrations).
// The 0000 baseline drops the pre-step-4 tables, so running it on an old dev database wipes its app data.
import "../src/lib/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const db = drizzle(process.env.DATABASE_URL!);
await migrate(db, { migrationsFolder: "drizzle" });
console.log("migrations applied");
await db.$client.end();
