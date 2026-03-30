import type { FastifyInstance } from "fastify";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { setupSSE } from "../utils/sse.js";
import { fetchCredentials } from "../lib/ec2-client.js";
import { getBrowser } from "../utils/browser.js";
import {
  resolveSiteTarget,
  getSiteDirForTarget,
  isRemoteTarget,
} from "../lib/server-targets.js";
import { execSsh, shellQuote } from "../lib/ssh.js";

// ── Types ────────────────────────────────────────────────────────────────────

type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  admin_pass: string;
  app_pass: string;
  site_dir?: string;
  server_id?: string;
  server_host?: string;
  server_user?: string;
  server_key_path?: string;
  server_site_root?: string;
  server_repo_root?: string;
};

type ExtractedBusinessInfo = {
  businessName: string;
  businessType: string;
  address: string;
  phone: string;
  website: string;
  description: string;
  openingHours: Array<{ days: string; hours: string }>;
  menuItems: Array<{ name: string; price: string }>;
  services: string[];
  faq: Array<{ question: string; answer: string }>;
  priceRange: string;
  images: string[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

function buildMuPluginPhp(schemaJson: string, siteSlug: string): string {
  // Escape for PHP heredoc
  const escapedJson = schemaJson.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `<?php
/**
 * Plugin Name: AEO Schema (JSON-LD)
 * Description: Auto-generated LocalBusiness Schema for AEO optimization
 * Version: 1.0
 * Generated: ${new Date().toISOString()}
 * Site: ${siteSlug}
 */

add_action('wp_head', function() {
    echo '<script type="application/ld+json">' . PHP_EOL;
    echo '${escapedJson}' . PHP_EOL;
    echo '</script>' . PHP_EOL;
}, 1);
`;
}

async function checkSiteSchemaStatus(
  siteUrl: string
): Promise<{ hasSchema: boolean; schemaTypes: string[] }> {
  try {
    const res = await fetch(siteUrl, {
      headers: { "User-Agent": "WP-Schema-Checker/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { hasSchema: false, schemaTypes: [] };

    const html = await res.text();
    const schemaTypes: string[] = [];

    // Find all JSON-LD blocks
    const jsonLdRegex =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        if (data["@type"]) {
          schemaTypes.push(data["@type"]);
        }
        // Handle @graph arrays
        if (Array.isArray(data["@graph"])) {
          for (const item of data["@graph"]) {
            if (item["@type"]) schemaTypes.push(item["@type"]);
          }
        }
      } catch {
        // skip malformed JSON-LD
      }
    }

    return {
      hasSchema: schemaTypes.length > 0,
      schemaTypes: [...new Set(schemaTypes)],
    };
  } catch {
    return { hasSchema: false, schemaTypes: [] };
  }
}

// ── Gemini AI extraction ─────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a business information extractor. Given the HTML content of a website, extract structured business information.

Return a JSON object with these fields (fill empty string or empty array if not found):
{
  "businessName": "상호명",
  "businessType": one of ["restaurant", "cafe", "dermatology", "dental", "hair_salon", "nail_salon", "academy", "gym", "local_business"],
  "address": "full address in Korean",
  "phone": "phone number",
  "website": "website URL",
  "description": "brief business description in Korean (1-2 sentences)",
  "openingHours": [{"days": "월-금", "hours": "09:00-18:00"}],
  "menuItems": [{"name": "menu item name", "price": "15,000원"}],
  "services": ["service 1", "service 2"],
  "faq": [{"question": "Q?", "answer": "A."}],
  "priceRange": "₩₩ or price range text",
  "images": ["image URL 1"]
}

IMPORTANT:
- Extract ONLY factual information found on the page
- For businessType, choose the closest match from the list
- For Korean businesses, keep text in Korean
- Return ONLY the JSON object, no markdown or explanation`;

async function extractBusinessInfoWithAI(
  htmlContent: string,
  url: string
): Promise<ExtractedBusinessInfo | null> {
  const client = getGeminiClient();
  if (!client) return null;

  const model = client.getGenerativeModel({
    model: process.env.GEMINI_CONFIG_MODEL || "gemini-2.5-flash",
  });

  // Truncate HTML to ~30k chars to avoid token limits
  const truncatedHtml = htmlContent.slice(0, 30000);
  const prompt = `${EXTRACTION_PROMPT}\n\nWebsite URL: ${url}\n\nHTML Content:\n${truncatedHtml}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Extract JSON from response (it might be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as ExtractedBusinessInfo;
  } catch (error) {
    console.error("Gemini extraction error:", error);
    return null;
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function schemaRoutes(app: FastifyInstance) {
  // ─── POST /schema/extract ──────────────────────────────────
  // URL에서 업체 정보를 자동 추출
  app.post("/schema/extract", async (req) => {
    const { url } = req.body as { url: string };

    if (!url) {
      return { error: "URL이 필요합니다." };
    }

    try {
      const browser = await getBrowser();
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      const page = await context.newPage();

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      // Get page HTML & basic metadata
      const pageData = await page.evaluate(() => {
        const title = document.title || "";
        const metaDesc =
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content") || "";
        const bodyText = document.body?.innerText?.slice(0, 10000) || "";
        const html = document.documentElement.outerHTML;
        return { title, metaDesc, bodyText, html };
      });

      await context.close();

      // Try AI extraction
      const extracted = await extractBusinessInfoWithAI(pageData.html, url);

      if (extracted) {
        return {
          success: true,
          data: {
            ...extracted,
            website: url,
          },
          source: "ai",
        };
      }

      // Fallback: basic extraction from metadata
      return {
        success: true,
        data: {
          businessName: pageData.title.split("|")[0]?.split("-")[0]?.trim() || "",
          businessType: "local_business",
          address: "",
          phone: "",
          website: url,
          description: pageData.metaDesc,
          openingHours: [],
          menuItems: [],
          services: [],
          faq: [],
          priceRange: "",
          images: [],
        } satisfies ExtractedBusinessInfo,
        source: "fallback",
      };
    } catch (error) {
      return {
        error: `크롤링 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      };
    }
  });

  // ─── GET /schema/status ────────────────────────────────────
  // 전체 WP 사이트의 Schema 설치 상태 확인
  app.get("/schema/status", async (req, reply) => {
    const { send, close } = setupSSE(reply);

    try {
      const allSitesRaw = await fetchCredentials();
      const sites = allSitesRaw as unknown as SiteCredential[];

      send({
        type: "meta",
        total: sites.length,
        message: `${sites.length}개 사이트 Schema 상태 확인 중...`,
      });

      for (const site of sites) {
        try {
          const status = await checkSiteSchemaStatus(site.url);
          send({
            type: "site-status",
            slug: site.slug,
            domain: site.domain,
            title: site.title,
            url: site.url,
            hasSchema: status.hasSchema,
            schemaTypes: status.schemaTypes,
            hasLocalBusiness: status.schemaTypes.some(
              (t) =>
                t === "LocalBusiness" ||
                t === "Restaurant" ||
                t === "Dentist" ||
                t === "HealthAndBeautyBusiness" ||
                t === "SportsActivityLocation"
            ),
          });
        } catch {
          send({
            type: "site-status",
            slug: site.slug,
            domain: site.domain,
            title: site.title,
            url: site.url,
            hasSchema: false,
            schemaTypes: [],
            hasLocalBusiness: false,
            error: "접근 실패",
          });
        }
      }

      send({ type: "done", message: "상태 확인 완료" });
    } catch (error) {
      send({
        type: "error",
        message: `오류: ${error instanceof Error ? error.message : "알 수 없음"}`,
      });
    } finally {
      close();
    }
  });

  // ─── POST /schema/install ──────────────────────────────────
  // WP 사이트에 Schema mu-plugin 자동 설치
  app.post("/schema/install", async (req, reply) => {
    const { sites: siteSlugs, schemaJson } = req.body as {
      sites: string[];
      schemaJson: string;
    };

    if (!siteSlugs?.length) {
      return reply.status(400).send({ error: "사이트를 선택해주세요." });
    }

    const { send, close } = setupSSE(reply);

    try {
      const allSitesRaw = await fetchCredentials();
      const allSites = allSitesRaw as unknown as SiteCredential[];

      const selectedSites = allSites.filter((s) =>
        siteSlugs.includes(s.slug)
      );

      if (selectedSites.length === 0) {
        send({ type: "error", message: "선택한 사이트를 찾을 수 없습니다." });
        close();
        return;
      }

      send({
        type: "start",
        total: selectedSites.length,
        message: `${selectedSites.length}개 사이트에 Schema 설치 시작...`,
      });

      let installed = 0;
      let failed = 0;

      for (const site of selectedSites) {
        send({
          type: "installing",
          slug: site.slug,
          title: site.title,
          message: `${site.title} 설치 중...`,
        });

        try {
          // Generate schema JSON for this site if not provided
          let siteSchemaJson = schemaJson;
          if (!siteSchemaJson) {
            // Auto-generate a basic schema from site info
            const basicSchema = {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: site.title,
              url: site.url,
            };
            siteSchemaJson = JSON.stringify(basicSchema, null, 2);
          }

          const pluginContent = buildMuPluginPhp(siteSchemaJson, site.slug);
          const target = resolveSiteTarget(site);
          const siteDir = getSiteDirForTarget(site, target);
          const muPluginDir = `${siteDir}/wp-content/mu-plugins`;
          const pluginPath = `${muPluginDir}/aeo-schema.php`;

          if (isRemoteTarget(target)) {
            // Remote: Use SSH
            execSsh(
              target,
              `mkdir -p ${shellQuote(muPluginDir)} && cat > ${shellQuote(pluginPath)} << 'EOFSCHEMA'\n${pluginContent}\nEOFSCHEMA`,
              30000
            );
          } else {
            // Local: Direct file write
            const { existsSync, mkdirSync, writeFileSync } = await import("fs");
            if (!existsSync(muPluginDir)) {
              mkdirSync(muPluginDir, { recursive: true });
            }
            writeFileSync(pluginPath, pluginContent);
          }

          installed++;
          send({
            type: "installed",
            slug: site.slug,
            title: site.title,
            message: `✅ ${site.title} — Schema 설치 완료`,
          });
        } catch (error) {
          failed++;
          send({
            type: "install-error",
            slug: site.slug,
            title: site.title,
            message: `❌ ${site.title} — ${error instanceof Error ? error.message : "설치 실패"}`,
          });
        }
      }

      send({
        type: "done",
        installed,
        failed,
        message: `완료! ${installed}개 설치, ${failed}개 실패`,
      });
    } catch (error) {
      send({
        type: "error",
        message: `오류: ${error instanceof Error ? error.message : "알 수 없음"}`,
      });
    } finally {
      close();
    }
  });
}
