// P3 · Home = the Group Report as cards.
import { dashboardCtx } from "@/lib/dashboard";
import { groupReport } from "@/services/report";
import { dollars } from "@/services/types";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default async function Home() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const r = await groupReport(ctx);
  return (
    <main data-accent="red">
      <PageHead title="Home" quip="The group at a glance." emoji={r.chores.some((c) => c.overdue) ? "😬" : "😌"} />
      <div className="grid">
        <section className="card">
          <h2>💸 Who pays whom</h2>
          {r.settlePlan.length ? (
            <ul className="list">
              {r.settlePlan.map((t, i) => (
                <li key={i}><b>{t.fromName}</b><span className="muted">pays</span><b>{t.toName}</b><span className="spacer" /><span className="stat" style={{ fontSize: 18 }}>{dollars(t.cents)}</span></li>
              ))}
            </ul>
          ) : <Empty title="All square." className="socks">Nobody owes anybody. Love that for us.</Empty>}
        </section>

        <section className="card">
          <h2>🧹 Chores</h2>
          {r.chores.length ? (
            <ul className="list">
              {r.chores.map((c) => (
                <li key={c.choreId}>
                  <span>{c.name}</span>
                  <small className="muted">every {c.everyDays}d</small>
                  <span className="spacer" />
                  {c.whoseTurn && <small>{c.whoseTurn}&apos;s turn</small>}
                  <span className={`pill ${c.overdue ? "red overdue" : "green"}`}>{c.overdue ? "Overdue" : "On track"}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No chores yet.">Somebody has to take out the trash. Add a chore to get the chart going.</Empty>}
        </section>

        <section className="card">
          <h2>🏆 Hall of Shame · fewest chores first</h2>
          {r.shame.length ? (
            <ul className="list">
              {r.shame.map((s, i) => (
                <li key={s.memberId} className={i === 0 ? "wanted" : undefined}>
                  <span>{i === 0 ? "🐢" : "·"}</span><b>{s.name}</b><span className="spacer" />
                  <small>{s.choresThisWeek} this week · {s.daysSinceLastChore == null ? "never" : `${s.daysSinceLastChore}d ago`}</small>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nobody to shame.">Yet.</Empty>}
        </section>

        <section className="card">
          <h2>⏰ Coming up</h2>
          {r.upcoming.length ? (
            <ul className="list">
              {r.upcoming.map((u) => (
                <li key={u.id}><span>{u.text}</span><span className="spacer" /><small>{day(u.dueAt)}</small></li>
              ))}
            </ul>
          ) : <Empty title="Nothing scheduled.">Enjoy the quiet.</Empty>}
        </section>

        {r.upkeep.length > 0 && (
          <section className="card">
            <h2>🔧 Upkeep due</h2>
            <ul className="list">
              {r.upkeep.map((m) => (
                <li key={m.id}><span>{m.item}</span><span className="spacer" /><small>{m.nextDue ? day(m.nextDue) : "now"}</small></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
