#!/usr/bin/env node
/**
 * 기존 WordPress 글 일괄 SEO 최적화 스크립트
 * - 최신 GEO Article/FAQ Schema 재주입
 * - 이미지 alt 태그 및 figcaption 개선
 * - Yoast meta title/description 설정
 *
 * 사용법: node scripts/seo-optimize-existing.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

function stripJsonLdScripts(html) {
    return html
        .replace(/\s*<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, "\n")
        .trim();
}

function jsonLdSignature(html) {
    const matches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    return Array.from(matches)
        .map((match) => {
            const raw = (match[1] || "").trim();
            if (!raw) return "";
            try {
                return JSON.stringify(JSON.parse(raw));
            } catch {
                return raw.replace(/\s+/g, " ");
            }
        })
        .filter(Boolean)
        .join("\n");
}

function normalizeHtmlSignature(html) {
    return html.replace(/\s+/g, " ").trim();
}

function extractFaqItems(html) {
    const faqs = [];

    const dlPattern = /<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gi;
    let match;
    while ((match = dlPattern.exec(html)) !== null) {
        const q = stripHtml(match[1]);
        const a = stripHtml(match[2]);
        if (q && a.length > 20) {
            faqs.push({ question: q, answer: a.slice(0, 300) });
        }
    }

    if (faqs.length === 0) {
        const h3Pattern = /<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gi;
        while ((match = h3Pattern.exec(html)) !== null) {
            const q = stripHtml(match[1]);
            const a = stripHtml(match[2]);
            if ((q.includes("?") || q.includes("？")) && a.length > 20) {
                faqs.push({ question: q, answer: a.slice(0, 300) });
            }
        }
    }

    if (faqs.length === 0) {
        const strongPattern = /<p[^>]*>[\s\S]*?<strong>(.*?\?.*?)<\/strong>[\s\S]*?<\/p>\s*<p[^>]*>(.*?)<\/p>/gi;
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

function buildSchemaBlocks(post, site, configMap, contentHtml) {
    let schemas = "";
    const plainTitle = stripHtml(post.title.rendered);
    const plainExcerpt = stripHtml(post.excerpt.rendered).slice(0, 160);
    const cfg = configMap.get(site.slug);
    const persona = cfg?.persona || {};

    const articleSchema = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: plainTitle,
        description: plainExcerpt,
        author: {
            "@type": "Person",
            name: persona.name || site.admin_user,
            ...(persona.expertise ? { jobTitle: `${persona.expertise} 리뷰어` } : {}),
            ...(persona.concern ? { knowsAbout: persona.concern } : {}),
            ...(persona.bio ? { description: persona.bio } : {}),
        },
        datePublished: post.date,
        dateModified: post.modified || post.date,
        publisher: { "@type": "Organization", name: site.title },
        speakable: {
            "@type": "SpeakableSpecification",
            cssSelector: [".summary-box", "h2"],
        },
        url: post.link,
    };
    schemas += `\n<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>`;

    const faqItems = extractFaqItems(contentHtml);
    if (faqItems.length > 0) {
        const faqSchema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqItems.map((faq) => ({
                "@type": "Question",
                name: faq.question,
                acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
        };
        schemas += `\n<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`;
    }

    return { schemas, faqCount: faqItems.length };
}

function improveImageAlts(html, postTitle) {
    const plainTitle = stripHtml(postTitle);
    let counter = 0;

    const withAlt = html.replace(/<img\s([^>]*?)>/gi, (fullMatch, attrs) => {
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
            }
            return `<img alt="${newAlt}" ${attrs}>`;
        }
        return fullMatch;
    });

    return withAlt.replace(
        /<figcaption[^>]*>\s*(실제 구매자 리뷰 사진)?\s*<\/figcaption>/gi,
        `<figcaption>${plainTitle} 실제 사용 사진</figcaption>`
    );
}

async function main() {
    const sites = loadSites();
    const configMap = loadConfigs();

    console.log(`\n${"═".repeat(50)}`);
    console.log(`  📊 기존 WordPress 글 GEO 일괄 최적화`);
    console.log(`  🌐 ${sites.length}개 사이트 대상`);
    console.log(`${"═".repeat(50)}\n`);

    let grandTotal = 0;
    let grandUpdated = 0;
    let grandSkipped = 0;
    let grandError = 0;

    for (const site of sites) {
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
                const contentWithoutSchemas = stripJsonLdScripts(post.content.rendered);
                const improvedContent = improveImageAlts(contentWithoutSchemas, post.title.rendered);
                const { schemas, faqCount } = buildSchemaBlocks(post, site, configMap, improvedContent);
                const currentSchemaSignature = jsonLdSignature(post.content.rendered);
                const desiredSchemaSignature = jsonLdSignature(schemas);
                const contentUnchanged =
                    normalizeHtmlSignature(contentWithoutSchemas) === normalizeHtmlSignature(improvedContent);

                if (contentUnchanged && currentSchemaSignature === desiredSchemaSignature) {
                    siteSkipped++;
                    grandSkipped++;
                    process.stdout.write(`  ⏭ #${post.id} "${plainTitle.slice(0, 30)}..." (최신 GEO 적용됨)\n`);
                    continue;
                }

                const updatedContent = improvedContent + schemas;
                const metaTitle = plainTitle.length <= 60 ? plainTitle : `${plainTitle.slice(0, 57)}...`;
                const metaDesc = stripHtml(post.excerpt.rendered).slice(0, 155);

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
                            `  ✅ #${post.id} "${plainTitle.slice(0, 30)}..." — GEO 갱신${faqCount > 0 ? ` + FAQ(${faqCount})` : ""}\n`
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
    console.log(`  ⏭ 스킵(최신 GEO): ${grandSkipped}개`);
    console.log(`  ❌ 오류: ${grandError}개`);
    console.log(`${"═".repeat(50)}\n`);
}

main().catch((err) => {
    console.error("치명적 오류:", err);
    process.exit(1);
});
