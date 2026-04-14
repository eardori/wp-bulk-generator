import * as cheerio from "cheerio";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "os";
import { join } from "path";
import { setupSSE } from "../utils/sse.js";
import { sanitizeGeneratedArticle } from "../lib/article-sanitizer.js";
import { updateDashboardSiteCache } from "../lib/dashboard-cache.js";
import { buildBusinessSchemaFromHtml, stripReviewReferenceMarkers } from "../lib/business-schema.js";
import {
  isBingWebmasterSyncEnabled,
  syncBingSite,
} from "../lib/bing-webmaster.js";
import {
  isIndexNowEnabled,
  submitIndexNow,
  getIndexNowApiKey,
} from "../lib/indexnow.js";
import {
  getSiteDirForTarget,
  isRemoteTarget,
  resolveSiteTarget,
} from "../lib/server-targets.js";
import { execSsh, scpToTarget, shellQuote } from "../lib/ssh.js";
import type { ReviewImage } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

type FAQItem = {
  question: string;
  answer: string;
};

type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  admin_pass: string;
  app_pass: string;
  persona?: {
    name: string;
    age?: number;
    concern?: string;
    expertise?: string;
    tone?: string;
    bio?: string;
  };
  site_dir?: string;
  server_id?: string;
  server_host?: string;
  server_user?: string;
  server_key_path?: string;
  server_site_root?: string;
  server_repo_root?: string;
};

type GeneratedArticle = {
  id: string;
  siteSlug: string;
  siteDomain: string;
  personaName: string;
  sourceTitle: string;
  targetQuestion: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  htmlContent: string;
  excerpt: string;
  category: string;
  tags: string[];
  faqSchema: FAQItem[];
  wordCount: number;
  status: "generated" | "publishing" | "published" | "error";
  reviewImages?: ReviewImage[];
  usedReviewImageIndices?: Array<[number, number]>;
};

type PublishResult = {
  postId: number;
  postUrl: string;
  finalHtml: string;
};

type SendFn = (data: Record<string, unknown>) => void;

const REMOTE_FETCH_TIMEOUT_MS = Number(process.env.WP_REMOTE_FETCH_TIMEOUT_MS || 20000);
const WP_SITES_ROOT = process.env.WP_SITES_ROOT || "/var/www";

function normalizeSiteDomain(value: string | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutScheme = raw.replace(/^https?:\/\//i, "");
  return withoutScheme.replace(/\/.*$/, "").trim().toLowerCase();
}

function getSiteBaseUrl(site: SiteCredential): string {
  const domain = normalizeSiteDomain(site.domain) || normalizeSiteDomain(site.url);
  if (domain) {
    return `https://${domain}`;
  }

  return String(site.url || "").trim().replace(/\/$/, "");
}

function normalizeTrailingSlash(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") + "/";
}

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePublishedPostUrl(
  rawUrl: unknown,
  site: SiteCredential,
  fallbackSlug?: string,
  fallbackPostId?: number | null
): string {
  const baseUrl = getSiteBaseUrl(site);
  const cleanSlug = String(fallbackSlug || "").trim().replace(/^\/+|\/+$/g, "");
  const postId = parsePositiveInt(fallbackPostId);

  if (typeof rawUrl === "string" && rawUrl.trim() && !/undefined/i.test(rawUrl)) {
    try {
      const parsed = new URL(rawUrl.trim());
      const search = parsed.search || "";
      if (search.includes("p=") && cleanSlug) {
        return `${baseUrl}/${cleanSlug}/`;
      }
      if (search.includes("p=") && postId) {
        return `${baseUrl}/?p=${postId}`;
      }
      return `${baseUrl}${normalizeTrailingSlash(parsed.pathname)}`;
    } catch {
      // fall through to deterministic fallback
    }
  }

  if (cleanSlug) {
    return `${baseUrl}/${cleanSlug}/`;
  }

  if (postId) {
    return `${baseUrl}/?p=${postId}`;
  }

  return baseUrl;
}

function buildDashboardPostEntry(article: GeneratedArticle, result: PublishResult) {
  return {
    id: result.postId,
    title: { rendered: article.title },
    link: result.postUrl,
    date: new Date().toISOString(),
    status: "publish",
  };
}

// ── Image helpers ────────────────────────────────────────────────────────────

function downloadImageWithCurl(url: string): Buffer {
  const result = execFileSync("curl", [
    "-s", "-L", "--max-time", "20",
    "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "-H", "Referer: https://smartstore.naver.com/",
    url,
  ], { timeout: 25000, maxBuffer: 20 * 1024 * 1024 });
  if (!result || result.length < 100) throw new Error("Empty image response");
  return result;
}

async function uploadToWordPress(
  buffer: Buffer,
  filename: string,
  contentType: string,
  site: SiteCredential
): Promise<{ id: number; url: string }> {
  const baseUrl = getSiteBaseUrl(site);
  const authHeader = "Basic " + Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": contentType,
    },
    body: new Uint8Array(buffer),
    signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WP 미디어 업로드 실패 (${res.status}): ${err.slice(0, 200)}`);
  }

  const media = await res.json();
  return { id: media.id, url: media.source_url || media.guid?.rendered || "" };
}

function guessContentType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

async function uploadReviewImages(
  images: ReviewImage[],
  site: SiteCredential,
  send: SendFn
): Promise<Map<string, { id: number; url: string }>> {
  const uploaded = new Map<string, { id: number; url: string }>();

  for (const [idx, img] of images.entries()) {
    try {
      send({ type: "progress", message: `리뷰 이미지 ${idx + 1}/${images.length} 업로드 중...` });
      const buffer = downloadImageWithCurl(img.originalUrl);
      const ext = img.originalUrl.split(".").pop()?.split("?")[0] || "jpg";
      const filename = `review-image-${Date.now()}-${idx}.${ext}`;
      const contentType = guessContentType(img.originalUrl);
      const result = await uploadToWordPress(buffer, filename, contentType, site);
      uploaded.set(img.originalUrl, result);
    } catch {
      // Skip failed image uploads, continue
    }
  }

  return uploaded;
}

function replacePlaceholders(
  html: string,
  article: GeneratedArticle,
  uploadedMap: Map<string, { id: number; url: string }>,
  _reviewCollection?: { reviews: Array<{ images?: ReviewImage[] }> }
): string {
  const articleImageMap = new Map<string, ReviewImage>();
  if (article.usedReviewImageIndices && article.reviewImages) {
    for (const [idx, pair] of article.usedReviewImageIndices.entries()) {
      const image = article.reviewImages[idx];
      if (!image) continue;
      articleImageMap.set(`${pair[0]}:${pair[1]}`, image);
    }
  }

  let imgCounter = 0;
  return html.replace(/<!--\s*REVIEW_IMG:(\d+):(\d+)\s*-->/g, (match, reviewIdxStr, imgIdxStr) => {
    const reviewIdx = parseInt(reviewIdxStr);
    const imgIdx = parseInt(imgIdxStr);
    imgCounter++;

    let originalUrl: string | undefined;

    const articleImage = articleImageMap.get(`${reviewIdx}:${imgIdx}`);
    if (articleImage) {
      originalUrl = articleImage.originalUrl;
    }

    if (!originalUrl && _reviewCollection?.reviews[reviewIdx]?.images?.[imgIdx]) {
      originalUrl = _reviewCollection.reviews[reviewIdx].images![imgIdx].originalUrl;
    }

    if (!originalUrl) return "";

    const uploaded = originalUrl ? uploadedMap.get(originalUrl) : undefined;
    const imgUrl = uploaded?.url || originalUrl;

    const altText = article.sourceTitle
      ? `${article.sourceTitle} 참고 이미지 ${imgCounter}`
      : `참고 이미지 ${imgCounter}`;
    const captionText = article.sourceTitle
      ? `${article.sourceTitle} 참고 이미지`
      : `참고 이미지`;

    return `<figure class="review-image"><img src="${imgUrl}" alt="${altText}" loading="lazy" /><figcaption>${captionText}</figcaption></figure>`;
  });
}

function getLocalSiteDir(site: SiteCredential): string {
  return getSiteDirForTarget(site, resolveSiteTarget(site));
}

function hasLocalWordPress(site: SiteCredential): boolean {
  const target = resolveSiteTarget(site);
  const siteDir = getLocalSiteDir(site);

  if (!isRemoteTarget(target)) {
    return existsSync(join(siteDir, "wp-config.php"));
  }

  try {
    execSsh(
      target,
      `[ -f ${shellQuote(join(siteDir, "wp-config.php"))} ] && echo ok`,
      15000
    );
    return true;
  } catch {
    return false;
  }
}

async function probeRemoteWordPress(site: SiteCredential): Promise<{
  usable: boolean;
  reason?: string;
}> {
  const baseUrl = getSiteBaseUrl(site);

  try {
    const res = await fetch(`${baseUrl}/wp-json/`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    const contentType = res.headers.get("content-type") || "";
    const body = await res.text();

    if (!res.ok) {
      return {
        usable: false,
        reason: `REST preflight ${res.status}: ${body.slice(0, 120) || "응답 없음"}`,
      };
    }

    if (!contentType.includes("json")) {
      return {
        usable: false,
        reason: `REST preflight non-json: ${body.slice(0, 120) || "빈 응답"}`,
      };
    }

    if (!body.includes("\"namespaces\"")) {
      return {
        usable: false,
        reason: `REST preflight invalid payload: ${body.slice(0, 120) || "빈 응답"}`,
      };
    }

    return { usable: true };
  } catch (error) {
    return {
      usable: false,
      reason: error instanceof Error ? error.message : "알 수 없는 연결 오류",
    };
  }
}

function buildFinalHtml(article: GeneratedArticle, site: SiteCredential, replacedHtml: string): string {
  const baseUrl = getSiteBaseUrl(site);
  const canonicalUrl = `${baseUrl}/${article.slug}/`;
  const cleanedHtml = stripReviewReferenceMarkers(replacedHtml);
  let finalHtml = enhanceFaqMicrodata(cleanedHtml);

  // ── 목차 (Table of Contents) 자동 삽입 ──
  const tocHtml = buildTableOfContents(finalHtml);
  if (tocHtml) {
    // summary-box 바로 뒤 또는 첫 H2 바로 앞에 삽입
    const summaryBoxEnd = finalHtml.indexOf('</div>', finalHtml.indexOf('class="summary-box"'));
    if (summaryBoxEnd > 0) {
      const insertAt = summaryBoxEnd + '</div>'.length;
      finalHtml = finalHtml.slice(0, insertAt) + '\n' + tocHtml + finalHtml.slice(insertAt);
    } else {
      const firstH2 = finalHtml.indexOf('<h2');
      if (firstH2 > 0) {
        finalHtml = finalHtml.slice(0, firstH2) + tocHtml + '\n' + finalHtml.slice(firstH2);
      }
    }
  }

  // ── 작성자 소개 박스 (Author Bio) ──
  const authorBioHtml = buildAuthorBioHtml(site);
  if (authorBioHtml) {
    // FAQ 섹션이나 관련 글 앞, 또는 콘텐츠 맨 끝에 삽입
    const faqPos = finalHtml.indexOf('<h2>Q&A');
    const relatedPos = finalHtml.indexOf('class="related-posts"');
    const insertBefore = faqPos > 0 ? faqPos : relatedPos > 0 ? finalHtml.lastIndexOf('<div', relatedPos) : -1;
    if (insertBefore > 0) {
      finalHtml = finalHtml.slice(0, insertBefore) + authorBioHtml + '\n' + finalHtml.slice(insertBefore);
    } else {
      finalHtml += '\n' + authorBioHtml;
    }
  }

  // ── 마지막 업데이트 날짜 ──
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  const isoDate = now.toISOString().split('T')[0];
  finalHtml += `\n<p class="last-updated" style="color:#888;font-size:0.85em;margin-top:2em;text-align:right;">마지막 업데이트: <time datetime="${isoDate}">${dateStr}</time></p>`;

  // ── 통합 JSON-LD @graph 구성 (Bing 파서 호환성 향상) ──
  const authorUrl = `${baseUrl}/author/${(site.admin_user || "admin").toLowerCase()}/`;
  const graphItems: Record<string, unknown>[] = [];

  // Article schema
  graphItems.push({
    "@type": "Article",
    "headline": article.title,
    "description": article.metaDescription || article.excerpt,
    "author": {
      "@type": "Person",
      "name": site.persona?.name || site.admin_user,
      "url": authorUrl,
      "sameAs": [authorUrl],
      ...(site.persona?.expertise ? { "jobTitle": `${site.persona.expertise} 리뷰어` } : {}),
      ...(site.persona?.concern ? { "knowsAbout": site.persona.concern } : {}),
      ...(site.persona?.bio ? { "description": site.persona.bio } : {}),
    },
    "datePublished": now.toISOString(),
    "dateModified": now.toISOString(),
    "publisher": {
      "@type": "Organization",
      "name": site.title,
      "url": baseUrl,
    },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": [".summary-box", "h2", "h2 + p"],
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    "url": canonicalUrl,
    ...(article.tags?.length > 0 ? { "keywords": article.tags.join(", ") } : {}),
  });

  // FAQPage schema
  if (article.faqSchema && article.faqSchema.length > 0) {
    graphItems.push({
      "@type": "FAQPage",
      "mainEntity": article.faqSchema.map((faq) => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer,
        },
      })),
    });
  }

  // BreadcrumbList schema
  graphItems.push({
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": site.title || "홈",
        "item": baseUrl,
      },
      ...(article.category ? [{
        "@type": "ListItem",
        "position": 2,
        "name": article.category,
        "item": `${baseUrl}/category/${encodeURIComponent(article.category)}/`,
      }] : []),
      {
        "@type": "ListItem",
        "position": article.category ? 3 : 2,
        "name": article.title,
        "item": canonicalUrl,
      },
    ],
  });

  // HowTo schema (auto-extract from <ol> lists)
  const howToJsonLd = buildHowToSchema(cleanedHtml, article.title);
  if (howToJsonLd) {
    const { "@context": _ctx, ...howToWithoutContext } = howToJsonLd;
    graphItems.push(howToWithoutContext);
  }

  // Business / Product schema
  const businessJsonLd = buildBusinessSchemaFromHtml({
    title: article.title,
    excerpt: article.metaDescription || article.excerpt,
    contentHtml: cleanedHtml,
    url: canonicalUrl,
    sourceName: article.sourceTitle,
  });

  if (businessJsonLd) {
    const { "@context": _ctx, ...bizWithoutContext } = businessJsonLd;
    graphItems.push(bizWithoutContext);
  } else {
    const productReviewJsonLd = buildProductReviewSchema(article, site);
    if (productReviewJsonLd) {
      const { "@context": _ctx, ...prodWithoutContext } = productReviewJsonLd;
      graphItems.push(prodWithoutContext);
    }
  }

  // 단일 @graph JSON-LD 블록으로 출력
  const unifiedJsonLd = {
    "@context": "https://schema.org",
    "@graph": graphItems,
  };
  finalHtml += `\n<script type="application/ld+json">${JSON.stringify(unifiedJsonLd)}</script>`;

  return finalHtml;
}

/**
 * 목차 (Table of Contents) - H2 태그 기반 자동 생성
 */
function buildTableOfContents(html: string): string {
  const $ = cheerio.load(html, null, false);
  const headings: Array<{ text: string; id: string }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("h2").each((_: number, el: any) => {
    const text = $(el).text().trim();
    if (!text) return;
    // Q&A/FAQ 섹션은 목차에서 제외 (본문 마지막에 위치하므로)
    if (/Q&A|FAQ|자주 묻는/i.test(text)) return;

    const id = text
      .replace(/[^\w가-힣\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 50);

    // H2에 id 속성 추가 (앵커 링크용)
    $(el).attr("id", id);
    headings.push({ text, id });
  });

  if (headings.length < 3) return ""; // H2가 3개 미만이면 목차 불필요

  const tocItems = headings
    .map(h => `<li><a href="#${h.id}" style="color:#3498db;text-decoration:none;">${h.text}</a></li>`)
    .join("\n");

  return `<nav class="toc-box" style="background:#f0f4f8;border:1px solid #dde3ea;padding:16px 20px;margin:20px 0;border-radius:10px;">
<strong style="display:block;margin-bottom:8px;font-size:1.05em;">📑 목차</strong>
<ol style="margin:0;padding-left:20px;line-height:1.8;">${tocItems}</ol>
</nav>`;
}

/**
 * 작성자 소개 박스 (Author Bio) - E-E-A-T 강화
 */
function buildAuthorBioHtml(site: SiteCredential): string {
  const persona = site.persona;
  if (!persona?.name) return "";

  const name = persona.name;
  const expertise = persona.expertise || "";
  const bio = persona.bio || "";
  const concern = persona.concern || "";

  const infoLines: string[] = [];
  if (expertise) infoLines.push(`<strong>전문 분야</strong>: ${expertise}`);
  if (concern) infoLines.push(`<strong>관심사</strong>: ${concern}`);

  return `<div class="author-bio" style="display:flex;gap:16px;align-items:flex-start;background:#f8f9fa;border:1px solid #e0e4e8;padding:20px;margin:2em 0;border-radius:12px;">
<div style="flex-shrink:0;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.4em;font-weight:bold;">${name.charAt(0)}</div>
<div>
<strong style="font-size:1.05em;">${name}</strong>
${bio ? `<p style="margin:6px 0 4px;color:#555;font-size:0.92em;">${bio}</p>` : ""}
${infoLines.length > 0 ? `<p style="margin:4px 0 0;color:#777;font-size:0.85em;">${infoLines.join(" · ")}</p>` : ""}
</div>
</div>`;
}

/**
 * HowTo JSON-LD: <h2>사용법</h2> 뒤의 <ol> → HowTo step 추출
 */
function buildHowToSchema(html: string, articleTitle: string): Record<string, unknown> | null {
  const $ = cheerio.load(html, null, false);
  let howToSteps: Array<{ name: string; text: string }> = [];
  let howToName = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("h2").each((_: number, h2El: any) => {
    const h2Text = $(h2El).text().trim();
    // "사용법", "사용 방법", "이용 방법", "사용 순서" 등 HowTo 패턴 탐지
    if (!/(사용법|사용 방법|사용 순서|이용 방법|사용 팁|활용법|how\s*to)/i.test(h2Text)) return;

    howToName = h2Text;
    const ol = $(h2El).nextAll("ol").first();
    if (ol.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ol.find("li").each((idx: number, liEl: any) => {
      const stepText = $(liEl).text().trim();
      if (stepText) {
        howToSteps.push({
          name: `단계 ${idx + 1}`,
          text: stepText,
        });
      }
    });

    if (howToSteps.length > 0) return false; // 첫 매칭으로 충분
  });

  if (howToSteps.length < 2) return null;

  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": howToName || `${articleTitle} 사용법`,
    "step": howToSteps.map((step, idx) => ({
      "@type": "HowToStep",
      "position": idx + 1,
      "name": step.name,
      "text": step.text,
    })),
  };
}

/**
 * FAQ 섹션의 <details><summary> 구조에 Schema.org microdata 속성 추가
 * 이미 itemscope가 있으면 스킵
 */
function enhanceFaqMicrodata(html: string): string {
  if (!html.includes("<details>") && !html.includes("<summary>")) return html;
  if (html.includes('itemtype="https://schema.org/FAQPage"')) return html;

  const $ = cheerio.load(html, null, false);

  // FAQ 섹션 찾기 (h2에 "FAQ" 또는 "자주 묻는" 포함)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let faqSection: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("h2").each((_: number, h2El: any) => {
    const text = $(h2El).text();
    if (/FAQ|자주 묻는|질문/i.test(text)) {
      faqSection = $(h2El);
      return false;
    }
  });

  if (!faqSection) return html;

  // FAQ h2 다음의 details 요소들에 microdata 추가
  const details = faqSection.nextAll("details");
  if (details.length === 0) return html;

  // FAQ 감싸는 div 생성
  const faqWrapper = $(`<div itemscope itemtype="https://schema.org/FAQPage"></div>`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details.each((_: number, detailEl: any) => {
    const $detail = $(detailEl);
    $detail.attr("itemscope", "");
    $detail.attr("itemprop", "mainEntity");
    $detail.attr("itemtype", "https://schema.org/Question");

    const summary = $detail.find("summary").first();
    if (summary.length) {
      summary.attr("itemprop", "name");
    }

    // answer wrapper
    const answerP = $detail.find("p").first();
    if (answerP.length) {
      answerP.wrap('<div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer"></div>');
      answerP.attr("itemprop", "text");
    }
  });

  return $.html();
}

function buildProductReviewSchema(
  article: GeneratedArticle,
  site: SiteCredential
): Record<string, unknown> | null {
  const content = article.htmlContent;
  // 가격 정보 추출 (예: 15,900원, 29,800원)
  const priceMatches = content.match(/(\d{1,3}(?:,\d{3})*)\s*원/g);
  // 평점 추출 (예: 4.5점, 4.8/5)
  const ratingMatch = content.match(/(\d(?:\.\d)?)\s*(?:점|\/\s*5)/);

  // 상품명 = sourceTitle (스크래핑된 원본 상품명)
  if (!article.sourceTitle) return null;

  const review: Record<string, unknown> = {
    "@type": "Review",
    "author": {
      "@type": "Person",
      "name": site.persona?.name || site.admin_user,
    },
    "reviewBody": article.excerpt,
  };

  if (ratingMatch) {
    review["reviewRating"] = {
      "@type": "Rating",
      "ratingValue": ratingMatch[1],
      "bestRating": "5",
    };
  }

  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": article.sourceTitle,
    "description": article.metaDescription || article.excerpt,
    "review": review,
  };

  if (priceMatches && priceMatches.length > 0) {
    const prices = priceMatches
      .map(p => parseInt(p.replace(/[,원\s]/g, ""), 10))
      .filter(p => p > 0 && p < 10_000_000);
    if (prices.length > 0) {
      product["offers"] = {
        "@type": "AggregateOffer",
        "priceCurrency": "KRW",
        "lowPrice": Math.min(...prices),
        "highPrice": Math.max(...prices),
      };
    }
  }

  return product;
}

async function fetchRelatedPosts(
  site: SiteCredential,
  currentSlug: string,
  category: string,
  maxPosts = 3
): Promise<Array<{ title: string; url: string }>> {
  const baseUrl = getSiteBaseUrl(site);
  const authHeader = "Basic " + Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

  try {
    // 같은 카테고리의 최근 글 가져오기
    const res = await fetch(
      `${baseUrl}/wp-json/wp/v2/posts?per_page=${maxPosts + 1}&_fields=id,title,link,slug&status=publish&orderby=date&order=desc`,
      { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];

    const posts = await res.json() as Array<{ slug: string; title: { rendered: string }; link: string }>;
    return posts
      .filter(p => p.slug !== currentSlug)
      .slice(0, maxPosts)
      .map(p => ({
        title: p.title.rendered.replace(/<[^>]*>/g, ""),
        url: p.link,
      }));
  } catch {
    return [];
  }
}

function buildRelatedPostsHtml(relatedPosts: Array<{ title: string; url: string }>): string {
  if (relatedPosts.length === 0) return "";

  const links = relatedPosts
    .map(p => `<li><a href="${p.url}">${p.title}</a></li>`)
    .join("\n");

  return `\n<div class="related-posts" style="margin-top:2em;padding:1.2em;background:#f8f9fa;border-radius:8px;">
<h3>관련 글 추천</h3>
<ul>${links}</ul>
</div>`;
}

async function publishViaRestApi(
  article: GeneratedArticle,
  site: SiteCredential,
  finalHtml: string
): Promise<PublishResult> {
  const baseUrl = getSiteBaseUrl(site);
  const authHeader =
    "Basic " +
    Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

  const wpHeaders = {
    "Content-Type": "application/json",
    Authorization: authHeader,
  };

  let categoryId = 1;
  try {
    const catRes = await fetch(
      `${baseUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(article.category)}`,
      { headers: wpHeaders, signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) }
    );
    const cats = await catRes.json();
    if (cats.length > 0) {
      categoryId = cats[0].id;
    } else {
      const createCatRes = await fetch(`${baseUrl}/wp-json/wp/v2/categories`, {
        method: "POST",
        headers: wpHeaders,
        body: JSON.stringify({ name: article.category }),
        signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
      });
      if (createCatRes.ok) {
        const newCat = await createCatRes.json();
        categoryId = newCat.id;
      }
    }
  } catch {
    /* use default category */
  }

  const tagIds: number[] = [];
  const tagNames = Array.from(new Set([article.sourceTitle, ...article.tags].filter(Boolean))).slice(0, 5);
  for (const tagName of tagNames) {
    try {
      const tagRes = await fetch(
        `${baseUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(tagName)}`,
        { headers: wpHeaders, signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) }
      );
      const tags = await tagRes.json();
      if (tags.length > 0) {
        tagIds.push(tags[0].id);
      } else {
        const createTagRes = await fetch(`${baseUrl}/wp-json/wp/v2/tags`, {
          method: "POST",
          headers: wpHeaders,
          body: JSON.stringify({ name: tagName }),
          signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
        });
        if (createTagRes.ok) {
          const newTag = await createTagRes.json();
          tagIds.push(newTag.id);
        }
      }
    } catch {
      /* skip tag */
    }
  }

  const postData = {
    title: article.title,
    content: finalHtml,
    excerpt: article.excerpt,
    slug: article.slug,
    status: "publish",
    categories: [categoryId],
    tags: tagIds,
    meta: {
      _yoast_wpseo_title: article.metaTitle,
      _yoast_wpseo_metadesc: article.metaDescription,
    },
  };

  const postRes = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: wpHeaders,
    body: JSON.stringify(postData),
    signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
  });

  if (!postRes.ok) {
    const err = await postRes.text();
    throw new Error(`WP API ${postRes.status}: ${err.slice(0, 200)}`);
  }

  const post = await postRes.json();
  const postId = parsePositiveInt(post.id);
  const postUrl = normalizePublishedPostUrl(post.link, site, article.slug, postId);
  await warmPublishedUrls(baseUrl, postUrl);

  return {
    postId: postId || 0,
    postUrl,
    finalHtml,
  };
}

function resolvePublishedPostBySlug(
  site: SiteCredential,
  slug: string
): { postId: number; postUrl: string } | null {
  const target = resolveSiteTarget(site);
  const siteDir = getLocalSiteDir(site);
  const php = [
    `$slug = ${JSON.stringify(slug)};`,
    `$post = get_page_by_path($slug, OBJECT, 'post');`,
    `if (!$post) {`,
    `  $posts = get_posts(['name' => $slug, 'post_type' => 'post', 'post_status' => 'publish', 'numberposts' => 1]);`,
    `  $post = $posts[0] ?? null;`,
    `}`,
    `if (!$post) { exit(2); }`,
    `echo wp_json_encode(['postId' => (int)$post->ID, 'postUrl' => (string)get_permalink($post->ID)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);`,
  ].join(" ");

  try {
    const output = !isRemoteTarget(target)
      ? execFileSync("wp", ["eval", php, `--path=${siteDir}`, "--allow-root"], {
          encoding: "utf8",
          timeout: 45000,
        }).trim()
      : execSsh(
          target,
          `wp eval ${shellQuote(php)} --path=${shellQuote(siteDir)} --allow-root`,
          60000
        ).trim();
    const parsed = JSON.parse(output);
    const postId = parsePositiveInt(parsed.postId);
    if (!postId) return null;
    return {
      postId,
      postUrl: normalizePublishedPostUrl(parsed.postUrl, site, slug, postId),
    };
  } catch {
    return null;
  }
}

async function publishLocallyWithWpCli(
  article: GeneratedArticle,
  site: SiteCredential,
  finalHtml: string
): Promise<PublishResult> {
  const target = resolveSiteTarget(site);
  const siteDir = getLocalSiteDir(site);
  const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-publish-"));
  const payloadPath = join(tempDir, "payload.json");
  const scriptPath = join(tempDir, "publish-local.php");

  try {
    const remotePayloadPath = isRemoteTarget(target)
      ? `/tmp/wpbulk-publish-${Date.now()}-${Math.random().toString(36).slice(2)}/payload.json`
      : payloadPath;
    const remoteScriptPath = isRemoteTarget(target)
      ? remotePayloadPath.replace(/payload\.json$/, "publish-local.php")
      : scriptPath;

    writeFileSync(
      payloadPath,
      JSON.stringify({
        title: article.title,
        content: finalHtml,
        excerpt: article.excerpt,
        slug: article.slug,
        category: article.category,
        tags: Array.from(new Set([article.sourceTitle, ...article.tags].filter(Boolean))).slice(0, 5),
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
      })
    );

    writeFileSync(
      scriptPath,
      `<?php
$payload_path = ${JSON.stringify(remotePayloadPath)};
$payload = json_decode(file_get_contents($payload_path), true);
if (!is_array($payload)) {
  fwrite(STDERR, "invalid payload");
  exit(1);
}

$category_id = 1;
$category_name = trim((string)($payload['category'] ?? ''));
if ($category_name !== '') {
  $term = term_exists($category_name, 'category');
  if (!$term) {
    $term = wp_insert_term($category_name, 'category');
  }

  if (!is_wp_error($term)) {
    $category_id = (int)(is_array($term) ? ($term['term_id'] ?? 1) : $term);
  }
}

$tag_ids = [];
$tag_names = is_array($payload['tags'] ?? null) ? $payload['tags'] : [];
foreach ($tag_names as $tag_name) {
  $tag_name = trim((string)$tag_name);
  if ($tag_name === '') continue;

  $term = term_exists($tag_name, 'post_tag');
  if (!$term) {
    $term = wp_insert_term($tag_name, 'post_tag');
  }

  if (!is_wp_error($term)) {
    $tag_ids[] = (int)(is_array($term) ? ($term['term_id'] ?? 0) : $term);
  }
}

$post_id = wp_insert_post([
  'post_title' => (string)($payload['title'] ?? ''),
  'post_content' => (string)($payload['content'] ?? ''),
  'post_excerpt' => (string)($payload['excerpt'] ?? ''),
  'post_name' => (string)($payload['slug'] ?? ''),
  'post_status' => 'publish',
  'post_type' => 'post',
  'post_category' => [$category_id],
], true);

if (is_wp_error($post_id)) {
  fwrite(STDERR, $post_id->get_error_message());
  exit(1);
}

if (!empty($tag_ids)) {
  wp_set_post_terms($post_id, $tag_ids, 'post_tag');
}

$meta_title = trim((string)($payload['metaTitle'] ?? ''));
if ($meta_title !== '') {
  update_post_meta($post_id, '_yoast_wpseo_title', $meta_title);
}

$meta_desc = trim((string)($payload['metaDescription'] ?? ''));
if ($meta_desc !== '') {
  update_post_meta($post_id, '_yoast_wpseo_metadesc', $meta_desc);
}

echo wp_json_encode([
  'postId' => (int)$post_id,
  'postUrl' => get_permalink($post_id),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`
    );

    let output = "";
    if (!isRemoteTarget(target)) {
      output = execFileSync(
        "wp",
        ["eval-file", scriptPath, `--path=${siteDir}`, "--allow-root"],
        { encoding: "utf8", timeout: 45000 }
      ).trim();
    } else {
      const remoteTempDir = remotePayloadPath.replace(/\/payload\.json$/, "");
      execSsh(target, `mkdir -p ${shellQuote(remoteTempDir)}`, 15000);
      scpToTarget(target, payloadPath, remotePayloadPath, 30000);
      scpToTarget(target, scriptPath, remoteScriptPath, 30000);
      output = execSsh(
        target,
        `wp eval-file ${shellQuote(remoteScriptPath)} --path=${shellQuote(siteDir)} --allow-root`,
        60000
      ).trim();
      try {
        execSsh(target, `rm -rf ${shellQuote(remoteTempDir)}`, 15000);
      } catch {
        // ignore cleanup failures
      }
    }

    const parsed = JSON.parse(output);
    let postId = parsePositiveInt(parsed.postId) || 0;
    let postUrl = normalizePublishedPostUrl(parsed.postUrl, site, article.slug, postId);

    if (!postId || /undefined/i.test(postUrl)) {
      const recovered = resolvePublishedPostBySlug(site, article.slug);
      if (recovered) {
        postId = recovered.postId;
        postUrl = recovered.postUrl;
      }
    }

    if (!postId) {
      throw new Error("발행 결과 검증 실패: post ID를 확인할 수 없습니다.");
    }

    const baseUrl = getSiteBaseUrl(site);
    await warmPublishedUrls(baseUrl, postUrl);

    return {
      postId,
      postUrl,
      finalHtml,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── WordPress publish ────────────────────────────────────────────────────────

async function publishToWordPress(
  article: GeneratedArticle,
  site: SiteCredential,
  send: SendFn
): Promise<PublishResult> {
  const sanitizedArticle = sanitizeGeneratedArticle(article);
  const remoteProbe = await probeRemoteWordPress(site);
  const localWordPressAvailable = hasLocalWordPress(site);

  let uploadedMap = new Map<string, { id: number; url: string }>();
  if (remoteProbe.usable && sanitizedArticle.reviewImages && sanitizedArticle.reviewImages.length > 0) {
    uploadedMap = await uploadReviewImages(sanitizedArticle.reviewImages, site, send);
  }

  const replacedHtml = replacePlaceholders(sanitizedArticle.htmlContent, sanitizedArticle, uploadedMap);

  // 관련 글 내부 링크 추가 (Topical Authority 강화)
  const relatedPosts = await fetchRelatedPosts(site, sanitizedArticle.slug, sanitizedArticle.category);
  const relatedHtml = buildRelatedPostsHtml(relatedPosts);
  const finalHtml = buildFinalHtml(sanitizedArticle, site, replacedHtml + relatedHtml);

  if (!remoteProbe.usable) {
    if (!localWordPressAvailable) {
      throw new Error(`WP REST 연결 실패: ${remoteProbe.reason || "원격 사이트 응답 없음"}`);
    }

    send({
      type: "progress",
      articleId: article.id,
      siteSlug: article.siteSlug,
      message: `원격 WordPress 연결 실패, 로컬 WP-CLI로 우회 발행 중...`,
    });

    return publishLocallyWithWpCli(sanitizedArticle, site, finalHtml);
  }

  try {
    return await publishViaRestApi(sanitizedArticle, site, finalHtml);
  } catch (error) {
    if (!localWordPressAvailable) {
      throw error;
    }

    send({
      type: "progress",
      articleId: article.id,
      siteSlug: article.siteSlug,
      message: `원격 WordPress API 실패, 로컬 WP-CLI로 재시도 중...`,
    });

    return publishLocallyWithWpCli(sanitizedArticle, site, finalHtml);
  }
}

async function updateLlmsTxt(site: SiteCredential): Promise<void> {
  const baseUrl = getSiteBaseUrl(site);
  const authHeader = "Basic " + Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

  try {
    // 최근 글 50개 가져오기
    const res = await fetch(
      `${baseUrl}/wp-json/wp/v2/posts?per_page=50&_fields=title,link,excerpt&status=publish&orderby=date&order=desc`,
      { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return;

    const posts = await res.json() as Array<{ title: { rendered: string }; link: string; excerpt: { rendered: string } }>;

    const articleLines = posts
      .map(p => {
        const title = p.title.rendered.replace(/<[^>]*>/g, "");
        const desc = p.excerpt.rendered.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
        return `- [${title}](${p.link}): ${desc}`;
      })
      .join("\n");

    const llmsContent = `# ${site.title}
> ${site.persona?.name || site.admin_user}의 리뷰 사이트

## About
- Author: ${site.persona?.name || site.admin_user}
- Site: ${baseUrl}
- Content: Product reviews and buying guides in Korean
- Total Articles: ${posts.length}

## Articles
${articleLines}

## Navigation
- [Homepage](${baseUrl}): Latest reviews and recommendations
- [Sitemap](${baseUrl}/sitemap_index.xml): All published articles
`;

    const target = resolveSiteTarget(site);
    const siteDir = getLocalSiteDir(site);

    if (!isRemoteTarget(target) && existsSync(`${siteDir}/wp-config.php`)) {
      writeFileSync(`${siteDir}/llms.txt`, llmsContent);
      writeFileSync(`${siteDir}/llms-full.txt`, llmsContent);
      return;
    }

    if (isRemoteTarget(target)) {
      const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-llms-"));
      const localShortPath = join(tempDir, "llms.txt");
      const localFullPath = join(tempDir, "llms-full.txt");
      const remoteTempDir = `/tmp/wpbulk-llms-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      try {
        writeFileSync(localShortPath, llmsContent);
        writeFileSync(localFullPath, llmsContent);
        execSsh(target, `mkdir -p ${shellQuote(remoteTempDir)}`, 15000);
        scpToTarget(target, localShortPath, `${remoteTempDir}/llms.txt`, 30000);
        scpToTarget(target, localFullPath, `${remoteTempDir}/llms-full.txt`, 30000);
        execSsh(
          target,
          `sudo cp ${shellQuote(`${remoteTempDir}/llms.txt`)} ${shellQuote(`${siteDir}/llms.txt`)} && sudo cp ${shellQuote(`${remoteTempDir}/llms-full.txt`)} ${shellQuote(`${siteDir}/llms-full.txt`)} && sudo chown www-data:www-data ${shellQuote(`${siteDir}/llms.txt`)} ${shellQuote(`${siteDir}/llms-full.txt`)}`,
          30000
        );
      } finally {
        try {
          execSsh(target, `rm -rf ${shellQuote(remoteTempDir)}`, 15000);
        } catch {
          // ignore cleanup failures
        }
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  } catch {
    // best-effort
  }
}

async function warmPublishedUrls(baseUrl: string, postUrl: string): Promise<void> {
  const targets = Array.from(
    new Set([
      `${baseUrl}/`,
      `${baseUrl}/robots.txt`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/wp-sitemap.xml`,
      postUrl,
    ])
  );

  await Promise.allSettled(
    targets.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { "User-Agent": "WPBulkCacheWarmer/1.0" },
          signal: AbortSignal.timeout(12000),
        });
        await res.arrayBuffer();
      } catch {
        /* best-effort cache warm */
      }
    })
  );
}
// ── IndexNow key file deployment ─────────────────────────────────────────────

async function deployIndexNowKeyFile(site: SiteCredential): Promise<void> {
  const apiKey = getIndexNowApiKey();
  if (!apiKey) return;

  try {
    const target = resolveSiteTarget(site);
    const siteDir = getLocalSiteDir(site);
    const keyFileName = `${apiKey}.txt`;
    const keyFileContent = apiKey;

    if (!isRemoteTarget(target) && existsSync(`${siteDir}/wp-config.php`)) {
      writeFileSync(`${siteDir}/${keyFileName}`, keyFileContent);
      return;
    }

    if (isRemoteTarget(target)) {
      const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-indexnow-"));
      const localKeyPath = join(tempDir, keyFileName);

      try {
        writeFileSync(localKeyPath, keyFileContent);
        const remoteTmpPath = `/tmp/${keyFileName}`;
        scpToTarget(target, localKeyPath, remoteTmpPath, 15000);
        execSsh(
          target,
          `sudo cp ${shellQuote(remoteTmpPath)} ${shellQuote(`${siteDir}/${keyFileName}`)} && sudo chown www-data:www-data ${shellQuote(`${siteDir}/${keyFileName}`)} && rm -f ${shellQuote(remoteTmpPath)}`,
          15000
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }

    // 키 파일 접근성 검증
    const keyUrl = `https://${site.domain}/${keyFileName}`;
    try {
      const resp = await fetch(keyUrl, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) {
        console.warn(`[IndexNow] 키 파일 검증 실패: ${keyUrl} → HTTP ${resp.status}`);
      }
    } catch (verifyErr) {
      console.warn(`[IndexNow] 키 파일 접근 불가: ${keyUrl} — ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`);
    }
  } catch (err) {
    console.warn(`[IndexNow] 키 파일 배포 실패 (${site.domain}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function publishArticlesRoutes(app: FastifyInstance) {
  app.post("/publish-articles", async (req, reply) => {
    const { articles, sites } = req.body as {
      articles: GeneratedArticle[];
      sites: SiteCredential[];
    };

    if (!articles?.length || !sites?.length) {
      return reply.status(400).send({ error: "글과 사이트 정보가 필요합니다." });
    }

    const siteMap = new Map<string, SiteCredential>();
    for (const s of sites) siteMap.set(s.slug, s);

    const { send, close } = setupSSE(reply);

    try {
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        const site = siteMap.get(article.siteSlug);

        if (!site) {
          send({
            type: "error",
            articleId: article.id,
            siteSlug: article.siteSlug,
            message: `사이트 ${article.siteSlug} 정보를 찾을 수 없습니다.`,
          });
          continue;
        }

        send({
          type: "progress",
          articleId: article.id,
          current: i + 1,
          total: articles.length,
          message: `[${i + 1}/${articles.length}] ${site.title}에 발행 중...`,
        });

        try {
          const result = await publishToWordPress(article, site, send);
          const publishedPost = buildDashboardPostEntry(article, result);
          await updateDashboardSiteCache(article.siteSlug, (current) => {
            const existingPosts = current.posts.filter(
              (post) => post.id !== publishedPost.id && post.link !== publishedPost.link
            );
            const nextPosts = [publishedPost, ...existingPosts].slice(0, 15);
            const nextTotalCount =
              current.posts.some((post) => post.id === publishedPost.id || post.link === publishedPost.link)
                ? current.totalCount
                : current.totalCount + 1;

            return {
              posts: nextPosts,
              totalCount: Math.max(nextTotalCount, nextPosts.length),
              cachedAt: Date.now(),
              error: false,
            };
          });
          if (isBingWebmasterSyncEnabled()) {
            // 서브도메인 sitemap을 루트 도메인 siteUrl로 Bing에 제출
            try {
              const postOrigin = new URL(result.postUrl).origin;
              const postHost = new URL(result.postUrl).hostname;
              const domainParts = postHost.split(".");
              const rootDomain = domainParts.length > 2
                ? domainParts.slice(-2).join(".")
                : postHost;
              const bingSiteUrl = `https://${rootDomain}`;
              // 루트 도메인 등록 + 서브도메인 sitemap 제출
              await syncBingSite(bingSiteUrl);
              if (postOrigin !== bingSiteUrl) {
                await syncBingSite(postOrigin).catch(() => {});
              }
            } catch {
              // IndexNow가 주요 색인 경로이므로 Bing API 실패는 무시
            }
          }
          // IndexNow — 즉시 색인 요청 (Bing, Yandex, Naver 등)
          if (isIndexNowEnabled()) {
            try {
              const host = new URL(result.postUrl).host;
              const indexNowResult = await submitIndexNow([result.postUrl], host);
              if (indexNowResult.success) {
                send({
                  type: "progress",
                  articleId: article.id,
                  siteSlug: article.siteSlug,
                  message: `IndexNow 색인 요청 완료 (${indexNowResult.statusCode})`,
                });
              } else if (indexNowResult.error) {
                send({
                  type: "progress",
                  articleId: article.id,
                  siteSlug: article.siteSlug,
                  message: `IndexNow 경고: ${indexNowResult.error}`,
                });
              }
            } catch {
              // IndexNow is best-effort, don't block publish
            }
          }
          send({
            type: "published",
            articleId: article.id,
            siteSlug: article.siteSlug,
            postId: result.postId,
            postUrl: result.postUrl,
            message: `${site.title} 발행 완료`,
          });
        } catch (error) {
          send({
            type: "error",
            articleId: article.id,
            siteSlug: article.siteSlug,
            message: `${site.title} 발행 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
          });
        }
      }

      // 발행 완료 후 각 사이트의 llms.txt 갱신 + IndexNow 키 파일 배포
      const updatedSites = new Set<string>();
      for (const a of articles) {
        if (!updatedSites.has(a.siteSlug)) {
          const site = siteMap.get(a.siteSlug);
          if (site) {
            await updateLlmsTxt(site);
            if (isIndexNowEnabled()) {
              await deployIndexNowKeyFile(site);
            }
            updatedSites.add(a.siteSlug);
          }
        }
      }

      send({
        type: "done",
        message: "모든 발행 완료",
      });
    } finally {
      close();
    }
  });
}
