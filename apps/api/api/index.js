// Vercel function entry. `pnpm build` (tsup) bundles src/index.ts and the workspace packages into
// dist/index.js; this file only hands each request to that bundle. Every path is rewritten here
// by vercel.json, so the Hono app sees the original URL (/v1/...).
import app from "../dist/index.js";

const handler = (request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
