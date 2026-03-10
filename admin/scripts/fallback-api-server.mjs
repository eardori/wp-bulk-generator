import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_DIR = join(process.cwd(), ".cache");
const CREDS_CACHE = join(CACHE_DIR, "sites-credentials.json");
const CONFIG_CACHE = join(CACHE_DIR, "sites-config.json");
const GROUPS_CACHE = join(CACHE_DIR, "site-groups.json");

function readJsonArray(path) {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    // ignore malformed cache
  }
  return [];
}

function writeJson(path, value) {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function normalizeSiteUrl(site) {
  const raw = site.url || `http://${site.domain}`;
  if (site.domain?.endsWith(".allmyreview.site")) {
    return raw.replace(/^http:\/\//, "https://");
  }
  return raw;
}

function loadSites() {
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
      admin_user: site.admin_user,
      admin_pass: site.admin_pass,
      app_pass: site.app_pass,
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

function loadGroups() {
  return readJsonArray(GROUPS_CACHE);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function handleDashboard(req, res) {
  const sites = loadSites();
  const groups = loadGroups();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Connection: "keep-alive",
  });

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "meta", sites, groups });
  // Avoid hammering every WP site from the admin dashboard fallback.
  // This endpoint only needs enough data to render the dashboard shell.
  for (const site of sites) {
    send({
      type: "posts",
      slug: site.slug,
      posts: [],
      totalCount: 0,
      error: false,
    });
  }

  send({ type: "done" });
  res.end();
}

async function handleSiteGroups(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { groups: loadGroups() });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readRequestJson(req);
    const groups = loadGroups();
    const { action, group } = body;

    if (action === "create") {
      if (!group?.name || !Array.isArray(group.slugs) || group.slugs.length === 0) {
        sendJson(res, 400, { error: "그룹 이름과 사이트를 입력하세요." });
        return;
      }

      const newGroup = {
        id: `grp-${Date.now()}`,
        name: String(group.name).trim(),
        slugs: group.slugs,
        createdAt: new Date().toISOString(),
      };
      groups.push(newGroup);
      writeJson(GROUPS_CACHE, groups);
      sendJson(res, 200, { group: newGroup });
      return;
    }

    if (action === "update") {
      if (!group?.id) {
        sendJson(res, 400, { error: "그룹 ID가 없습니다." });
        return;
      }

      const idx = groups.findIndex((item) => item.id === group.id);
      if (idx === -1) {
        sendJson(res, 404, { error: "그룹을 찾을 수 없습니다." });
        return;
      }

      if (group.name !== undefined) groups[idx].name = String(group.name).trim();
      if (Array.isArray(group.slugs)) groups[idx].slugs = group.slugs;
      writeJson(GROUPS_CACHE, groups);
      sendJson(res, 200, { group: groups[idx] });
      return;
    }

    if (action === "delete") {
      if (!group?.id) {
        sendJson(res, 400, { error: "그룹 ID가 없습니다." });
        return;
      }

      const nextGroups = groups.filter((item) => item.id !== group.id);
      writeJson(GROUPS_CACHE, nextGroups);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 400, { error: "알 수 없는 액션입니다." });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "그룹 저장 실패" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/content/fetch-sites" && req.method === "GET") {
    sendJson(res, 200, { sites: loadSites() });
    return;
  }

  if (url.pathname === "/api/content/site-groups") {
    await handleSiteGroups(req, res);
    return;
  }

  if (url.pathname === "/api/dashboard" && req.method === "GET") {
    await handleDashboard(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Fallback API listening on http://${HOST}:${PORT}`);
});
