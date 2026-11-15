// Vercel entry: the Hono app as the default export (region bom1, see vercel.json).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createApp } from "./app";
import { createCtx } from "./ctx";

const app = new Hono();

// Global CORS so even preflight OPTIONS or startup error responses allow browser calls
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "accept"],
    credentials: true,
    maxAge: 86400,
  }),
);

// Basic liveness checks that succeed without DB/keys
app.get("/", (c) => c.json({ ok: true, name: "FINN API", status: "online", time: new Date().toISOString() }));
app.get("/ping", (c) => c.text("pong"));
app.get("/v1/ping", (c) => c.text("pong"));
app.get("/api/ping", (c) => c.text("pong"));
app.get("/health/live", (c) => c.json({ ok: true, status: "live", time: new Date().toISOString() }));
app.get("/v1/health/live", (c) => c.json({ ok: true, status: "live", time: new Date().toISOString() }));

let appInstance: Hono | null = null;
let startupError: string | null = null;

function getApp(): { app: Hono | null; error: string | null } {
  if (appInstance) return { app: appInstance, error: null };
  try {
    const ctx = createCtx();
    appInstance = createApp(ctx);
    startupError = null;
    return { app: appInstance, error: null };
  } catch (err: any) {
    startupError = err?.message || String(err);
    return { app: null, error: startupError };
  }
}

// Attempt initial creation
getApp();

app.all("*", async (c) => {
  const { app: delegate, error } = getApp();
  if (!delegate) {
    return c.json(
      {
        ok: false,
        error: {
          code: "startup_error",
          message: `Backend initialization failed: ${error}. Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in Vercel Project Settings -> Environment Variables.`,
        },
      },
      500,
    );
  }
  const executionCtx = (() => {
    try {
      return c.executionCtx;
    } catch {
      return undefined;
    }
  })();
  return delegate.fetch(c.req.raw, c.env, executionCtx);
});

export default app;
