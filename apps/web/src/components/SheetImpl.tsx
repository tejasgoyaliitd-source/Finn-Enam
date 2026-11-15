import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";

/**
 * Bottom sheet (Vaul): detail over the page instead of growing it. Swipe down, the handle,
 * Escape, the scrim or the close button dismiss it. Focus is trapped while open and returns to
 * whatever opened it. At most ~85% of the screen, so the page behind stays in view.
 */
export default function SheetImpl({
  title,
  subtitle,
  onClose,
  children,
  footer,
  tall = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Item sheets take the full 85% so the content doesn't jump as it loads. */
  tall?: boolean;
}) {
  return (
    <Drawer.Root open onOpenChange={(open) => !open && onClose()} shouldScaleBackground={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-ink/25" />
        <Drawer.Content
          className={`fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[640px] flex-col rounded-t-sheet border border-b-0 border-rule bg-sheet shadow-float outline-none ${tall ? "h-[85dvh]" : "max-h-[85dvh]"}`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-describedby={undefined}
        >
          <Drawer.Handle className="!mt-2 !mb-0 !h-1 !w-10 !bg-rule" />
          <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-1 sm:px-6">
            <div className="min-w-0 pt-2">
              <Drawer.Title className="text-section font-semibold text-ink">{title}</Drawer.Title>
              {subtitle && <p className="text-caption text-ink-3">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="press -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-btn text-ink-2 hover:bg-ledger hover:text-ink">
              <X size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-rule px-4 pb-6 pt-4 sm:px-6">
            {children}
          </div>
          {footer && <div className="border-t border-rule px-4 py-3 sm:px-6">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
