import type { FastifyInstance } from "fastify";
import * as cheerio from "cheerio";
import { setupSSE } from "../utils/sse.js";
import { buildBusinessSchemaFromHtml, stripReviewReferenceMarkers } from "../lib/business-schema.js";

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
    expertise?: string;
    concern?: string;
    bio?: string;
    age?: number;
    tone?: string;
  };
};

type SendFn = (data: Record<string, unknown>) => void;

const REMOTE_FETCH_TIMEOUT_MS = Number(process.env.WP_REMOTE_FETCH_TIMEOUT_MS || 20000);

function getSiteBaseUrl(site: SiteCredential): string {
  const raw = site.url?.trim() || site.domain?.trim() || "";
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

// ── Schema Helpers ───────────────────────────────────────────────────────────

function stripExistingJsonLd(html: string): string {
  return html.replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
}

function stripExistingEnhancements(html: string): string {
  let cleaned = html;
  // 기존 TOC 제거
  cleaned = cleaned.replace(/<nav\s+class="toc-box"[^>]*>[\s\S]*?<\/nav>/gi, "");
  // 기존 Author Bio 제거
  cleaned = cleaned.replace(/<div\s+class="author-bio"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "");
  // 기존 Last Updated 제거
  cleaned = cleaned.replace(/<p\s+class="last-updated"[^>]*>[\s\S]*?<\/p>/gi, "");
  // 기존 JSON-LD 제거
  cleaned = stripExistingJsonLd(cleaned);
  return cleaned.trim();
}

function buildTableOfContents(html: string): string {
  const $ = cheerio.load(html, null, false);
  const headings: Array<{ text: string; id: string }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("h2").each((_: number, el: any) => {
    const text = $(el).text().trim();
    if (!text) return;
    if (/Q&A|FAQ|자주 묻는/i.test(text)) return;

    const id = text
      .replace(/[^\w가-힣\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 50);

    $(el).attr("id", id);
    headings.push({ text, id });
  });

  if (headings.length < 3) return "";

  const tocItems = headings
    .map(h => `<li><a href="#${h.id}" style="color:#3498db;text-decoration:none;">${h.text}</a></li>`)
    .join("\n");

  return `<nav class="toc-box" style="background:#f0f4f8;border:1px solid #dde3ea;padding:16px 20px;margin:20px 0;border-radius:10px;">
<strong style="display:block;margin-bottom:8px;font-size:1.05em;">📑 목차</strong>
<ol style="margin:0;padding-left:20px;line-height:1.8;">${tocItems}</ol>
</nav>`;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHowToSchema(html: string, articleTitle: string): Record<string, unknown> | null {
  const $ = cheerio.load(html, null, false);
  const howToSteps: Array<{ name: string; text: string }> = [];
  let howToName = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("h2").each((_: number, h2El: any) => {
    const h2Text = $(h2El).text().trim();
    if (!/(사용법|사용 방법|사용 순서|이용 방법|사용 팁|활용법|how\s*to)/i.test(h2Text)) return;

    howToName = h2Text;
    const ol = $(h2El).nextAll("ol").first();
    if (ol.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ol.find("li").each((idx: number, liEl: any) => {
      const stepText = $(liEl).text().trim();
      if (stepText) {
        howToSteps.push({ name: `단계 ${idx + 1}`, text: stepText });
      }
    });

    if (howToSteps.length > 0) return false;
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

function enhanceFaqMicrodata(html: string): string {
  if (!html.includes("<details>") && !html.includes("<details ")) return html;
  if (html.includes('itemtype="https://schema.org/FAQPage"')) return html;

  const $ = cheerio.load(html, null, false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let faqSection: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("h2").each((_: number, h2El: any) => {
    const text = $(h2El).text();
    if (/FAQ|자주 묻는|질문|Q&A/i.test(text)) {
      faqSection = $(h2El);
      return false;
    }
  });

  if (!faqSection) return html;

  const details = faqSection.nextAll("details");
  if (details.length === 0) return html;

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

    const answerP = $detail.find("p").first();
    if (answerP.length) {
      answerP.wrap('<div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer"></div>');
      answerP.attr("itemprop", "text");
    }
  });

  return $.html();
}

function extractFaqFromHtml(html: string): Array<{ question: string; answer: string }> {
  const $ = cheerio.load(html, null, false);
  const faqs: Array<{ question: string; answer: string }> = [];

  $("details").each((_: number, el: any) => {
    const question = $(el).find("summary").text().trim();
    const answer = $(el).find("p").first().text().trim();
    if (question && answer) {
      faqs.push({ question, answer });
    }
  });

  return faqs;
}

/**
 * 기존 글에 AEO 보강 요소를 주입하는 핵심 함수
 */
function applyAeoEnhancements(
  html: string,
  site: SiteCredential,
  postTitle: string,
  postSlug: string,
  postCategory: string,
  postExcerpt: string,
  postLink: string,
): string {
  const baseUrl = getSiteBaseUrl(site);
  const canonicalUrl = postLink || `${baseUrl}/${postSlug}/`;
  const now = new Date();

  // 1. 기존 보강 요소 제거 (중복 방지)
  let content = stripExistingEnhancements(html);
  content = enhanceFaqMicrodata(content);

  // 2. 목차 삽입
  const tocHtml = buildTableOfContents(content);
  if (tocHtml) {
    const summaryBoxEnd = content.indexOf('</div>', content.indexOf('class="summary-box"'));
    if (summaryBoxEnd > 0) {
      const insertAt = summaryBoxEnd + '</div>'.length;
      content = content.slice(0, insertAt) + '\n' + tocHtml + content.slice(insertAt);
    } else {
      const firstH2 = content.indexOf('<h2');
      if (firstH2 > 0) {
        content = content.slice(0, firstH2) + tocHtml + '\n' + content.slice(firstH2);
      }
    }
  }

  // 3. Author Bio 삽입
  const authorBioHtml = buildAuthorBioHtml(site);
  if (authorBioHtml) {
    const faqPos = content.indexOf('<h2>Q&A') > -1 ? content.indexOf('<h2>Q&A') :
                   content.indexOf('<h2>자주 묻는') > -1 ? content.indexOf('<h2>자주 묻는') : -1;
    const relatedPos = content.indexOf('class="related-posts"');
    const insertBefore = faqPos > 0 ? faqPos : relatedPos > 0 ? content.lastIndexOf('<div', relatedPos) : -1;
    if (insertBefore > 0) {
      content = content.slice(0, insertBefore) + authorBioHtml + '\n' + content.slice(insertBefore);
    } else {
      content += '\n' + authorBioHtml;
    }
  }

  // 4. Last Updated 날짜
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  const isoDate = now.toISOString().split('T')[0];
  content += `\n<p class="last-updated" style="color:#888;font-size:0.85em;margin-top:2em;text-align:right;">마지막 업데이트: <time datetime="${isoDate}">${dateStr}</time></p>`;

  // 5. FAQ JSON-LD
  const faqs = extractFaqFromHtml(content);
  if (faqs.length > 0) {
    const faqJsonLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map(faq => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": { "@type": "Answer", "text": faq.answer },
      })),
    };
    content += `\n<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>`;
  }

  // 6. Article JSON-LD
  const authorUrl = `${baseUrl}/author/${(site.admin_user || "admin").toLowerCase()}/`;
  const articleJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": postTitle,
    "description": postExcerpt,
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
    "publisher": { "@type": "Organization", "name": site.title, "url": baseUrl },
    "speakable": { "@type": "SpeakableSpecification", "cssSelector": [".summary-box", "h2", "h2 + p"] },
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl },
    "url": canonicalUrl,
  };
  content += `\n<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>`;

  // 7. BreadcrumbList JSON-LD
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": site.title || "홈", "item": baseUrl },
      ...(postCategory ? [{ "@type": "ListItem", "position": 2, "name": postCategory, "item": `${baseUrl}/category/${encodeURIComponent(postCategory)}/` }] : []),
      { "@type": "ListItem", "position": postCategory ? 3 : 2, "name": postTitle, "item": canonicalUrl },
    ],
  };
  content += `\n<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>`;

  // 8. HowTo JSON-LD
  const howToJsonLd = buildHowToSchema(content, postTitle);
  if (howToJsonLd) {
    content += `\n<script type="application/ld+json">${JSON.stringify(howToJsonLd)}</script>`;
  }

  // 9. Business / Product Schema
  const businessJsonLd = buildBusinessSchemaFromHtml({
    title: postTitle,
    excerpt: postExcerpt,
    contentHtml: content,
    url: canonicalUrl,
  });
  if (businessJsonLd) {
    content += `\n<script type="application/ld+json">${JSON.stringify(businessJsonLd)}</script>`;
  }

  return content;
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function backfillAeoRoutes(app: FastifyInstance) {
  app.post("/backfill-aeo", async (request, reply) => {
    const body = request.body as {
      site: SiteCredential;
      dryRun?: boolean;
      maxPosts?: number;
    };

    if (!body.site) {
      return reply.status(400).send({ error: "site 정보가 필요합니다." });
    }

    const site = body.site;
    const dryRun = body.dryRun || false;
    const maxPosts = body.maxPosts || 100;
    const { send, close } = setupSSE(reply);

    try {
      const baseUrl = getSiteBaseUrl(site);
      const authHeader = "Basic " + Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");

      send({ type: "progress", message: `${baseUrl} 에서 기존 글 목록을 가져오는 중...` });

      // 페이지네이션으로 모든 글 가져오기
      type WpPost = { id: number; title: { rendered: string }; content: { rendered: string }; slug: string; link: string; excerpt: { rendered: string }; categories: number[] };
      let allPosts: WpPost[] = [];
      let page = 1;
      const perPage = 50;

      while (allPosts.length < maxPosts) {
        const res = await fetch(
          `${baseUrl}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&status=publish&_fields=id,title,content,slug,link,excerpt,categories`,
          { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) }
        );

        if (!res.ok) break;

        const posts = await res.json() as WpPost[];
        if (posts.length === 0) break;

        allPosts = allPosts.concat(posts);
        page++;

        if (posts.length < perPage) break;
      }

      allPosts = allPosts.slice(0, maxPosts);

      send({ type: "progress", message: `총 ${allPosts.length}개의 글을 발견했습니다. 업데이트를 시작합니다...` });

      // 카테고리 이름 맵 가져오기
      const categoryMap = new Map<number, string>();
      try {
        const catRes = await fetch(`${baseUrl}/wp-json/wp/v2/categories?per_page=100`, {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(10000),
        });
        if (catRes.ok) {
          const cats = await catRes.json() as Array<{ id: number; name: string }>;
          cats.forEach(c => categoryMap.set(c.id, c.name));
        }
      } catch { /* ignore */ }

      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors: Array<{ postId: number; title: string; error: string }> = [];

      for (const [idx, post] of allPosts.entries()) {
        try {
          const title = post.title.rendered.replace(/<[^>]*>/g, "");
          const excerpt = post.excerpt.rendered.replace(/<[^>]*>/g, "").trim();
          const categoryName = post.categories?.[0] ? (categoryMap.get(post.categories[0]) || "") : "";

          // 이미 BreadcrumbList가 있으면 스킵 (이미 백필됨)
          if (post.content.rendered.includes('"BreadcrumbList"') && post.content.rendered.includes('"author-bio"')) {
            skippedCount++;
            send({ type: "progress", message: `[${idx + 1}/${allPosts.length}] ⏭️ ${title} — 이미 적용됨, 스킵` });
            continue;
          }

          const enhanced = applyAeoEnhancements(
            post.content.rendered,
            site,
            title,
            post.slug,
            categoryName,
            excerpt,
            post.link,
          );

          if (dryRun) {
            updatedCount++;
            send({
              type: "preview",
              postId: post.id,
              title,
              schemasAdded: [
                enhanced.includes("BreadcrumbList") ? "BreadcrumbList" : null,
                enhanced.includes("FAQPage") ? "FAQPage" : null,
                enhanced.includes("HowTo") ? "HowTo" : null,
                enhanced.includes("author-bio") ? "AuthorBio" : null,
                enhanced.includes("toc-box") ? "TOC" : null,
              ].filter(Boolean),
            });
            continue;
          }

          // 실제 업데이트
          const updateRes = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${post.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              content: enhanced,
            }),
            signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
          });

          if (updateRes.ok) {
            updatedCount++;
            send({ type: "progress", message: `[${idx + 1}/${allPosts.length}] ✅ ${title} — AEO 보강 완료` });
          } else {
            const errText = await updateRes.text();
            errorCount++;
            errors.push({ postId: post.id, title, error: errText.slice(0, 100) });
            send({ type: "progress", message: `[${idx + 1}/${allPosts.length}] ❌ ${title} — 업데이트 실패` });
          }

          // Rate limiting: 100ms 간격
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          errorCount++;
          const title = post.title.rendered.replace(/<[^>]*>/g, "");
          errors.push({ postId: post.id, title, error: err instanceof Error ? err.message : "unknown" });
          send({ type: "progress", message: `[${idx + 1}/${allPosts.length}] ❌ ${title} — 오류 발생` });
        }
      }

      send({
        type: "complete",
        summary: {
          total: allPosts.length,
          updated: updatedCount,
          skipped: skippedCount,
          errors: errorCount,
          dryRun,
        },
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : "알 수 없는 오류" });
    } finally {
      close();
    }
  });
}
