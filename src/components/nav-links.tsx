"use client";
// Client only for the active-page highlight.
import Link from "next/link";
import { usePathname } from "next/navigation";

// [href, label, tooltip, emoji, accent]. The emoji shows only on the active tab (CSS ::before), and the accent
// recolours it to match its page.
const NAV = [
  ["/", "Home", "The group at a glance.", "🏠", "red"],
  ["/money", "Money", "Who paid, who owes.", "💸", "green"],
  ["/cart", "Cart", "The shared grocery list.", "🛒", "gold"],
  ["/chores", "Chores", "Whose turn is it?", "🧹", "red"],
  ["/reminders", "Reminders", "Nobody forgets.", "⏰", "ice"],
  ["/upkeep", "Upkeep", "Filters, alarms and the rest.", "🔧", "green"],
  ["/members", "Members", "Who's in the group.", "👋", "gold"],
] as const;

// Sub-pages ("/cart/...") still light up their tab.
const isActive = (href: string, path: string) => path === href || (href !== "/" && path.startsWith(`${href}/`));

export function NavLinks() {
  const path = usePathname();
  const current = NAV.find(([href]) => isActive(href, path));
  return (
    <nav className="nav" data-accent={current?.[4]}>
      {NAV.map(([href, label, tip, emoji]) => (
        <Link key={href} href={href} title={tip} data-emoji={emoji} aria-current={isActive(href, path) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
