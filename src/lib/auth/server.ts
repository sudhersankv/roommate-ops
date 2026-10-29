// Neon Auth (Managed Better Auth) on the server: the /api/auth proxy, proxy.ts route protection and getSession().
// Users live in the neon_auth schema; our accounts table mirrors them by id (services/claims.ts).
import { createNeonAuth } from "@neondatabase/auth/next/server";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    // The SDK defaults to `strict`, which drops the OAuth challenge cookie on the cross-site return from Google, so
    // the verifier is never exchanged and sign-in silently loops. `lax` still blocks cross-site POSTs.
    sameSite: "lax",
  },

});
