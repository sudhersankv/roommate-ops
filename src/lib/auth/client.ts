"use client"

import { createAuthClient } from "@neondatabase/auth/next"

// Talks to our same-origin /api/auth proxy, so it takes no arguments.
export const authClient = createAuthClient()
