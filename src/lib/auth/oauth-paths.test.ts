// Where sign-in goes and comes back to. Run: npx tsx --test src/lib/auth/oauth-paths.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { afterSignIn, callbackPathFor, safeNext, signInPath } from "./oauth-paths"

test("safeNext keeps paths on this site, anything else is /signin", () => {
  assert.equal(safeNext("/g/abc?tab=x"), "/g/abc?tab=x")
  for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "g/abc"]) assert.equal(safeNext(bad), "/signin", String(bad))
})

test("afterSignIn never sends you back to /signin", () => {
  assert.equal(afterSignIn("/g/abc"), "/g/abc")
  assert.equal(afterSignIn("/"), "/")
  for (const loop of ["/signin", "/signin?next=%2Fg%2Fx", "https://evil.example", undefined]) assert.equal(afterSignIn(loop), "/", String(loop))
  assert.equal(afterSignIn("/signinx"), "/signinx", "only /signin itself, not a lookalike path")
})

test("signInPath carries `next`, plain /signin for the home page", () => {
  assert.equal(signInPath(), "/signin")
  assert.equal(signInPath("/"), "/signin")
  assert.equal(signInPath("/g/abc/money?tab=expenses"), "/signin?next=%2Fg%2Fabc%2Fmoney%3Ftab%3Dexpenses")
  assert.equal(signInPath("/signin?next=%2Fg%2Fx"), "/signin")
})

test("the Google callback URL wraps the return path", () => {
  assert.equal(callbackPathFor("/signin?next=%2Fg%2Fx"), "/auth/callback?next=%2Fsignin%3Fnext%3D%252Fg%252Fx")
  assert.equal(callbackPathFor("https://evil.example"), "/auth/callback?next=%2Fsignin")
})
