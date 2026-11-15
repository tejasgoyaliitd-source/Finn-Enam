// Vercel entry: the Hono app as the default export (region bom1, see vercel.json).
import { createApp } from "./app";
import { createCtx } from "./ctx";

export default createApp(createCtx());
