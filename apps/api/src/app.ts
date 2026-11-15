import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiCtx } from "./ctx";
import { ApiError, fail } from "./http";
import { alertRoutes } from "./routes/alerts";
import { cronRoutes } from "./routes/cron";
import { companyRoutes } from "./routes/company";
import { itemRoutes } from "./routes/items";
import { portfolioRoutes } from "./routes/portfolio";
import { readRoutes } from "./routes/read";
import { researchRoutes } from "./routes/research";
import { utilRoutes } from "./routes/util";

const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

/** Builds the API around a context (live in production, injectable in tests). */
export function createApp(ctx: ApiCtx) {
  const app = new Hono();

  app.use(
    "/v1/*",
    cors({
      origin: (origin) =>
        ctx.env.webOrigins.length === 0 ||
        ctx.env.webOrigins.includes("*") ||
        ctx.env.webOrigins.includes(origin) ||
        (!ctx.env.production && LOCAL.test(origin))
          ? origin
          : null,
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 86400,
    }),
  );

  const v1 = new Hono();
  v1.route("/", readRoutes(ctx));
  v1.route("/", itemRoutes(ctx));
  v1.route("/", companyRoutes(ctx));
  v1.route("/", portfolioRoutes(ctx));
  v1.route("/", alertRoutes(ctx));
  v1.route("/", researchRoutes(ctx));
  v1.route("/", utilRoutes(ctx));
  v1.route("/", cronRoutes(ctx));
  app.route("/v1", v1);
  app.route("/api/v1", v1);
  app.route("/api", v1);

  app.notFound((c) => fail(c, new ApiError(404, "not_found", "No such endpoint.")));
  app.onError((err, c) => {
    if (err instanceof ApiError) return fail(c, err);
    ctx.deps.log.error("unhandled", { path: c.req.path, error: String(err).slice(0, 500) });
    return fail(c, new ApiError(500, "internal", "Something went wrong on our side. It has been logged."));
  });
  return app;
}
