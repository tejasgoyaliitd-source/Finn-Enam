import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ApiRequestError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // matches the API's s-maxage
      gcTime: 24 * 3600_000, // keep yesterday's brief for offline use
      networkMode: "offlineFirst", // show cached data first, then try the network
      refetchOnWindowFocus: true,
      // Don't hammer the API over a 4xx: it won't change on retry.
      retry: (n, err) => !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && n < 2,
    },
  },
});

/** localStorage can throw (private mode, blocked storage): the app works without it. */
function safeStorage(): Storage | undefined {
  try {
    const s = window.localStorage;
    s.setItem("finn-probe", "1");
    s.removeItem("finn-probe");
    return s;
  } catch {
    return undefined;
  }
}

const storage = typeof window === "undefined" ? undefined : safeStorage();

/** Persists successful query results so the last loaded data shows when offline. */
export const persister = storage ? createSyncStoragePersister({ storage, key: "finn-cache-v1", throttleTime: 1000 }) : undefined;

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference just won't persist */
  }
}
