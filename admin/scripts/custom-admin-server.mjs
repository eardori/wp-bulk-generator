import { createReadStream, existsSync, readFileSync, statSync } from "fs";
import { join, normalize, extname } from "path";
import { createServer } from "http";
import { Readable } from "stream";
import { createRequire } from "module";
import { execFileSync } from "child_process";

const require = createRequire(import.meta.url);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const APP_DIR = process.cwd();
const NEXT_DIR = join(APP_DIR, ".next");
const STATIC_DIR = join(NEXT_DIR, "static");
const APP_HTML_DIR = join(NEXT_DIR, "server", "app");
const CACHE_DIR = join(APP_DIR, ".cache");
const CREDS_CACHE = join(CACHE_DIR, "sites-credentials.json");
const CONFIG_CACHE = join(CACHE_DIR, "sites-config.json");
const GROUPS_CACHE = join(CACHE_DIR, "site-groups.json");

const PAGE_FILES = {
  "/": "index.html",
  "/content": "content.html",
  "/dashboard": "dashboard.html",
  "/groups": "groups.html",
};

const API_ROUTE_FILES = {
  "/api/content/fetch-reviews": "content/fetch-reviews",
  "/api/content/fetch-sites": "content/fetch-sites",
  "/api/content/generate-articles": "content/generate-articles",
  "/api/content/publish-articles": "content/publish-articles",
  "/api/content/scrape-product": "content/scrape-product",
  "/api/content/site-groups": "content/site-groups",
  "/api/dashboard": "dashboard",
  "/api/deploy-sites": "deploy-sites",
  "/api/generate-configs": "generate-configs",
  "/api/server-status": "server-status",
};

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const routeModuleCache = new Map();

function readJsonArray(path) {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    // ignore cache parse failures
  }
  return [];
}

function normalizeSiteUrl(site) {
  const raw = site.url || `http://${site.domain}`;
  if (site.domain?.endsWith(".allmyreview.site")) {
    return raw.replace(/^http:\/\//, "https://");
  }
  return raw;
}

function loadSitesFromCache() {
  const creds = readJsonArray(CREDS_CACHE);
  const configs = readJsonArray(CONFIG_CACHE);
  const configMap = new Map();

  for (const cfg of configs) {
    if (cfg?.site_slug) {
      configMap.set(cfg.site_slug, cfg);
    }
  }

  return creds.map((site) => {
    const cfg = configMap.get(site.slug) || {};
    return {
      slug: site.slug,
      domain: site.domain,
      title: site.title,
      url: normalizeSiteUrl(site),
      site_dir: site.site_dir,
      admin_user: site.admin_user,
      admin_pass: site.admin_pass,
      app_pass: site.app_pass,
      db_name: site.db_name,
      db_user: site.db_user,
      db_pass: site.db_pass,
      persona: cfg.persona || {
        name: site.title,
        age: 30,
        concern: "",
        expertise: "",
        tone: "전문적이고 친근한",
        bio: "",
      },
    };
  });
}

function loadGroupsFromCache() {
  return readJsonArray(GROUPS_CACHE);
}

async function fetchWpPostBundle(site, perPage = 15) {
  try {
    const sql = [
      "SELECT COUNT(*) FROM wp_posts WHERE post_type='post' AND post_status='publish';",
      `SELECT ID, post_title, guid, post_date FROM wp_posts WHERE post_type='post' AND post_status='publish' ORDER BY post_date DESC LIMIT ${perPage};`,
    ].join(" ");

    const stdout = execFileSync(
      "mysql",
      [
        "--protocol=TCP",
        "-h",
        site.db_host || "127.0.0.1",
        `-u${site.db_user}`,
        `-p${site.db_pass}`,
        "-D",
        site.db_name,
        "--default-character-set=utf8mb4",
        "--batch",
        "--skip-column-names",
        "-e",
        sql,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      }
    );

    const lines = stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

    if (lines.length === 0) {
      return { posts: [], totalCount: 0, error: true };
    }

    const totalCount = Number.parseInt(lines[0], 10);
    const posts = lines.slice(1).map((line) => {
      const [id, title, link, date] = line.split("\t");
      return {
        id: Number.parseInt(id, 10),
        title: { rendered: title || "" },
        link: link || site.url,
        date: date ? date.replace(" ", "T") : "",
        status: "publish",
      };
    });

    return {
      posts,
      totalCount: Number.isFinite(totalCount) ? totalCount : 0,
      error: false,
    };
  } catch (error) {
    console.error(
      `[dashboard] failed to load posts for ${site.slug}: ${
        error instanceof Error
          ? [
              error.message,
              error.stderr?.toString?.(),
              error.stdout?.toString?.(),
            ]
              .filter(Boolean)
              .join(" :: ")
          : String(error)
      }`
    );
    return { posts: [], totalCount: 0, error: true };
  }
}

function getContentType(pathname) {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] || "application/octet-stream";
}

function safeJoin(baseDir, targetPath) {
  const normalized = normalize(targetPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = join(baseDir, normalized);
  if (!fullPath.startsWith(baseDir)) {
    return null;
  }
  return fullPath;
}

function getStaticFile(pathname) {
  if (!pathname.startsWith("/_next/static/")) return null;
  const relative = pathname.slice("/_next/static/".length);
  return safeJoin(STATIC_DIR, relative);
}

function getPageFile(pathname) {
  const pageFile = PAGE_FILES[pathname];
  if (!pageFile) return null;
  return join(APP_HTML_DIR, pageFile);
}

function getApiUserland(pathname) {
  if (routeModuleCache.has(pathname)) {
    return routeModuleCache.get(pathname);
  }

  const routeId = API_ROUTE_FILES[pathname];
  if (!routeId) return null;

  const mod = require(join(NEXT_DIR, "server", "app", "api", routeId, "route.js"));
  const userland = mod?.routeModule?.userland;
  if (!userland) {
    throw new Error(`Missing compiled userland for ${pathname}`);
  }

  routeModuleCache.set(pathname, userland);
  return userland;
}

async function warmApiRoute(pathname) {
  try {
    const userland = getApiUserland(pathname);
    if (userland && typeof userland.__warmup === "function") {
      await userland.__warmup();
    }
  } catch (error) {
    console.error(
      `[startup] failed to warm ${pathname}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function sendMethodNotAllowed(res) {
  res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function pipeWebResponse(nodeRes, webRes) {
  const headers = {};
  for (const [key, value] of webRes.headers.entries()) {
    headers[key] = value;
  }

  nodeRes.writeHead(webRes.status, headers);

  if (!webRes.body) {
    nodeRes.end();
    return;
  }

  await new Promise((resolve, reject) => {
    Readable.fromWeb(webRes.body).pipe(nodeRes);
    nodeRes.on("finish", resolve);
    nodeRes.on("error", reject);
  });
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/content/fetch-sites" && (req.method || "GET") === "GET") {
      sendJson(res, 200, { sites: loadSitesFromCache() });
      return;
    }

    if (pathname === "/api/content/site-groups") {
      if ((req.method || "GET") === "GET") {
        sendJson(res, 200, { groups: loadGroupsFromCache() });
        return;
      }
    }

    if (pathname === "/api/dashboard" && (req.method || "GET") === "GET") {
      const sites = loadSitesFromCache();
      const groups = loadGroupsFromCache();
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "meta", sites, groups })}\n\n`);

      const batchSize = 8;
      for (let i = 0; i < sites.length; i += batchSize) {
        const batch = sites.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (site) => ({
            slug: site.slug,
            ...(await fetchWpPostBundle(site)),
          }))
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            res.write(
              `data: ${JSON.stringify({
                type: "posts",
                slug: result.value.slug,
                posts: result.value.posts,
                totalCount: result.value.totalCount,
                error: result.value.error,
              })}\n\n`
            );
            continue;
          }

          const slug = batch[results.indexOf(result)]?.slug;
          if (!slug) continue;
          res.write(
            `data: ${JSON.stringify({
              type: "posts",
              slug,
              posts: [],
              totalCount: 0,
              error: true,
            })}\n\n`
          );
        }
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    const userland = getApiUserland(pathname);
    if (!userland) {
      sendNotFound(res);
      return;
    }

    const method = req.method || "GET";
    const handler = userland[method] || (method === "HEAD" ? userland.GET : undefined);
    if (!handler) {
      sendMethodNotAllowed(res);
      return;
    }

    const url = `http://${req.headers.host || `127.0.0.1:${PORT}`}${req.url || pathname}`;
    const init = {
      method,
      headers: req.headers,
    };

    if (!["GET", "HEAD"].includes(method)) {
      init.body = await readBody(req);
      init.duplex = "half";
    }

    const request = new Request(url, init);
    const response = await handler(request);
    await pipeWebResponse(res, response);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      })
    );
  }
}

function handleStaticFile(res, filePath) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendNotFound(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": getContentType(filePath),
    "Cache-Control": filePath.includes("/_next/static/") ? "public, max-age=31536000, immutable" : "no-store",
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }

  const staticFile = getStaticFile(pathname);
  if (staticFile) {
    handleStaticFile(res, staticFile);
    return;
  }

  if (pathname.endsWith("/") && pathname !== "/") {
    res.writeHead(302, { Location: pathname.slice(0, -1) });
    res.end();
    return;
  }

  const pageFile = getPageFile(pathname);
  if (pageFile) {
    handleStaticFile(res, pageFile);
    return;
  }

  sendNotFound(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Custom admin server listening on http://${HOST}:${PORT}`);
  void warmApiRoute("/api/content/scrape-product");
});
