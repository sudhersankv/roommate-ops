import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { Fraunces, Inter } from "next/font/google";
import { dashboardCtx } from "@/lib/dashboard";
import { members } from "@/services";
import { NavLinks } from "@/components/nav-links";
import { AskRoomie } from "@/components/ask-roomie";
import "./globals.css";

export const metadata = { title: "Roomie", description: "Your group's groupmate." };
// The layout reads the DB (members), so nothing can be prerendered at build time, not even 404.
export const dynamic = "force-dynamic";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

// One-liner under the wordmark. Picked by the current minute on the server so SSR and hydration agree.
const TAGLINES = [
  "Your group's groupmate.",
  "Splits the bill so you don't have to.",
  "Remembers who bought the milk.",
  "The chore chart doesn't lie.",
  "Exact to the cent.",
] as const;
const tagline = () => TAGLINES[new Date().getMinutes() % TAGLINES.length];

// The dashboard acts as this member (default payer / doer / adder), like the sender in chat.
async function setActor(form: FormData) {
  "use server";
  (await cookies()).set("actor", String(form.get("actor")), { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const ctx = await dashboardCtx();
  const people = ctx ? await members.listMembers(ctx) : [];
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <div className="plaid" />
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand" title="Roomie">
              <b>Roomie</b>
              <small className="tagline">{tagline()}</small>
            </Link>
            <NavLinks />
            {people.length > 0 && (
              <form action={setActor} className="actor">
                <label htmlFor="actor">Acting as</label>
                <select id="actor" name="actor" defaultValue={ctx?.actorId}>
                  {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button className="btn-ghost">Switch</button>
              </form>
            )}
          </header>
          {children}
        </div>
        <AskRoomie actorName={people.find((m) => m.id === ctx?.actorId)?.name} />
      </body>
    </html>
  );
}
