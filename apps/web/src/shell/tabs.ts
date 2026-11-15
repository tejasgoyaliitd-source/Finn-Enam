import { Bell, ChartColumn, FileText, Search, type LucideIcon } from "lucide-react";

export type TabId = "brief" | "alerts" | "portfolio" | "research";

export interface Tab {
  id: TabId;
  path: string;
  label: string;
  icon: LucideIcon;
  /** What a badge count means, read by screen readers ("2 need your attention"). */
  badgeLabel: (n: number) => string;
}

/** Tab names are the same everywhere: nav, guide and writeup. */
export const TABS: Tab[] = [
  { id: "brief", path: "/brief", label: "Feed", icon: FileText, badgeLabel: (n) => `${n} to review` },
  { id: "portfolio", path: "/portfolio", label: "Holdings", icon: ChartColumn, badgeLabel: (n) => `${n}` },
  { id: "alerts", path: "/alerts", label: "Alerts", icon: Bell, badgeLabel: (n) => `${n} new alert${n === 1 ? "" : "s"}` },
  { id: "research", path: "/research", label: "Research", icon: Search, badgeLabel: (n) => `${n}` },
];

export function tabFor(pathname: string): TabId | null {
  return TABS.find((t) => pathname === t.path || pathname.startsWith(`${t.path}/`))?.id ?? null;
}

export const tabById = (id: TabId) => TABS.find((t) => t.id === id)!;
