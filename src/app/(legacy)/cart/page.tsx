// P2 · Shared grocery cart: items grouped by who added them, price estimates from the catalog, and "Mark purchased"
// right here (Instacart checkout comes later). Reads services, writes via server actions.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { cart, members } from "@/services";
import { dollars } from "@/services/types";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const toCents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").trim()) * 100);

async function addItem(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  await cart.addItems(ctx, {
    items: [{ name, qty: String(form.get("qty") ?? "").trim() || undefined }],
    shared: form.get("shared") === "on",
  });
  revalidatePath("/", "layout");
}

async function removeItem(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  // By id, not name: the chat tool's fuzzy name match would let one person's "milk" delete another's "oat milk".
  await cart.removeItemById(ctx, { id: String(form.get("id") ?? "") });
  revalidatePath("/", "layout");
}

async function markPurchased(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await cart.markPurchased(ctx, {
    totalCents: toCents(form.get("total")),
    payerId: String(form.get("payerId") || ctx.actorId),
  });
  revalidatePath("/", "layout");
}

export default async function CartPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [groups, people] = await Promise.all([cart.viewCart(ctx), members.listMembers(ctx)]);
  const all = Object.values(groups).flat();
  const total = cart.cartTotal(all);
  const groupNames = Object.keys(groups);

  return (
    <main data-accent="gold">
      <PageHead title="Grocery cart" quip="Everything the group needs." emoji="🛒" />
      <div className="grid">
        {all.length === 0 ? (
          <section className="card">
            <Empty title="The cart is empty.">Say &apos;roomie, add milk&apos; or add something here.</Empty>
          </section>
        ) : (
          groupNames.map((group) => (
            <section className="card" key={group}>
              <h2>
                {group === "Shared" ? "🏠 Shared (whole group)" : `🛒 ${group}'s items`}
                <span className="pill">{groups[group].length}</span>
              </h2>
              <ul className="list">
                {groups[group].map((i) => (
                  <li key={i.id}>
                    <div style={{ flex: 1 }}>
                      <b>{i.name}</b> <span className="muted">x {i.qty}</span>
                    </div>
                    <span className="num">{i.estCents != null ? dollars(i.estCents) : "—"}</span>
                    <form action={removeItem}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="btn-danger">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Subtotal {dollars(cart.cartTotal(groups[group]))}
                {group === "Shared" && people.length > 0 && <> · split {people.length} ways</>}
              </p>
            </section>
          ))
        )}

        <section className="card">
          <h2>➕ Add to cart</h2>
          <form action={addItem} className="stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">Item</label>
                <input id="name" name="name" placeholder="oat milk, paper towels" required />
              </div>
              <div className="field">
                <label htmlFor="qty">Qty</label>
                <input id="qty" name="qty" placeholder="1, 3 bags, 2 gallons" />
              </div>
            </div>
            <div className="row">
              <label className="row" style={{ gap: 6, fontWeight: 500, color: "inherit" }}>
                <input type="checkbox" name="shared" />
                Shared (whole group splits it)
              </label>
              <span className="spacer" />
              <button>Add</button>
            </div>
            <small className="muted">Prices are estimates from a built-in catalog. Items are added as the person you&apos;re acting as.</small>
          </form>
        </section>

        <section className="card">
          <h2>✨ Summary</h2>
          <ul className="list">
            <li>
              <span>Items</span>
              <span className="spacer" />
              <b>{all.length}</b>
            </li>
            <li>
              <span>Estimated total</span>
              <span className="spacer" />
              <span className="stat" style={{ fontSize: 22 }}>{dollars(total)}</span>
            </li>
          </ul>
          {all.length > 0 ? (
            <div className="stack" style={{ marginTop: 16 }}>
              <form action={markPurchased} className="stack">
                <label>Somebody went to the store? Mark it purchased:</label>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="total">Receipt total ($)</label>
                    <input id="total" name="total" type="number" min="0.01" step="0.01" defaultValue={(total / 100).toFixed(2)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="payerId">Paid by</label>
                    <select id="payerId" name="payerId" defaultValue={ctx.actorId}>
                      {people.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="row">
                  <button className="btn-ghost">Mark purchased</button>
                  <small className="muted">Logs one expense: everyone pays for their own items, shared items split evenly.</small>
                </div>
              </form>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>Mark purchased appears once something is in the cart. Instacart checkout is coming soon.</p>
          )}
        </section>
      </div>
    </main>
  );
}
