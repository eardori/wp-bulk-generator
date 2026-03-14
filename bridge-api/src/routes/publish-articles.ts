import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "os";
import { join } from "path";
import { setupSSE } from "../utils/sse.js";
import { sanitizeGeneratedArticle } from "../lib/article-sanitizer.js";
import { updateDashboardSiteCache } from "../lib/dashboard-cache.js";
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
  const escapedUrl = url.replace(/'/g, "'\\''");
  const cmd = [
    "curl", "-s", "-L", "--max-time", "20",
    "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "-H", "Referer: https://smartstore.naver.com/",
    `'${escapedUrl}'`,
  ].join(" ");
  const result = execSync(cmd, { timeout: 25000, maxBuffer: 20 * 1024 * 1024, encoding: "buffer" });
  if (!result || result.length < 100) throw new Error("Empty image response");
  return result;
}

async function uploadToWordPress(
  buffer: Buffer,
  filename: string,
  contentType: string,
  site: SiteCredential
): Promise<{ id: number; url: string }> {
  const baseUrl = site.url.replace(/\/$/, "");
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
      ? `${article.sourceTitle} 실제 구매자 리뷰 사진 ${imgCounter}`
      : `실제 구매자 리뷰 사진 ${imgCounter}`;
    const captionText = article.sourceTitle
      ? `${article.sourceTitle} 실제 사용 사진`
      : `실제 구매자 리뷰 사진`;

    return `<figure class="review-image"><img src="${imgUrl}" alt="${altText}" loading="lazy" /><figcaption>${captionText}</figcaption></figure>`;
  });
}

function getLocalSiteDir(site: SiteCredential): string {
  return join(WP_SITES_ROOT, site.slug);
}

function hasLocalWordPress(site: SiteCredential): boolean {
  return existsSync(join(getLocalSiteDir(site), "wp-config.php"));
}

async function probeRemoteWordPress(site: SiteCredential): Promise<{
  usable: boolean;
  reason?: string;
}> {
  const baseUrl = site.url.replace(/\/$/, "");

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
  let finalHtml = replacedHtml;

  if (article.faqSchema && article.faqSchema.length > 0) {
    const faqJsonLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": article.faqSchema.map((faq) => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer,
        },
      })),
    };
    finalHtml += `\n<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>`;
  }

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": article.title,
    "description": article.metaDescription || article.excerpt,
    "author": {
      "@type": "Person",
      "name": site.persona?.name || site.admin_user,
      ...(site.persona?.expertise ? { "jobTitle": `${site.persona.expertise} 리뷰어` } : {}),
      ...(site.persona?.concern ? { "knowsAbout": site.persona.concern } : {}),
      ...(site.persona?.bio ? { "description": site.persona.bio } : {}),
    },
    "datePublished": new Date().toISOString(),
    "dateModified": new Date().toISOString(),
    "publisher": {
      "@type": "Organization",
      "name": site.title,
    },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": [".summary-box", "h2"],
    },
    ...(article.tags?.length > 0 ? { "keywords": article.tags.join(", ") } : {}),
  };
  finalHtml += `\n<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>`;

  // Product + Review 스키마 (GEO: 상품 리뷰 글에 구조화된 평점/가격 데이터 제공)
  const productReviewJsonLd = buildProductReviewSchema(article, site);
  if (productReviewJsonLd) {
    finalHtml += `\n<script type="application/ld+json">${JSON.stringify(productReviewJsonLd)}</script>`;
  }

  return finalHtml;
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
  const baseUrl = site.url.replace(/\/$/, "");
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
  const baseUrl = site.url.replace(/\/$/, "");
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
  const postUrl = post.link || `${baseUrl}/?p=${post.id}`;
  await warmPublishedUrls(baseUrl, postUrl);

  return {
    postId: post.id,
    postUrl,
    finalHtml,
  };
}

async function publishLocallyWithWpCli(
  article: GeneratedArticle,
  site: SiteCredential,
  finalHtml: string
): Promise<PublishResult> {
  const siteDir = getLocalSiteDir(site);
  const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-publish-"));
  const payloadPath = join(tempDir, "payload.json");
  const scriptPath = join(tempDir, "publish-local.php");

  try {
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
$payload_path = ${JSON.stringify(payloadPath)};
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

    const output = execFileSync(
      "wp",
      ["eval-file", scriptPath, `--path=${siteDir}`, "--allow-root"],
      { encoding: "utf8", timeout: 45000 }
    ).trim();

    const parsed = JSON.parse(output);
    const baseUrl = site.url.replace(/\/$/, "");
    const postUrl = parsed.postUrl || `${baseUrl}/?p=${parsed.postId}`;
    await warmPublishedUrls(baseUrl, postUrl);

    return {
      postId: Number(parsed.postId),
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
  const baseUrl = site.url.replace(/\/$/, "");
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

    const siteDir = `${WP_SITES_ROOT}/${site.slug}`;
    if (existsSync(`${siteDir}/wp-config.php`)) {
      writeFileSync(`${siteDir}/llms.txt`, llmsContent);
      writeFileSync(`${siteDir}/llms-full.txt`, llmsContent);
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

      // 발행 완료 후 각 사이트의 llms.txt 갱신
      const updatedSites = new Set<string>();
      for (const a of articles) {
        if (!updatedSites.has(a.siteSlug)) {
          const site = siteMap.get(a.siteSlug);
          if (site) {
            await updateLlmsTxt(site);
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
