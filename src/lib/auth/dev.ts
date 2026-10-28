// Dev-only sign-in bypass: Google OAuth can't be completed by automation, so with NODE_ENV !== "production" and
// DEV_AUTH_EMAIL set, that email counts as the signed-in Account (session.ts, proxy.ts). Never active in production.
export function devAuthEmail(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const email = process.env.DEV_AUTH_EMAIL?.trim();
  return email || null;
}

let warned = false;
export function warnDevAuth(email: string) {
  if (warned) return;
  warned = true;
  console.warn(`\n!!! DEV_AUTH_EMAIL is set: every request is signed in as ${email}. Dev only; unset it to use Google sign-in. !!!\n`);
}
