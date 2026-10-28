"use client"

import { useEffect, useSyncExternalStore } from "react"

import { THEME_KEY as KEY } from "./theme-script"

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
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
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

/** Keeps "system" in step when the OS switches between light and dark while the page is open. */
export function ThemeWatcher() {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (read() === "system") apply("system")
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  return null
}
