// Links and marks shared by the landing page and /help.
import { appUrl, isAbsoluteUrl } from "@/lib/urls"

export const PUBLIC_URL_FALLBACK = "https://tryroomie.me"

/** Telegram's "add to group" link: opens the group picker for the bot (t.me/<bot>?startgroup=<param>). */
export const telegramAddUrl = (username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "imroomiebot") =>
  `https://t.me/${username}?startgroup=true`

/** The page's public address for sharing: APP_URL when it's absolute, else the production one. */
export const publicUrl = () => (isAbsoluteUrl(appUrl()) ? appUrl() : PUBLIC_URL_FALLBACK)

/** What a share says, from the person sending it to their apartment's chat (ADR 0015). */
export const SHARE_TEXT = "Adding this to our apartment chat. It remembers who paid 🦖"

export const shareLinks = (url = publicUrl(), text = SHARE_TEXT) => ({
  url,
  telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
})

export const linkClass = "underline decoration-2 underline-offset-4 decoration-primary hover:decoration-foreground"

export function TelegramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden data-icon="inline-start" fill="currentColor">
      <path d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.78.84l-4.93-3.63-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.02 9.14-8.26c.4-.35-.09-.55-.62-.2L6.2 13.2l-4.87-1.52c-1.06-.33-1.08-1.06.22-1.57L20.6 2.77c.88-.33 1.65.2 1.34 1.53Z" />
    </svg>
  )
}

export function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden data-icon="inline-start" fill="currentColor">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.52 14.95L2 22l5.2-1.47A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.09.87.83-3-.2-.31a8.2 8.2 0 1 1 6.94 3.77Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-1.97-1.22 7.4 7.4 0 0 1-1.37-1.7c-.14-.25-.01-.38.11-.5.11-.12.25-.29.37-.44.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.42h-.47a.9.9 0 0 0-.65.3 2.75 2.75 0 0 0-.86 2.05 4.78 4.78 0 0 0 1 2.54 10.9 10.9 0 0 0 4.18 3.69c.58.25 1.04.4 1.4.52.58.18 1.12.16 1.54.1.47-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </svg>
  )
}
