// P0 · Members + group settings. This page is the reference pattern: server component reads services, server actions write.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { members } from "@/services";
import { NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

async function add(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.addMember(ctx, { name: String(form.get("name")) });
  revalidatePath("/", "layout");
}

async function rename(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.renameMember(ctx, { memberId: String(form.get("id")), name: String(form.get("name")) });
  revalidatePath("/", "layout");
}

async function remove(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.removeMember(ctx, { memberId: String(form.get("id")) });
  revalidatePath("/", "layout");
}

async function saveSettings(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.updateHouseSettings(ctx, { name: String(form.get("name") ?? "").trim() || "Our place" });
  revalidatePath("/members");
}

export default async function MembersPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [people, house] = await Promise.all([members.listMembers(ctx), members.getHousehold(ctx.householdId)]);
  return (
    <main data-accent="gold">
      <PageHead title="Members" quip="Everyone in the group." emoji="👋" />
      <div className="grid">
        <section className="card">
          <h2>👋 Who&apos;s in the group</h2>
          <ul className="list">
            {people.map((m) => (
              <li key={m.id}>
                <form action={rename} className="row" style={{ flex: 1 }}>
                  <input type="hidden" name="id" value={m.id} />
                  <input name="name" defaultValue={m.name} aria-label="Name" style={{ flex: 1 }} />
                  <span className={`pill ${m.channelUserId ? "green" : ""}`}>{m.channelUserId ? "In the chat" : "Not in the chat yet"}</span>
                  <button className="btn-ghost">Save</button>
                  <button formAction={remove} className="btn-danger">Remove</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={add} className="row" style={{ marginTop: 16 }}>
            <input name="name" placeholder="New member" aria-label="New member" required style={{ flex: 1 }} />
            <button>Add</button>
          </form>
        </section>

        <section className="card">
          <h2>✨ Group settings</h2>
          <form action={saveSettings} className="stack">
            <div className="field">
              <label htmlFor="name">Group name</label>
              <input id="name" name="name" defaultValue={house?.name ?? ""} required />
            </div>
            <div><button>Save settings</button></div>
          </form>
        </section>
      </div>
    </main>
  );
}
