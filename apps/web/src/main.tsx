import "./styles.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { persister, queryClient } from "./lib/query";
import { BriefPage } from "./pages/BriefPage";
import { AlertsPage } from "./pages/AlertsPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { ResearchPage } from "./pages/ResearchPage";
import { ListPage, NotFound } from "./pages/TabPages";
import { Skeleton } from "./pages/parts";
import { Shell } from "./shell/Shell";

// The company page (charts, guidance, research steps) loads when first opened, keeping the first screen light.
const CompanyPage = lazy(() => import("./pages/CompanyPage").then((m) => ({ default: m.CompanyPage })));
const companyPage = (
  <Suspense fallback={<Skeleton hero rows={3} />}>
    <CompanyPage />
  </Suspense>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/brief" replace /> },
      { path: "brief", element: <BriefPage /> },
      { path: "alerts", element: <AlertsPage /> },
      { path: "portfolio", element: <PortfolioPage /> },
      { path: "research", element: <ResearchPage /> },
      { path: "c/:symbol/:tab?", element: companyPage },
      { path: "list/:kind", element: <ListPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

const app = <RouterProvider router={router} />;

createRoot(root).render(
  <StrictMode>
    {persister ? (
      // Offline fallback: the last successful responses are restored from local storage.
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 24 * 3600_000, buster: "v2" }}>
        {app}
      </PersistQueryClientProvider>
    ) : (
      <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
    )}
  </StrictMode>,
);
