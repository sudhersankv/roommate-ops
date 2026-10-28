// "Pay with Venmo / PayPal / Cash App" links, prefilled with the amount (client-safe; settle_up and the settle drawer
// both use it). Links go to the person being paid. PayPal.me only takes usernames, so an email handle gets PayPal's
// plain send page instead.
import type { PaymentApp } from "@/db/schema";

export const PAYMENT_APP_NAMES: Record<PaymentApp, string> = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App" };

const amountOf = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const bare = (handle: string) => handle.trim().replace(/^[@$]/, "");

export function payLink(app: PaymentApp, handle: string, cents: number, note = ""): string {
  const amount = amountOf(cents);
  const h = encodeURIComponent(bare(handle));
  if (app === "venmo") return `https://venmo.com/u/${h}?txn=pay&amount=${amount}${note ? `&note=${encodeURIComponent(note)}` : ""}`;
  if (app === "cashapp") return `https://cash.app/$${h}/${amount}`;
  return handle.includes("@") && !handle.startsWith("@") ? "https://www.paypal.com/myaccount/transfer/homepage/pay" : `https://paypal.me/${h}/${amount}`;
}

/** The Venmo app's own scheme (phones open it directly); chat buttons use the https link. */
export function venmoAppLink(handle: string, cents: number, note = ""): string {
  return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(bare(handle))}&amount=${amountOf(cents)}${note ? `&note=${encodeURIComponent(note)}` : ""}`;
}

/** One button per handle the recipient has saved, in a fixed order. */
export function payLinks(handles: Partial<Record<PaymentApp, string>>, cents: number, opts: { to: string; note?: string }): { text: string; url: string }[] {
  return (["venmo", "cashapp", "paypal"] as PaymentApp[])
    .filter((app) => handles[app]?.trim())
    .map((app) => ({ text: `Pay ${opts.to} on ${PAYMENT_APP_NAMES[app]}`, url: payLink(app, handles[app]!, cents, opts.note) }));
}
