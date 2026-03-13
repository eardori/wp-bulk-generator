import * as cheerio from "cheerio";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";
import { fetchCredentials } from "../lib/ec2-client.js";

// ── Types ────────────────────────────────────────────────────────────────────

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

type WPPost = {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  link: string;
  date: string;
  modified?: string;
  slug: string;
  categories: number[];
  tags: number[];
  meta?: Record<string, string>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function stripJsonLdScripts(html: string): string {
  const $ = cheerio.load(html, null, false);
  $('script[type="application/ld+json"]').remove();
  return $.root().html()?.trim() || "";
}

function jsonLdSignature(html: string): string {
  const $ = cheerio.load(html, null, false);
  const chunks: string[] = [];

  $('script[type="application/ld+json"]').each((_, script) => {
    const raw = $(script).html()?.trim();
    if (!raw) return;
    try {
      chunks.push(JSON.stringify(JSON.parse(raw)));
    } catch {
      chunks.push(raw.replace(/\s+/g, " "));
    }
  });

  return chunks.join("\n");
}

function normalizeHtmlSignature(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}

function buildSchemaBlocks(
  post: WPPost,
  site: SiteCredential,
  contentHtml: string
): string {
  let schemas = "";
  const plainTitle = stripHtml(post.title.rendered);
  const plainExcerpt = stripHtml(post.excerpt.rendered).slice(0, 160);

  // Article Schema (GEO 강화: author persona + speakable)
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": plainTitle,
    "description": plainExcerpt,
    "author": {
      "@type": "Person",
      "name": site.persona?.name || site.admin_user,
      ...(site.persona?.expertise ? { "jobTitle": `${site.persona.expertise} 리뷰어` } : {}),
      ...(site.persona?.concern ? { "knowsAbout": site.persona.concern } : {}),
      ...(site.persona?.bio ? { "description": site.persona.bio } : {}),
    },
    "datePublished": post.date,
    "dateModified": post.modified || post.date,
    "publisher": {
      "@type": "Organization",
      "name": site.title
    },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": [".summary-box", "h2"]
    },
    "url": post.link
  };
  schemas += `\n<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>`;

  // FAQ Schema — extract FAQ patterns from post content
  const $ = cheerio.load(contentHtml, null, false);
  const faqItems: Array<{ question: string; answer: string }> = [];

  // Pattern 1: dl dt/dd
  $("dl dt").each((_, dt) => {
    const question = $(dt).text().trim();
    const answer = $(dt).next("dd").text().trim();
    if (question && answer) faqItems.push({ question, answer });
  });

  // Pattern 2: h3 + p (FAQ-style question-answer)
  if (faqItems.length === 0) {
    $("h3").each((_, h3) => {
      const text = $(h3).text().trim();
      if (text.includes("?") || text.includes("\uFF1F")) {
        const nextP = $(h3).next("p").text().trim();
        if (nextP.length > 20) {
          faqItems.push({ question: text, answer: nextP.slice(0, 300) });
        }
      }
    });
  }

  // Pattern 3: strong tag questions
  if (faqItems.length === 0) {
    $("p strong").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("?") || text.includes("\uFF1F")) {
        const parentP = $(el).closest("p");
        const nextP = parentP.next("p").text().trim();
        if (nextP.length > 20) {
          faqItems.push({ question: text, answer: nextP.slice(0, 300) });
        }
      }
    });
  }

  if (faqItems.length > 0) {
    const faqJsonLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqItems.slice(0, 10).map(faq => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer
        }
      }))
    };
    schemas += `\n<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>`;
  }

  // Product + Review 스키마 (GEO: LLM이 상품 평점/가격 인용 가능)
  const productSchema = buildProductSchemaFromPost(post, site, contentHtml);
  if (productSchema) {
    schemas += `\n<script type="application/ld+json">${JSON.stringify(productSchema)}</script>`;
  }

  return schemas;
}

function buildProductSchemaFromPost(
  post: WPPost,
  site: SiteCredential,
  contentHtml: string
): Record<string, unknown> | null {
  const plainTitle = stripHtml(post.title.rendered);

  // 가격 추출
  const priceMatches = contentHtml.match(/(\d{1,3}(?:,\d{3})*)\s*원/g);
  // 평점 추출
  const ratingMatch = contentHtml.match(/(\d(?:\.\d)?)\s*(?:점|\/\s*5)/);

  // 가격이나 평점이 없으면 상품 리뷰 글이 아닐 가능성 → 스킵
  if (!priceMatches && !ratingMatch) return null;

  const review: Record<string, unknown> = {
    "@type": "Review",
    "author": {
      "@type": "Person",
      "name": site.persona?.name || site.admin_user,
    },
    "reviewBody": stripHtml(post.excerpt.rendered).slice(0, 200),
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
    "name": plainTitle.replace(/\s*(추천|비교|리뷰|TOP\s*\d+|순위|가이드).*$/i, "").trim() || plainTitle,
    "description": stripHtml(post.excerpt.rendered).slice(0, 160),
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

function improveImageAlts(html: string, postTitle: string): string {
  const $ = cheerio.load(html, null, false);
  const plainTitle = stripHtml(postTitle);
  let imgCounter = 0;

  $("img").each((_, img) => {
    const currentAlt = $(img).attr("alt") || "";
    const isGeneric = !currentAlt
      || currentAlt === "실제 구매자 리뷰 사진"
      || currentAlt === "image"
      || currentAlt.length < 3;

    if (isGeneric) {
      imgCounter++;
      $(img).attr("alt", `${plainTitle} 관련 이미지 ${imgCounter}`);
    }
  });

  // figure > figcaption improvement
  $("figure figcaption").each((_, cap) => {
    const text = $(cap).text().trim();
    if (text === "실제 구매자 리뷰 사진" || !text) {
      $(cap).text(`${plainTitle} 실제 사용 사진`);
    }
  });

  return $.html();
}

// ── llms-full.txt ────────────────────────────────────────────────────────────

async function updateLlmsFullTxt(site: SiteCredential, posts: WPPost[]): Promise<void> {
  const baseUrl = site.url.replace(/\/$/, "");
  const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

  const articleLines = posts
    .slice(0, 50)
    .map(p => {
      const title = stripHtml(p.title.rendered);
      const desc = stripHtml(p.excerpt.rendered).slice(0, 80);
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

  // WP REST API로 llms-full.txt 업데이트 (wp-cli가 있으면 파일 직접 쓰기)
  const WP_SITES_ROOT = process.env.WP_SITES_ROOT || "/var/www";
  const siteDir = `${WP_SITES_ROOT}/${site.slug}`;
  try {
    const { existsSync, writeFileSync } = await import("fs");
    if (existsSync(`${siteDir}/wp-config.php`)) {
      writeFileSync(`${siteDir}/llms-full.txt`, llmsContent);
      // 기존 llms.txt도 갱신
      writeFileSync(`${siteDir}/llms.txt`, llmsContent);
    }
  } catch {
    // best-effort
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function seoOptimizeRoutes(app: FastifyInstance) {
  app.post("/seo-optimize", async (req, reply) => {
    const { siteSlug, sites: sitesList } = req.body as {
      siteSlug?: string;
      sites?: string[];
    };

    // EC2 Agent에서 credentials (persona 병합 포함) 가져오기
    const allSitesRaw = await fetchCredentials();
    const allSites = allSitesRaw as unknown as SiteCredential[];

    // Filter sites based on request
    const slugFilter = sitesList || (siteSlug ? [siteSlug] : []);
    const sites = allSites
      .filter(s => slugFilter.length === 0 || slugFilter.includes(s.slug));

    if (sites.length === 0) {
      return reply.status(400).send({ error: "사이트를 찾을 수 없습니다." });
    }

    const { send, close } = setupSSE(reply);

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalError = 0;

    try {
      for (const site of sites) {
        const baseUrl = site.url.replace(/\/$/, "");
        const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
        const headers = {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        };

        send({
          type: "site-start",
          slug: site.slug,
          title: site.title,
          message: `${site.title} SEO 최적화 시작...`,
        });

        // Get total post count
        let totalPosts = 0;
        try {
          const countRes = await fetch(
            `${baseUrl}/wp-json/wp/v2/posts?per_page=1&_fields=id&status=publish`,
            { headers, cache: "no-store" }
          );
          totalPosts = parseInt(countRes.headers.get("X-WP-Total") || "0", 10);
        } catch {
          send({ type: "error", slug: site.slug, message: `${site.title} 접근 실패` });
          totalError++;
          continue;
        }

        if (totalPosts === 0) {
          send({ type: "site-done", slug: site.slug, message: `${site.title}: 글 없음`, updated: 0, skipped: 0 });
          continue;
        }

        // 전체 글 목록 수집 (내부 링크 + llms-full.txt용)
        const allSitePosts: WPPost[] = [];
        const PER_PAGE = 10;
        let siteUpdated = 0;
        let siteSkipped = 0;

        for (let prefetchPage = 1; prefetchPage <= Math.ceil(totalPosts / PER_PAGE); prefetchPage++) {
          try {
            const res = await fetch(
              `${baseUrl}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${prefetchPage}&_fields=id,title,content,excerpt,link,date,modified,slug,categories,tags&status=publish`,
              { headers, cache: "no-store" }
            );
            if (!res.ok) break;
            const posts = await res.json() as WPPost[];
            allSitePosts.push(...posts);
          } catch {
            break;
          }
        }

        for (const post of allSitePosts) {
            const plainTitle = stripHtml(post.title.rendered);
            const contentWithoutSchemas = stripJsonLdScripts(post.content.rendered);

            // 기존 related-posts div 제거 후 재생성
            const $ = cheerio.load(contentWithoutSchemas, null, false);
            $(".related-posts").remove();
            const cleanedContent = $.html() || contentWithoutSchemas;

            // 관련 글 내부 링크 생성
            const relatedPosts = allSitePosts
              .filter(p => p.id !== post.id)
              .filter(p => {
                const sharedCats = p.categories.filter(c => post.categories.includes(c));
                const sharedTags = p.tags.filter(t => post.tags.includes(t));
                return sharedCats.length > 0 || sharedTags.length > 0;
              })
              .slice(0, 3);

            let relatedHtml = "";
            if (relatedPosts.length > 0) {
              const links = relatedPosts
                .map(p => `<li><a href="${p.link}">${stripHtml(p.title.rendered)}</a></li>`)
                .join("\n");
              relatedHtml = `\n<div class="related-posts" style="margin-top:2em;padding:1.2em;background:#f8f9fa;border-radius:8px;">\n<h3>관련 글 추천</h3>\n<ul>${links}</ul>\n</div>`;
            }

            // 기존 JSON-LD를 제거한 뒤 최신 GEO schema를 다시 주입한다.
            const improvedContent = improveImageAlts(cleanedContent, post.title.rendered) + relatedHtml;
            const schemaBlocks = buildSchemaBlocks(post, site, improvedContent);
            const currentSchemaSignature = jsonLdSignature(post.content.rendered);
            const desiredSchemaSignature = jsonLdSignature(schemaBlocks);
            const contentUnchanged =
              normalizeHtmlSignature(contentWithoutSchemas) === normalizeHtmlSignature(improvedContent);

            if (contentUnchanged && currentSchemaSignature === desiredSchemaSignature) {
              siteSkipped++;
              totalSkipped++;
              send({
                type: "skip",
                slug: site.slug,
                postId: post.id,
                title: plainTitle,
                message: `⏭ "${plainTitle}" — 최신 GEO 적용 상태`,
              });
              continue;
            }

            // Final content: improved content + schema
            const updatedContent = improvedContent + schemaBlocks;

            // Generate Yoast meta (if empty)
            const metaTitle = plainTitle.length <= 60
              ? plainTitle
              : plainTitle.slice(0, 57) + "...";
            const metaDesc = stripHtml(post.excerpt.rendered).slice(0, 155);

            // Update via WP REST API
            try {
              const updateRes = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${post.id}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                  content: updatedContent,
                  meta: {
                    _yoast_wpseo_title: metaTitle,
                    _yoast_wpseo_metadesc: metaDesc,
                  },
                }),
              });

              if (updateRes.ok) {
                siteUpdated++;
                totalUpdated++;
                send({
                  type: "updated",
                  slug: site.slug,
                  postId: post.id,
                  title: plainTitle,
                  message: `✅ "${plainTitle}" — GEO schema 갱신 + alt 태그 개선`,
                });
              } else {
                const err = await updateRes.text();
                totalError++;
                send({
                  type: "error",
                  slug: site.slug,
                  postId: post.id,
                  title: plainTitle,
                  message: `❌ "${plainTitle}" 업데이트 실패: ${err.slice(0, 100)}`,
                });
              }
            } catch (error) {
              totalError++;
              send({
                type: "error",
                slug: site.slug,
                postId: post.id,
                title: plainTitle,
                message: `❌ "${plainTitle}" 오류: ${error instanceof Error ? error.message : "알 수 없음"}`,
              });
            }
        }

        // llms-full.txt 갱신 (글 목록 포함)
        await updateLlmsFullTxt(site, allSitePosts);

        send({
          type: "site-done",
          slug: site.slug,
          title: site.title,
          message: `${site.title}: ${siteUpdated}개 업데이트, ${siteSkipped}개 스킵`,
          updated: siteUpdated,
          skipped: siteSkipped,
        });
      }

      send({
        type: "done",
        message: `완료! 총 ${totalUpdated}개 업데이트, ${totalSkipped}개 스킵, ${totalError}개 오류`,
        totalUpdated,
        totalSkipped,
        totalError,
      });
    } finally {
      close();
    }
  });
}
