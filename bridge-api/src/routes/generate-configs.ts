import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync, existsSync } from "fs";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";

const BATCH_SIZE = 10;
const MAX_SLUG_LENGTH = 15;

const CREDS_PATH = process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH = process.env.CONFIG_PATH || "/root/wp-sites-config.json";

type SiteRecord = {
  slug?: string;
  site_slug?: string;
  domain?: string;
};

function tryReadJson<T>(path: string): T[] {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T[];
  } catch {
    /* ignore cache read failures */
  }
  return [];
}

function sanitizeSlug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const trimmed = cleaned.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return trimmed.length >= 3 ? trimmed : "site";
}

function loadReservedSlugs(): Set<string> {
  const reserved = new Set<string>();

  const existing = [
    ...tryReadJson<SiteRecord>(CREDS_PATH),
    ...tryReadJson<SiteRecord>(CONFIG_PATH),
  ];

  for (const site of existing) {
    const slug = site.slug || site.site_slug || site.domain?.split(".")[0] || "";
    if (slug) reserved.add(sanitizeSlug(slug));
  }

  return reserved;
}

function makeUniqueSlug(base: string, reservedSlugs: Set<string>): string {
  const seed = sanitizeSlug(base);

  if (!reservedSlugs.has(seed)) {
    reservedSlugs.add(seed);
    return seed;
  }

  for (let suffix = 2; suffix < 1000; suffix++) {
    const suffixText = `-${suffix}`;
    const stem = seed.slice(0, MAX_SLUG_LENGTH - suffixText.length).replace(/-+$/g, "") || "site";
    const candidate = `${stem}${suffixText}`;
    if (!reservedSlugs.has(candidate)) {
      reservedSlugs.add(candidate);
      return candidate;
    }
  }

  throw new Error(`고유한 slug를 만들 수 없습니다: ${seed}`);
}

async function callGeminiWithRetry(
  model: ReturnType<InstanceType<typeof GoogleGenerativeAI>["getGenerativeModel"]>,
  prompt: string,
  sendProgress: (msg: string) => void
): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("resource exhausted");
      if (isRateLimit && attempt < 3) {
        const delay = attempt * 20000; // 20s, 40s
        sendProgress(`⏳ API 한도 초과 — ${delay / 1000}초 후 재시도 (${attempt}/3)...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error("AI 응답을 받지 못했습니다.");
}

/** Extract complete JSON objects from potentially truncated array response */
function repairJsonArray(raw: string): unknown[] {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to repair
  }

  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return results;
}

function buildPrompt(
  niche: string,
  batchCount: number,
  batchIndex: number,
  totalCount: number,
  koPercent: number,
  enPercent: number,
  isSubdomain: boolean,
  base_domain: string,
  domainSuffix: string,
  domainExample: string,
  domainDesc: string
): string {
  const batchNote =
    totalCount > BATCH_SIZE
      ? `\n- 이 배치는 전체 ${totalCount}개 중 배치 ${batchIndex + 1}번 (${batchCount}개)입니다. 이전 배치와 겹치지 않게 독창적으로 만드세요.`
      : "";

  return `당신은 WordPress 사이트 기획 전문가입니다. 아래 니치에 맞는 WordPress 사이트 설정을 ${batchCount}개 생성해주세요.

## 입력
- 니치: ${niche}
- 수량: ${batchCount}개${batchNote}
- 언어 비율: 한국어 ${koPercent}% / 영어 ${enPercent}%
- 도메인 방식: ${isSubdomain ? `서브도메인 (베이스: ${base_domain})` : `개별 도메인 (확장자: ${domainSuffix})`}

## 각 사이트마다 생성할 항목
1. site_slug: 영문 도메인용 (3~15자, 영문+하이픈만)
2. domain: ${domainDesc}
3. site_title: 사이트 제목 (20~40자)
4. tagline: 부제목
5. persona: { name, age(20~55), concern, expertise(초보/초중급/중급/전문가), tone(친근/전문/유머/감성/담백), bio(2~3문장) }
6. color_scheme: { primary, secondary, accent(hex), style(minimal/warm/clean/bold/natural) }
7. categories: 4~6개 배열
8. initial_post_topics: 5개 배열 (FAQ형/리뷰형/비교형 혼합)
9. layout_preference: { homepage(blog/magazine/minimal-list/card-grid), sidebar(bool), featured_image_style(full-width/thumbnail/none) }

## 규칙
- ${batchCount}개 모두 달라 보여야 함, 반복 금지
- 실제 개인 블로그처럼, 기업 사이트 느낌 금지
- 다양한 연령대/관심사/톤
- ${enPercent}%는 영문 또는 영한 혼합

## 출력
JSON 배열만 출력 (마크다운/설명 없이):
[{"site_slug":"example-slug","domain":"${domainExample}","site_title":"...","tagline":"...","persona":{"name":"...","age":30,"concern":"...","expertise":"중급","tone":"친근","bio":"..."},"color_scheme":{"primary":"#2D6A4F","secondary":"#D8F3DC","accent":"#40916C","style":"natural"},"categories":["..."],"initial_post_topics":["..."],"layout_preference":{"homepage":"blog","sidebar":false,"featured_image_style":"full-width"}}]`;
}

function normalizeConfigs(
  configs: Record<string, unknown>[],
  isSubdomain: boolean,
  base_domain: string,
  domainSuffix: string,
  reservedSlugs: Set<string>
): { configs: Record<string, unknown>[]; adjustments: string[] } {
  const adjustments: string[] = [];

  const normalized = configs.map((cfg) => {
    const rawSlug = (cfg.site_slug as string) || ((cfg.domain as string) || "").split(".")[0] || "";
    const slug = makeUniqueSlug(rawSlug, reservedSlugs);
    if (slug !== sanitizeSlug(rawSlug)) {
      adjustments.push(`${sanitizeSlug(rawSlug)} -> ${slug}`);
    }

    const nextCfg: Record<string, unknown> = { ...cfg, site_slug: slug };
    if (isSubdomain && base_domain) {
      nextCfg.domain = `${slug}.${base_domain}`;
    } else {
      nextCfg.domain = `${slug}${domainSuffix}`;
    }
    return nextCfg;
  });

  return { configs: normalized, adjustments };
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function generateConfigsRoutes(app: FastifyInstance) {
  app.post("/generate-configs", async (req, reply) => {
    const { niche, count, language_ratio, domain_mode, base_domain, domain_suffix } =
      req.body as Record<string, unknown>;

    const isSubdomain = domain_mode === "subdomain" && !!base_domain;
    const domainSuffix = (domain_suffix as string) || ".site";
    const totalCount = Number(count) || 5;
    const langRatio = language_ratio as { ko?: number; en?: number } | undefined;
    const koPercent = Math.round((langRatio?.ko || 0.8) * 100);
    const enPercent = 100 - koPercent;

    const domainExample = isSubdomain ? `example-slug.${base_domain}` : `example-slug${domainSuffix}`;
    const domainDesc = isSubdomain
      ? `site_slug + ".${base_domain}" (예: "glowdiary.${base_domain}")`
      : `site_slug + "${domainSuffix}" (예: "glowdiary${domainSuffix}")`;
    const reservedSlugs = loadReservedSlugs();

    const { send, close } = setupSSE(reply);

    const sendProgress = (message: string) => {
      send({ type: "progress", message });
    };

    try {
      if (!niche || !count) {
        send({ type: "error", message: "niche와 count가 필요합니다." });
        close();
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        send({ type: "error", message: "GEMINI_API_KEY가 설정되지 않았습니다." });
        close();
        return;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      });

      // Split into batches
      const batches: number[] = [];
      let remaining = totalCount;
      while (remaining > 0) {
        batches.push(Math.min(remaining, BATCH_SIZE));
        remaining -= BATCH_SIZE;
      }
      const totalBatches = batches.length;

      send({ type: "start", totalBatches, totalCount });

      let allCollected = 0;

      for (let i = 0; i < totalBatches; i++) {
        const batchCount = batches[i];
        sendProgress(`🔄 배치 ${i + 1}/${totalBatches} 생성 중... (${batchCount}개)`);

        const prompt = buildPrompt(
          niche as string, batchCount, i, totalCount,
          koPercent, enPercent,
          isSubdomain, base_domain as string, domainSuffix,
          domainExample, domainDesc
        );

        let responseText: string;
        try {
          responseText = await callGeminiWithRetry(model, prompt, sendProgress);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "알 수 없는 오류";
          const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("resource exhausted");
          send({
            type: "batch_error",
            batchIndex: i,
            totalBatches,
            collected: allCollected,
            remaining: totalCount - allCollected,
            message: isRateLimit
              ? `API 한도 초과 — ${allCollected}개까지 저장됨. 잠시 후 다시 생성하면 이어할 수 있어요.`
              : msg,
          });
          break; // stop further batches, but keep what we have
        }

        if (!responseText) {
          sendProgress(`⚠️ 배치 ${i + 1} 빈 응답, 건너뜀`);
          continue;
        }

        const parsed = repairJsonArray(responseText) as Record<string, unknown>[];
        if (parsed.length === 0) {
          sendProgress(`⚠️ 배치 ${i + 1} 파싱 실패, 건너뜀`);
          continue;
        }

        const normalized = normalizeConfigs(
          parsed,
          isSubdomain,
          base_domain as string,
          domainSuffix,
          reservedSlugs
        );
        allCollected += normalized.configs.length;

        if (normalized.adjustments.length > 0) {
          const preview = normalized.adjustments.slice(0, 3).join(", ");
          const extra =
            normalized.adjustments.length > 3
              ? ` 외 ${normalized.adjustments.length - 3}건`
              : "";
          sendProgress(`⚠️ 기존 사이트와 겹친 slug를 자동 조정했습니다: ${preview}${extra}`);
        }

        send({
          type: "batch",
          batchIndex: i,
          totalBatches,
          configs: normalized.configs,
          collected: allCollected,
          total: totalCount,
        });

        // Small delay between batches to avoid rate limits
        if (i < totalBatches - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      send({ type: "done", total: allCollected });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      send({ type: "error", message: msg });
    } finally {
      close();
    }
  });
}
