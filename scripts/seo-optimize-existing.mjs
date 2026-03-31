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

function buildHowToSchema(post, contentHtml) {
    const plainTitle = stripHtml(post.title.rendered);
    const isHowTo = /(방법|가이드|하는\s*법|순서|따라\s*하기|step|tutorial|how\s*to)/iu.test(plainTitle);

    let steps = [];

    // Pattern 1: <ol><li> ordered lists (3+ items)
    const olPattern = /<ol[^>]*>([\s\S]*?)<\/ol>/gi;
    let olMatch;
    while ((olMatch = olPattern.exec(contentHtml)) !== null && steps.length === 0) {
        const liPattern = /<li[^>]*>(.*?)<\/li>/gis;
        const items = [];
        let liMatch;
        while ((liMatch = liPattern.exec(olMatch[1])) !== null) {
            const text = stripHtml(liMatch[1]);
            if (text.length > 5) {
                items.push(text);
            }
        }
        if (items.length >= 3) {
            steps = items.map((text, idx) => ({
                "@type": "HowToStep",
                position: idx + 1,
                text: text.slice(0, 300),
            }));
        }
    }

    // Pattern 2: H2/H3 with step/단계 numbering
    if (steps.length === 0) {
        const stepPattern = /<h[23][^>]*>(.*?(?:단계|step|STEP)\s*\d+.*?)<\/h[23]>\s*<p[^>]*>(.*?)<\/p>/gis;
        let stepMatch;
        let idx = 0;
        while ((stepMatch = stepPattern.exec(contentHtml)) !== null) {
            const name = stripHtml(stepMatch[1]);
            const text = stripHtml(stepMatch[2]);
            if (name && text.length > 10) {
                steps.push({
                    "@type": "HowToStep",
                    position: ++idx,
                    name: name.slice(0, 100),
                    text: text.slice(0, 300),
                });
            }
        }
    }

    if (steps.length < 3 && !isHowTo) return null;
    if (steps.length < 2) return null;

    return {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: plainTitle,
        description: stripHtml(contentHtml).slice(0, 200),
        step: steps.slice(0, 15),
        url: post.link,
    };
}

function buildProductReviewSchema(post, contentHtml, siteTitle) {
    const plainText = stripHtml(contentHtml);
    const plainTitle = stripHtml(post.title.rendered);

    const hasRating = /(\d(?:\.\d)?)\s*(?:점|\/\s*5|\/\s*10|stars?)/iu.test(plainText);
    const hasPrice = /\d{1,3}(?:,\d{3})*\s*원/u.test(plainText);
    const hasProsCons = /(장점|단점|pros|cons|좋은\s*점|아쉬운\s*점|강점|약점)/iu.test(plainText);
    const hasReviewTitle = /(후기|리뷰|review|비교|추천|평가|사용기|체험)/iu.test(plainTitle);

    const signalCount = [hasRating, hasPrice, hasProsCons, hasReviewTitle].filter(Boolean).length;
    if (signalCount < 2) return null;

    // Extract product name
    let productName = plainTitle;
    const pnMatch = plainTitle.match(/^(.+?)\s*(?:후기|리뷰|review|비교|추천|평가|사용기|체험|총정리|정리|가이드)/iu);
    if (pnMatch) productName = pnMatch[1].trim();
    if (!productName) productName = plainTitle;

    // Extract rating
    let ratingValue = "";
    let bestRating = "5";
    const ratingMatch5 = plainText.match(/(\d(?:\.\d)?)\s*(?:점|\/\s*5|stars?)/iu);
    const ratingMatch10 = plainText.match(/(\d(?:\.\d)?)\s*\/\s*10/u);
    if (ratingMatch5) {
        ratingValue = ratingMatch5[1];
    } else if (ratingMatch10) {
        ratingValue = ratingMatch10[1];
        bestRating = "10";
    }

    // Extract price
    let price = "";
    const priceMatches = [...plainText.matchAll(/(\d{1,3}(?:,\d{3})*)\s*원/gu)];
    if (priceMatches.length > 0) {
        const prices = priceMatches
            .map((m) => parseInt(m[1].replace(/,/g, ""), 10))
            .filter((p) => p > 0 && p < 10000000)
            .sort((a, b) => a - b);
        if (prices.length > 0) price = String(prices[0]);
    }

    // Extract pros/cons via heading + list pattern
    const pros = [];
    const cons = [];
    const prosHeadingMatch = contentHtml.match(/<h[23][^>]*>[^<]*(?:장점|좋은\s*점|강점|pros)[^<]*<\/h[23]>\s*<[uo]l[^>]*>([\s\S]*?)<\/[uo]l>/iu);
    if (prosHeadingMatch) {
        const liPattern = /<li[^>]*>(.*?)<\/li>/gis;
        let m;
        while ((m = liPattern.exec(prosHeadingMatch[1])) !== null) {
            const t = stripHtml(m[1]);
            if (t.length > 3) pros.push(t.slice(0, 100));
        }
    }
    const consHeadingMatch = contentHtml.match(/<h[23][^>]*>[^<]*(?:단점|아쉬운\s*점|약점|cons)[^<]*<\/h[23]>\s*<[uo]l[^>]*>([\s\S]*?)<\/[uo]l>/iu);
    if (consHeadingMatch) {
        const liPattern = /<li[^>]*>(.*?)<\/li>/gis;
        let m;
        while ((m = liPattern.exec(consHeadingMatch[1])) !== null) {
            const t = stripHtml(m[1]);
            if (t.length > 3) cons.push(t.slice(0, 100));
        }
    }

    // Extract image
    const imgMatch = contentHtml.match(/<img[^>]*src="([^"]+)"/i);

    const product = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: productName,
        description: plainText.slice(0, 200),
        url: post.link,
    };

    if (imgMatch) product.image = imgMatch[1];

    if (price) {
        product.offers = {
            "@type": "Offer",
            price,
            priceCurrency: "KRW",
            availability: "https://schema.org/InStock",
        };
    }

    const review = {
        "@type": "Review",
        author: { "@type": "Person", name: siteTitle },
        datePublished: post.date,
        reviewBody: plainText.slice(0, 300),
    };

    if (ratingValue) {
        review.reviewRating = { "@type": "Rating", ratingValue, bestRating };
    }

    if (pros.length > 0) {
        review.positiveNotes = {
            "@type": "ItemList",
            itemListElement: pros.slice(0, 5).map((p, i) => ({
                "@type": "ListItem", position: i + 1, name: p,
            })),
        };
    }
    if (cons.length > 0) {
        review.negativeNotes = {
            "@type": "ItemList",
            itemListElement: cons.slice(0, 5).map((c, i) => ({
                "@type": "ListItem", position: i + 1, name: c,
            })),
        };
    }

    product.review = review;
    return product;
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

    const howtoSchema = buildHowToSchema(post, contentHtml);
    if (howtoSchema) {
        schemas += `\n<script type="application/ld+json">${JSON.stringify(howtoSchema)}</script>`;
    }

    const productSchema = buildProductReviewSchema(post, contentHtml, site.title);
    if (productSchema) {
        schemas += `\n<script type="application/ld+json">${JSON.stringify(productSchema)}</script>`;
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
