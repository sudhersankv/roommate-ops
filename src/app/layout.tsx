import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import { Figtree } from "next/font/google"

import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeWatcher } from "@/components/app/theme"
import { themeScript } from "@/components/app/theme-script"
import "./globals.css"

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-figtree",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "Roomie", template: "%s | Roomie" },
  description: "Your group's money, groceries and chores, kept by the groupmate in your WhatsApp chat.",
  icons: { icon: "/brand/roomie-icon.svg" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The public site is dark in every browser (theme-script.ts); the dashboard's own layout follows the preference.
  themeColor: "#0b141a",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeWatcher />
        <TooltipProvider>
          <Toaster>{children}</Toaster>
        </TooltipProvider>
      </body>
    </html>
  )
}
