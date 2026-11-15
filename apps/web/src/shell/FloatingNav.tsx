import { Link, useLocation, useNavigate } from "react-router";
import { TABS, type TabId } from "./tabs";

/**
 * The bottom bar: four equal tabs, icon over label, the active one in ink and bold.
 * Fixed: it never hides on scroll. Tapping the active tab returns it to its top and default view.
 */
export function FloatingNav({ active, badges }: { active: TabId | null; badges: Partial<Record<TabId, number>> }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-sheet" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto grid h-16 w-full max-w-[640px] grid-cols-4">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const onTab = location.pathname === tab.path;
          const n = badges[tab.id] ?? 0;
          const Icon = tab.icon;
          return (
            <li key={tab.id} className="flex">
              <Link
                to={tab.path}
                aria-current={isActive ? "page" : undefined}
                onClick={(e) => {
                  if (!onTab) return;
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  if (location.search) navigate(tab.path, { replace: true });
                }}
                className={`press flex min-h-11 w-full flex-col items-center justify-center gap-1 ${isActive ? "text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                <span className="relative">
                  <Icon size={21} strokeWidth={isActive ? 2.1 : 1.6} aria-hidden="true" />
                  {n > 0 && (
                    <span aria-hidden="true" className="absolute -right-3 -top-1.5 min-w-4 rounded-pill bg-missed px-1 text-center text-[10px] font-semibold leading-4 text-white">
                      {n > 99 ? "99+" : n}
                    </span>
                  )}
                </span>
                <span className={`text-nav ${isActive ? "font-semibold" : "font-medium"}`}>{tab.label}</span>
                {n > 0 && <span className="sr-only">, {tab.badgeLabel(n)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
