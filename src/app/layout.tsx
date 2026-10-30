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
  description: "Roomie keeps the receipts: who paid, what you're out of and whose turn it is, kept by the groupmate in your roommate group chat.",
  icons: { icon: "/brand/roomie-icon.svg" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b141a" },
    { media: "(prefers-color-scheme: light)", color: "#f4faf6" },
  ],
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
