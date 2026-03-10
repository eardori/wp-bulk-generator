import { NextRequest } from "next/server";
import { execSync, exec } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export const maxDuration = 600; // 10 minutes max

type DeployConfig = {
  site_slug?: string;
  domain?: string;
};

type ExistingSite = {
  slug?: string;
  domain?: string;
};

/**
 * Detect whether we are running ON the EC2 server.
 * If SSH_KEY_PATH env is set AND the file exists → local dev mode (SSH to EC2).
 * Otherwise → we ARE the EC2 server, run locally.
 */
function isLocalDevMode(): boolean {
  const keyPath = process.env.SSH_KEY_PATH;
  if (!keyPath) return false;
  try {
    return existsSync(keyPath);
  } catch {
    return false;
  }
}

function tryReadJson<T>(path: string): T[] {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T[];
  } catch {
    /* ignore cache read failures */
  }
  return [];
}

function normalizeSlug(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeDomain(value: string | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function findRequestDuplicates(configs: DeployConfig[]): string[] {
  const seenSlugs = new Set<string>();
  const seenDomains = new Set<string>();
  const duplicates = new Set<string>();

  for (const cfg of configs) {
    const slug = normalizeSlug(cfg.site_slug);
    const domain = normalizeDomain(cfg.domain);

    if (slug) {
      if (seenSlugs.has(slug)) duplicates.add(`slug:${slug}`);
      seenSlugs.add(slug);
    }

    if (domain) {
      if (seenDomains.has(domain)) duplicates.add(`domain:${domain}`);
      seenDomains.add(domain);
    }
  }

  return Array.from(duplicates);
}

function readExistingSites(
  localDev: boolean,
  sshCmd: string,
  credsDest: string
): ExistingSite[] {
  if (localDev) {
    try {
      const raw = execSync(`${sshCmd} "sudo cat ${credsDest}"`, { timeout: 10000 }).toString();
      return JSON.parse(raw) as ExistingSite[];
    } catch {
      /* fall back to local cache */
    }
  } else {
    try {
      const raw = execSync(`sudo cat ${credsDest}`, { timeout: 10000 }).toString();
      return JSON.parse(raw) as ExistingSite[];
    } catch {
      /* fall back to cache */
    }
  }

  const cachePath = join(process.cwd(), ".cache", "sites-credentials.json");
  const legacyPath = join(process.cwd(), "..", "configs", "sites-credentials.json");
  const cached = tryReadJson<ExistingSite>(cachePath);
  return cached.length > 0 ? cached : tryReadJson<ExistingSite>(legacyPath);
}

function findExistingConflicts(configs: DeployConfig[], existingSites: ExistingSite[]): string[] {
  const existingSlugs = new Set(existingSites.map((site) => normalizeSlug(site.slug)).filter(Boolean));
  const existingDomains = new Set(existingSites.map((site) => normalizeDomain(site.domain)).filter(Boolean));
  const conflicts = new Set<string>();

  for (const cfg of configs) {
    const slug = normalizeSlug(cfg.site_slug);
    const domain = normalizeDomain(cfg.domain);

    if (slug && existingSlugs.has(slug)) conflicts.add(`slug:${slug}`);
    if (domain && existingDomains.has(domain)) conflicts.add(`domain:${domain}`);
  }

  return Array.from(conflicts);
}

export async function POST(req: NextRequest) {
  const { configs } = await req.json();

  if (!configs || !Array.isArray(configs) || configs.length === 0) {
    return new Response(JSON.stringify({ error: "configs가 필요합니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const localDev = isLocalDevMode();
  const sshHost = process.env.SSH_HOST || "108.129.225.228";
  const sshUser = process.env.SSH_USER || "ubuntu";
  const sshKeyPath = process.env.SSH_KEY_PATH || "";
  const sshCmd = localDev
    ? `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${sshUser}@${sshHost}`
    : "";

  // Path to deploy script
  const scriptSrc = join(process.cwd(), "..", "scripts", "deploy-wp-sites.sh");
  const scriptDest = "/tmp/deploy-wp-sites.sh";
  const configDest = "/tmp/sites-config-deploy.json";
  const credsDest = "/root/wp-sites-credentials.json";
  const configPermPath = "/root/wp-sites-config.json";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", timestamp: Date.now() });
      }, 15000);

      try {
        const requestDuplicates = findRequestDuplicates(configs as DeployConfig[]);
        if (requestDuplicates.length > 0) {
          send({
            status: "error",
            message: `요청 안에 중복 slug/domain이 있습니다: ${requestDuplicates.join(", ")}`,
          });
          return;
        }

        const existingSites = readExistingSites(localDev, sshCmd, credsDest);
        const existingConflicts = findExistingConflicts(
          configs as DeployConfig[],
          existingSites
        );
        if (existingConflicts.length > 0) {
          send({
            status: "error",
            message: `이미 존재하는 사이트와 충돌합니다: ${existingConflicts.join(", ")}. 기존 콘텐츠 재사용을 막기 위해 배포를 중단했습니다.`,
          });
          return;
        }

        // ── Step 1: Write config file ──────────────────────────────
        send({ message: "설정 파일 준비 중..." });

        const configJson = JSON.stringify(configs, null, 2);

        if (localDev) {
          // Write locally then SCP to server
          const tmpLocal = `/tmp/wp-config-${Date.now()}.json`;
          writeFileSync(tmpLocal, configJson);
          execSync(
            `scp -i ${sshKeyPath} -o StrictHostKeyChecking=no ${tmpLocal} ${sshUser}@${sshHost}:${configDest}`,
            { timeout: 30000 }
          );
        } else {
          // Write directly on server
          writeFileSync(configDest, configJson);
          execSync(`sudo cp ${configDest} ${configPermPath}`, { timeout: 10000 });
          // Also save config to .cache/ so fetch-sites can read it right away
          const cacheDir = join(process.cwd(), ".cache");
          if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
          writeFileSync(join(cacheDir, "sites-config.json"), configJson);
        }

        send({ message: "설정 파일 완료" });

        // ── Step 2: Deploy script ──────────────────────────────────
        send({ message: "배포 스크립트 준비 중..." });

        if (localDev) {
          execSync(
            `scp -i ${sshKeyPath} -o StrictHostKeyChecking=no ${scriptSrc} ${sshUser}@${sshHost}:${scriptDest}`,
            { timeout: 30000 }
          );
          execSync(`${sshCmd} "chmod +x ${scriptDest}"`, { timeout: 10000 });
          execSync(
            `${sshCmd} "sudo cp ${configDest} ${configPermPath}"`,
            { timeout: 10000 }
          );
        } else {
          // On server: copy script from repo to /tmp
          if (existsSync(scriptSrc)) {
            execSync(`cp ${scriptSrc} ${scriptDest} && chmod +x ${scriptDest}`, { timeout: 10000 });
          } else if (!existsSync(scriptDest)) {
            throw new Error(`배포 스크립트를 찾을 수 없습니다: ${scriptSrc}`);
          }
        }

        send({ message: "배포 스크립트 준비 완료" });

        // ── Step 3: Run deploy script ──────────────────────────────
        send({
          message: `${configs.length}개 사이트 WordPress 설치 시작...`,
          status: "deploying",
          progress: 0,
          total: configs.length,
        });

        const deployCmd = localDev
          ? `${sshCmd} "sudo ${scriptDest} ${configDest}"`
          : `sudo ${scriptDest} ${configDest}`;

        const deployProcess = exec(deployCmd, {
          timeout: 600000,
          maxBuffer: 10 * 1024 * 1024,
        });

        let currentProgress = 0;
        let adminPass = "";

        await new Promise<void>((resolve, reject) => {
          deployProcess.stdout?.on("data", (data: string) => {
            const lines = data.toString().split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;

              const progressMatch = line.match(/\[(\d+)\/(\d+)\]/);
              if (progressMatch) {
                currentProgress = parseInt(progressMatch[1]) - 1;
                send({
                  progress: currentProgress,
                  total: configs.length,
                  currentSite: configs[currentProgress]?.site_slug || "",
                  message: line.trim(),
                });
              } else if (line.includes("설치 완료")) {
                currentProgress++;
                send({
                  progress: currentProgress,
                  total: configs.length,
                  message: `✓ ${line.trim()}`,
                });
              } else if (line.includes("관리자 비밀번호")) {
                const passMatch = line.match(/관리자 비밀번호:\s*(.+)/);
                if (passMatch) adminPass = passMatch[1].trim();
              } else if (
                line.includes("[") ||
                line.includes("---") ||
                line.includes("===")
              ) {
                send({ message: line.trim() });
              }
            }
          });

          deployProcess.stderr?.on("data", (data: string) => {
            const errLine = data.toString().trim();
            if (errLine && !errLine.includes("sendmail") && !errLine.includes("Warning")) {
              send({ message: `⚠ ${errLine}` });
            }
          });

          deployProcess.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Deploy script exited with code ${code}`));
          });

          deployProcess.on("error", reject);
        });

        // ── Step 4: Read credentials ───────────────────────────────
        send({ message: "자격증명 수집 중..." });

        let credentials;
        try {
          const credsRaw = localDev
            ? execSync(`${sshCmd} "sudo cat ${credsDest}"`, { timeout: 10000 }).toString()
            : readFileSync(credsDest, "utf-8");

          const creds = JSON.parse(credsRaw);

          // Save to local cache for content creator
          const cacheDir = join(process.cwd(), ".cache");
          if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
          writeFileSync(join(cacheDir, "sites-credentials.json"), JSON.stringify(creds, null, 2));
          writeFileSync(join(cacheDir, "sites-config.json"), JSON.stringify(configs, null, 2));

          credentials = {
            admin_user: "admin",
            admin_pass: adminPass || creds[0]?.admin_pass || "N/A",
            sites: creds.map((c: { slug: string; domain: string; url: string }) => ({
              slug: c.slug,
              domain: c.domain,
              url: c.url || `http://${c.domain}`,
            })),
          };
        } catch {
          credentials = {
            admin_user: "admin",
            admin_pass: adminPass || "N/A",
            sites: configs.map((c: { site_slug: string; domain: string }) => ({
              slug: c.site_slug,
              domain: c.domain,
              url: `http://${c.domain}`,
            })),
          };
        }

        send({
          status: "done",
          progress: configs.length,
          total: configs.length,
          message: `✓ ${configs.length}개 사이트 설치 완료!`,
          credentials,
        });
      } catch (error) {
        send({
          status: "error",
          message: `오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
