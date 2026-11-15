import { lazy, Suspense, type ComponentProps } from "react";

/**
 * Bottom sheets load their drawer code (Vaul, Radix Dialog) on first use, which keeps the first
 * screen inside the bundle budget. The chunk is fetched once the page goes idle, so the first tap
 * opens without a wait.
 */
const load = () => import("./SheetImpl");
const SheetImpl = lazy(load);

if (typeof window !== "undefined") {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => void load());
}

export function Sheet(props: ComponentProps<typeof SheetImpl>) {
  return (
    <Suspense fallback={null}>
      <SheetImpl {...props} />
    </Suspense>
  );
}
