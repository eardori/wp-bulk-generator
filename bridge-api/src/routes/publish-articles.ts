import { execSync } from "child_process";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";
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

// ── WordPress publish ────────────────────────────────────────────────────────

async function publishToWordPress(
  article: GeneratedArticle,
  site: SiteCredential,
  send: SendFn
): Promise<PublishResult> {
  const baseUrl = site.url.replace(/\/$/, "");
  const authHeader =
    "Basic " +
    Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

  const wpHeaders = {
    "Content-Type": "application/json",
    Authorization: authHeader,
  };

  // Upload review images first
  let uploadedMap = new Map<string, { id: number; url: string }>();
  if (article.reviewImages && article.reviewImages.length > 0) {
    uploadedMap = await uploadReviewImages(article.reviewImages, site, send);
  }

  // Replace image placeholders in HTML content
  const replacedHtml = replacePlaceholders(article.htmlContent, article, uploadedMap);

  // SEO: FAQ JSON-LD + Article Schema.org
  let finalHtml = replacedHtml;

  // FAQ Schema
  if (article.faqSchema && article.faqSchema.length > 0) {
    const faqJsonLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": article.faqSchema.map(faq => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer
        }
      }))
    };
    finalHtml += `\n<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>`;
  }

  // Article Schema (GEO 강화: author persona + speakable)
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
      "name": site.title
    },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": [".summary-box", "h2"]
    },
    ...(article.tags?.length > 0 ? { "keywords": article.tags.join(", ") } : {})
  };
  finalHtml += `\n<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>`;

  // 1. Ensure category exists
  let categoryId = 1;
  try {
    const catRes = await fetch(
      `${baseUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(article.category)}`,
      { headers: wpHeaders }
    );
    const cats = await catRes.json();
    if (cats.length > 0) {
      categoryId = cats[0].id;
    } else {
      const createCatRes = await fetch(`${baseUrl}/wp-json/wp/v2/categories`, {
        method: "POST",
        headers: wpHeaders,
        body: JSON.stringify({ name: article.category }),
      });
      if (createCatRes.ok) {
        const newCat = await createCatRes.json();
        categoryId = newCat.id;
      }
    }
  } catch {
    /* use default category */
  }

  // 2. Create tags
  const tagIds: number[] = [];
  const tagNames = Array.from(new Set([article.sourceTitle, ...article.tags].filter(Boolean))).slice(0, 5);
  for (const tagName of tagNames) {
    try {
      const tagRes = await fetch(
        `${baseUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(tagName)}`,
        { headers: wpHeaders }
      );
      const tags = await tagRes.json();
      if (tags.length > 0) {
        tagIds.push(tags[0].id);
      } else {
        const createTagRes = await fetch(`${baseUrl}/wp-json/wp/v2/tags`, {
          method: "POST",
          headers: wpHeaders,
          body: JSON.stringify({ name: tagName }),
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

  // 3. Create post
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

      send({
        type: "done",
        message: "모든 발행 완료",
      });
    } finally {
      close();
    }
  });
}
