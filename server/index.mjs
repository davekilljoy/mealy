// Mealy — household meal planner web app.
// Hono app: /api/* JSON routes + static frontend from ./web.

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { createMealPlannerStore } from "./store.mjs";
import { createScheduler } from "./scheduler.mjs";
import { createRoutes } from "./routes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const webRoot = path.join(projectRoot, "web");

const PORT = Number(process.env.PORT || 5180);
const HOST = String(process.env.HOST || "0.0.0.0");
const DB_PATH = String(process.env.DB_PATH || path.join(projectRoot, "data", "meal-planner.sqlite"));

// Make sure the DB directory exists (bind-mounts inside Docker default to root-owned empty dirs)
const dbDir = path.dirname(DB_PATH);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const store = createMealPlannerStore({ dbPath: DB_PATH });
const scheduler = createScheduler({ store });
scheduler.start();

const app = new Hono();

app.route("/api", createRoutes({ store, scheduler }));

// Static file serving — vanilla, no framework.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
};

function safeJoin(root, requested) {
  const cleaned = path.posix.normalize("/" + requested.replace(/^\/+/, ""));
  const joined = path.join(root, cleaned);
  if (!joined.startsWith(root)) return null;
  return joined;
}

async function serveStatic(c, requestedPath) {
  let p = requestedPath === "/" ? "/index.html" : requestedPath;
  let filePath = safeJoin(webRoot, p);
  if (!filePath) return c.notFound();
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
      },
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      // SPA fallback — unknown non-asset path renders the shell
      if (!path.extname(p)) {
        try {
          const data = await fs.readFile(path.join(webRoot, "index.html"));
          return new Response(data, { status: 200, headers: { "Content-Type": MIME[".html"] } });
        } catch (_e2) { /* fall through */ }
      }
      return c.notFound();
    }
    throw err;
  }
}

app.get("/", (c) => serveStatic(c, "/"));
app.get("*", (c) => serveStatic(c, new URL(c.req.url).pathname));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[mealy] listening on http://${info.address}:${info.port}`);
  console.log(`[mealy] db: ${DB_PATH}`);
});

function shutdown(sig) {
  console.log(`[mealy] ${sig} — shutting down`);
  scheduler.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
