import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import * as cheerio from "cheerio";

export const maxDuration = 300;

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
    slug: string;
    categories: number[];
    tags: number[];
    meta?: Record<string, string>;
};

function tryReadJson<T>(path: string): T[] {
    try {
        if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T[];
    } catch { /* ignore */ }
    return [];
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** 글 본문에 이미 JSON-LD가 있는지 확인 */
function hasJsonLd(html: string): boolean {
    return html.includes('application/ld+json');
}

/** SEO Schema JSON-LD 블록 생성 */
function buildSchemaBlocks(post: WPPost, site: SiteCredential): string {
    let schemas = "";
    const plainTitle = stripHtml(post.title.rendered);
    const plainExcerpt = stripHtml(post.excerpt.rendered).slice(0, 160);

    // Article Schema
    const articleJsonLd = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": plainTitle,
        "description": plainExcerpt,
        "author": {
            "@type": "Person",
            "name": site.persona?.name || site.admin_user
        },
        "datePublished": post.date,
        "dateModified": post.date,
        "publisher": {
            "@type": "Organization",
            "name": site.title
        },
        "url": post.link
    };
    schemas += `\n<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>`;

    // FAQ Schema — 글 본문에서 FAQ 패턴 추출 (h3 질문 + 답변 패턴)
    const $ = cheerio.load(post.content.rendered, null, false);
    const faqItems: Array<{ question: string; answer: string }> = [];

    // 패턴 1: FAQ 섹션 내 dt/dd
    $("dl dt").each((_, dt) => {
        const question = $(dt).text().trim();
        const answer = $(dt).next("dd").text().trim();
        if (question && answer) faqItems.push({ question, answer });
    });

    // 패턴 2: h3 + p (FAQ 형식 질문-답변)
    if (faqItems.length === 0) {
        $("h3").each((_, h3) => {
            const text = $(h3).text().trim();
            if (text.includes("?") || text.includes("？")) {
                const nextP = $(h3).next("p").text().trim();
                if (nextP.length > 20) {
                    faqItems.push({ question: text, answer: nextP.slice(0, 300) });
                }
            }
        });
    }

    // 패턴 3: strong 태그 내 질문
    if (faqItems.length === 0) {
        $("p strong").each((_, el) => {
            const text = $(el).text().trim();
            if (text.includes("?") || text.includes("？")) {
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

    return schemas;
}

/** 이미지 alt 태그 개선 — 빈 alt 또는 너무 일반적인 alt를 제품명 기반으로 변경 */
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

    // figure > figcaption도 개선
    $("figure figcaption").each((_, cap) => {
        const text = $(cap).text().trim();
        if (text === "실제 구매자 리뷰 사진" || !text) {
            $(cap).text(`${plainTitle} 실제 사용 사진`);
        }
    });

    return $.html();
}

export async function POST(req: NextRequest) {
    const { siteSlug } = (await req.json()) as { siteSlug?: string };

    const CACHE_DIR = join(process.cwd(), ".cache");
    const allSites = tryReadJson<SiteCredential>(join(CACHE_DIR, "sites-credentials.json"));

    // sites-config에서 persona 정보 병합
    const configData = tryReadJson<Record<string, unknown>>(join(CACHE_DIR, "sites-config.json"))
        .concat(tryReadJson<Record<string, unknown>>(join(process.cwd(), "..", "configs", "sites-config.json")));
    const configMap = new Map<string, Record<string, unknown>>();
    for (const cfg of configData) {
        if (cfg.site_slug) configMap.set(cfg.site_slug as string, cfg);
    }

    const sites = allSites
        .filter(s => !siteSlug || s.slug === siteSlug)
        .map(s => {
            const cfg = configMap.get(s.slug);
            if (cfg?.persona && !s.persona) {
                return { ...s, persona: cfg.persona as SiteCredential["persona"] };
            }
            return s;
        });

    if (sites.length === 0) {
        return Response.json({ error: "사이트를 찾을 수 없습니다." }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: Record<string, unknown>) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* stream closed */ }
            };

            let totalUpdated = 0;
            let totalSkipped = 0;
            let totalError = 0;

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

                // 전체 글 수 확인
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

                // 페이지별로 모든 글 순회
                const PER_PAGE = 10;
                let siteUpdated = 0;
                let siteSkipped = 0;

                for (let page = 1; page <= Math.ceil(totalPosts / PER_PAGE); page++) {
                    let posts: WPPost[];
                    try {
                        const res = await fetch(
                            `${baseUrl}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&_fields=id,title,content,excerpt,link,date,slug,categories,tags&status=publish`,
                            { headers, cache: "no-store" }
                        );
                        if (!res.ok) break;
                        posts = await res.json();
                    } catch {
                        break;
                    }

                    for (const post of posts) {
                        const plainTitle = stripHtml(post.title.rendered);

                        // 이미 JSON-LD 있으면 스킵
                        if (hasJsonLd(post.content.rendered)) {
                            siteSkipped++;
                            totalSkipped++;
                            send({
                                type: "skip",
                                slug: site.slug,
                                postId: post.id,
                                title: plainTitle,
                                message: `⏭ "${plainTitle}" — 이미 스키마 있음`,
                            });
                            continue;
                        }

                        // 스키마 블록 생성
                        const schemaBlocks = buildSchemaBlocks(post, site);

                        // 이미지 alt 태그 개선
                        const improvedContent = improveImageAlts(post.content.rendered, post.title.rendered);

                        // 최종 콘텐츠: 개선된 content + 스키마
                        const updatedContent = improvedContent + schemaBlocks;

                        // Yoast meta 생성 (빈 경우에만)
                        const metaTitle = plainTitle.length <= 60
                            ? plainTitle
                            : plainTitle.slice(0, 57) + "...";
                        const metaDesc = stripHtml(post.excerpt.rendered).slice(0, 155);

                        // WP REST API로 업데이트
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
                                    message: `✅ "${plainTitle}" — 스키마 주입 + alt 태그 개선`,
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
                }

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

            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
