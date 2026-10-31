"use client"

import { usePathname } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { THEME_KEY as KEY, THEMED_PATHS } from "./theme-script"

export type ThemePreference = "system" | "light" | "dark"

const EVENT = "roomie-theme-change"

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

function apply(pref: ThemePreference) {
  const dark = !THEMED_PATHS.test(location.pathname) || pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}

export function useThemePreference() {
  const pref = useSyncExternalStore(subscribe, read, () => "system" as const)
  const setPref = (next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {}
    apply(next)
    window.dispatchEvent(new Event(EVENT))
  }
  return [pref, setPref] as const
}

/**
 * Keeps "system" in step when the OS switches between light and dark while the page is open, and re-applies the
 * theme on a client navigation between the always-dark public site and the dashboard.
 */
export function ThemeWatcher() {
  const path = usePathname()
  useEffect(() => apply(read()), [path])
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      apply(read())
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  return null
}
