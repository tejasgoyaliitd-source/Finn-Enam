// Local dev server only. Vercel uses src/index.ts.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";

const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { createApp } = await import("./app");
const { createCtx } = await import("./ctx");
// API_PORT, not PORT: tools that start the whole workspace set PORT for the web app.
const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: createApp(createCtx()).fetch, port }, () => {
  console.log(`finn-api on http://localhost:${port}/v1/health`);
});
