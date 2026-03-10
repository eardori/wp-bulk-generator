#!/usr/bin/env node
/**
 * 기존 WordPress 글 일괄 SEO 최적화 스크립트
 * - Article Schema JSON-LD 주입
 * - FAQ Schema JSON-LD 주입 (Q&A 패턴 자동 추출)
 * - 이미지 alt 태그 개선
 * - Yoast meta title/description 설정
 * 
 * 사용법: node scripts/seo-optimize-existing.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 사이트 자격증명 로드 ──
function loadSites() {
    const paths = [
        join(ROOT, "admin", ".cache", "sites-credentials.json"),
        join(ROOT, "configs", "sites-credentials.json"),
    ];
    for (const p of paths) {
        if (existsSync(p)) {
            const data = JSON.parse(readFileSync(p, "utf-8"));
            if (data.length > 0) return data;
        }
    }
    throw new Error("sites-credentials.json을 찾을 수 없습니다.");
}

// ── 사이트 설정에서 persona 로드 ──
function loadConfigs() {
    const paths = [
        join(ROOT, "admin", ".cache", "sites-config.json"),
        join(ROOT, "configs", "sites-config.json"),
    ];
    const map = new Map();
    for (const p of paths) {
        if (existsSync(p)) {
            const data = JSON.parse(readFileSync(p, "utf-8"));
            for (const cfg of data) {
                if (cfg.site_slug) map.set(cfg.site_slug, cfg);
            }
            if (map.size > 0) return map;
        }
    }
    return map;
}

function stripHtml(html) {
    return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function hasJsonLd(html) {
    return html.includes("application/ld+json");
}

/** FAQ 패턴 추출 (간단한 정규식 기반, cheerio 없이) */
function extractFaqItems(html) {
    const faqs = [];

    // 패턴 1: <h3>질문?</h3> 다음 <p>답변</p>
    const h3Pattern = /<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gi;
    let match;
    while ((match = h3Pattern.exec(html)) !== null) {
        const q = stripHtml(match[1]);
        const a = stripHtml(match[2]);
        if ((q.includes("?") || q.includes("？")) && a.length > 20) {
            faqs.push({ question: q, answer: a.slice(0, 300) });
        }
    }

    // 패턴 2: <strong>질문?</strong> 다음 텍스트
    if (faqs.length === 0) {
        const strongPattern = /<strong>(.*?\?.*?)<\/strong>.*?<\/p>\s*<p[^>]*>(.*?)<\/p>/gi;
        while ((match = strongPattern.exec(html)) !== null) {
            const q = stripHtml(match[1]);
            const a = stripHtml(match[2]);
            if (a.length > 20) {
                faqs.push({ question: q, answer: a.slice(0, 300) });
            }
        }
    }

    return faqs.slice(0, 10);
}

/** 스키마 JSON-LD 생성 */
function buildSchemaBlocks(post, site, configMap) {
    let schemas = "";
    const plainTitle = stripHtml(post.title.rendered);
    const plainExcerpt = stripHtml(post.excerpt.rendered).slice(0, 160);
    const cfg = configMap.get(site.slug);
    const personaName = cfg?.persona?.name || site.admin_user;

    // Article Schema
    const articleSchema = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: plainTitle,
        description: plainExcerpt,
        author: { "@type": "Person", name: personaName },
        datePublished: post.date,
        dateModified: post.modified || post.date,
        publisher: { "@type": "Organization", name: site.title },
        url: post.link,
    };
    schemas += `\n<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>`;

    // FAQ Schema
    const faqItems = extractFaqItems(post.content.rendered);
    if (faqItems.length > 0) {
        const faqSchema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqItems.map((f) => ({
                "@type": "Question",
                name: f.question,
                acceptedAnswer: { "@type": "Answer", text: f.answer },
            })),
        };
        schemas += `\n<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`;
    }

    return { schemas, faqCount: faqItems.length };
}

/** 이미지 alt 태그 개선 (정규식 기반) */
function improveImageAlts(html, postTitle) {
    const plainTitle = stripHtml(postTitle);
    let counter = 0;

    // alt="" 또는 alt="실제 구매자 리뷰 사진" 또는 alt가 없는 이미지
    return html.replace(/<img\s([^>]*?)>/gi, (fullMatch, attrs) => {
        const altMatch = attrs.match(/alt="([^"]*)"/i);
        const currentAlt = altMatch ? altMatch[1] : "";

        const isGeneric =
            !currentAlt ||
            currentAlt === "실제 구매자 리뷰 사진" ||
            currentAlt === "image" ||
            currentAlt.length < 3;

        if (isGeneric) {
            counter++;
            const newAlt = `${plainTitle} 관련 이미지 ${counter}`;
            if (altMatch) {
                return `<img ${attrs.replace(/alt="[^"]*"/i, `alt="${newAlt}"`)}>`;
            } else {
                return `<img alt="${newAlt}" ${attrs}>`;
            }
        }
        return fullMatch;
    });
}

// ── 메인 로직 ──
async function main() {
    const sites = loadSites();
    const configMap = loadConfigs();

    console.log(`\n${"═".repeat(50)}`);
    console.log(`  📊 기존 WordPress 글 SEO 일괄 최적화`);
    console.log(`  🌐 ${sites.length}개 사이트 대상`);
    console.log(`${"═".repeat(50)}\n`);

    let grandTotal = 0;
    let grandUpdated = 0;
    let grandSkipped = 0;
    let grandError = 0;

    for (const site of sites) {
        // HTTPS 사용 (사용자가 HTTPS 설정 완료했다고 함)
        const baseUrl = site.url.replace(/\/$/, "").replace(/^http:\/\//, "https://");
        const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
        const headers = {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
        };

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`  🔄 ${site.title}`);
        console.log(`  🌍 ${baseUrl}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        // 전체 글 수 확인
        let totalPosts = 0;
        try {
            const countRes = await fetch(
                `${baseUrl}/wp-json/wp/v2/posts?per_page=1&_fields=id&status=publish`,
                { headers }
            );
            if (!countRes.ok) {
                console.log(`  ❌ 접근 실패 (${countRes.status})`);
                grandError++;
                continue;
            }
            totalPosts = parseInt(countRes.headers.get("X-WP-Total") || "0", 10);
        } catch (err) {
            console.log(`  ❌ 연결 실패: ${err.message}`);
            grandError++;
            continue;
        }

        console.log(`  📝 총 ${totalPosts}개 글 발견`);
        grandTotal += totalPosts;

        if (totalPosts === 0) continue;

        const PER_PAGE = 10;
        let siteUpdated = 0;
        let siteSkipped = 0;

        for (let page = 1; page <= Math.ceil(totalPosts / PER_PAGE); page++) {
            let posts;
            try {
                const res = await fetch(
                    `${baseUrl}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&_fields=id,title,content,excerpt,link,date,modified,slug&status=publish`,
                    { headers }
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
                    grandSkipped++;
                    process.stdout.write(`  ⏭ #${post.id} "${plainTitle.slice(0, 30)}..." (이미 적용됨)\n`);
                    continue;
                }

                // 스키마 생성
                const { schemas, faqCount } = buildSchemaBlocks(post, site, configMap);

                // 이미지 alt 개선
                const improvedContent = improveImageAlts(post.content.rendered, post.title.rendered);

                // 합치기
                const updatedContent = improvedContent + schemas;

                // Yoast meta
                const metaTitle = plainTitle.length <= 60 ? plainTitle : plainTitle.slice(0, 57) + "...";
                const metaDesc = stripHtml(post.excerpt.rendered).slice(0, 155);

                // 업데이트
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
                        grandUpdated++;
                        process.stdout.write(
                            `  ✅ #${post.id} "${plainTitle.slice(0, 30)}..." — Schema주입${faqCount > 0 ? ` + FAQ(${faqCount})` : ""}\n`
                        );
                    } else {
                        grandError++;
                        const err = await updateRes.text();
                        process.stdout.write(
                            `  ❌ #${post.id} "${plainTitle.slice(0, 30)}..." — ${updateRes.status}: ${err.slice(0, 80)}\n`
                        );
                    }
                } catch (err) {
                    grandError++;
                    process.stdout.write(`  ❌ #${post.id} 오류: ${err.message}\n`);
                }
            }
        }

        console.log(`  📊 결과: ${siteUpdated}개 업데이트, ${siteSkipped}개 스킵`);
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`  🎯 전체 결과`);
    console.log(`  📝 총 글: ${grandTotal}개`);
    console.log(`  ✅ 업데이트: ${grandUpdated}개`);
    console.log(`  ⏭ 스킵(이미 적용): ${grandSkipped}개`);
    console.log(`  ❌ 오류: ${grandError}개`);
    console.log(`${"═".repeat(50)}\n`);
}

main().catch((err) => {
    console.error("치명적 오류:", err);
    process.exit(1);
});
