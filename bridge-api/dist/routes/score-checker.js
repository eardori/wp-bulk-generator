import { GoogleGenerativeAI } from "@google/generative-ai";
import { setupSSE } from "../utils/sse.js";
import { getBrowser } from "../utils/browser.js";
function emptyDiscovery() {
    return {
        websiteUrl: "", address: "", phone: "", businessType: "",
        naverPlaceFound: false, naverPlaceUrl: "", naverPlaceReviewCount: 0,
        naverBlogCount: 0, naverNewsCount: 0,
        googleBizFound: false, googleBizUrl: "", googleReviewCount: 0, googleRating: 0,
        kakaoMapFound: false, kakaoMapUrl: "",
        blogUrls: [], directoryUrls: [], snsUrls: [], sources: [],
    };
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function getGeminiClient() {
    const key = process.env.GEMINI_API_KEY;
    return key ? new GoogleGenerativeAI(key) : null;
}
function computeGrade(score) {
    if (score >= 90)
        return "S";
    if (score >= 75)
        return "A";
    if (score >= 60)
        return "B";
    if (score >= 40)
        return "C";
    return "D";
}
// ── Auto-Discovery ──────────────────────────────────────────────────────────
async function discoverViaGemini(businessName) {
    const client = getGeminiClient();
    if (!client)
        return {};
    try {
        const model = client.getGenerativeModel({
            model: process.env.GEMINI_CONFIG_MODEL || "gemini-2.5-flash",
        });
        const prompt = `다음 업체의 정보를 JSON으로만 알려주세요. 모르는 항목은 빈 문자열로 두세요.
업체명: ${businessName}

반환 형식 (JSON만, 설명 없이):
{"websiteUrl":"","address":"","phone":"","businessType":""}

businessType은 다음 중 하나: restaurant, cafe, dermatology, dental, hair_salon, nail_salon, academy, gym, local_business`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                websiteUrl: parsed.websiteUrl || "",
                address: parsed.address || "",
                phone: parsed.phone || "",
                businessType: parsed.businessType || "",
            };
        }
    }
    catch { /* fallback */ }
    return {};
}
async function discoverViaAPIs(businessName) {
    const result = {
        naverPlaceFound: false, naverPlaceUrl: "", naverPlaceReviewCount: 0,
        naverBlogCount: 0, naverNewsCount: 0,
        googleBizFound: false, googleBizUrl: "", googleReviewCount: 0, googleRating: 0,
        kakaoMapFound: false, kakaoMapUrl: "",
        blogUrls: [], directoryUrls: [], snsUrls: [],
        websiteUrl: "", sources: [],
    };
    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "";
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "";
    const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
    const hasNaverAPI = !!(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET);
    const hasGoogleAPI = !!GOOGLE_PLACES_KEY;
    const naverHeaders = {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    };
    // Helper for Naver Search API
    async function naverSearch(where, query) {
        if (!hasNaverAPI)
            return { total: 0, items: [] };
        try {
            const url = `https://openapi.naver.com/v1/search/${where}.json?query=${encodeURIComponent(query)}&display=10`;
            const res = await fetch(url, { headers: naverHeaders, signal: AbortSignal.timeout(8000) });
            if (!res.ok)
                return { total: 0, items: [] };
            const data = await res.json();
            return { total: data.total || 0, items: data.items || [] };
        }
        catch {
            return { total: 0, items: [] };
        }
    }
    // Run all API calls in parallel
    const [naverLocalResult, naverBlogResult, naverNewsResult, naverWebResult, googlePlacesResult,] = await Promise.allSettled([
        // 1. Naver Local Search (Place)
        naverSearch("local", businessName),
        // 2. Naver Blog Search
        naverSearch("blog", businessName),
        // 3. Naver News Search
        naverSearch("news", businessName),
        // 4. Naver Web Search (for directory/SNS URLs)
        naverSearch("webkr", businessName),
        // 5. Google Places Text Search
        (async () => {
            if (!hasGoogleAPI)
                return null;
            try {
                const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(businessName)}&language=ko&key=${GOOGLE_PLACES_KEY}`;
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (!res.ok)
                    return null;
                return await res.json();
            }
            catch {
                return null;
            }
        })(),
    ]);
    // ── Process Naver Local (Place) ──
    if (naverLocalResult.status === "fulfilled" && naverLocalResult.value.total > 0) {
        const local = naverLocalResult.value;
        const firstPlace = local.items[0];
        if (firstPlace) {
            result.naverPlaceFound = true;
            // Naver local search link format: https://map.naver.com/...
            result.naverPlaceUrl = firstPlace.link || "";
            result.address = firstPlace.roadAddress || "";
            result.phone = firstPlace.telephone || "";
            result.sources.push(`네이버 플레이스 등록 확인 (${local.total}건 검색)`);
        }
    }
    else if (!hasNaverAPI) {
        result.sources.push("네이버 API 키 미설정 — 네이버 검색 건너뜀");
    }
    // ── Process Naver Blog ──
    if (naverBlogResult.status === "fulfilled") {
        const blog = naverBlogResult.value;
        result.naverBlogCount = blog.total;
        if (blog.total > 0) {
            result.sources.push(`네이버 블로그 ${blog.total.toLocaleString()}건 발견`);
            result.blogUrls = blog.items.map(i => i.link).slice(0, 10);
        }
    }
    // ── Process Naver News ──
    if (naverNewsResult.status === "fulfilled") {
        const news = naverNewsResult.value;
        result.naverNewsCount = news.total;
        if (news.total > 0) {
            result.sources.push(`네이버 뉴스 ${news.total.toLocaleString()}건 발견`);
        }
    }
    // ── Process Naver Web Search (Extract directory/SNS URLs) ──
    if (naverWebResult.status === "fulfilled") {
        const web = naverWebResult.value;
        const DIRECTORY_DOMAINS = ["diningcode.com", "siksinhot.com", "mangoplate.com", "catchtable.co.kr", "yogiyo.co.kr"];
        const SNS_DOMAINS = ["instagram.com", "facebook.com", "twitter.com", "x.com"];
        for (const item of web.items) {
            const href = (item.link || "").toLowerCase();
            if (DIRECTORY_DOMAINS.some(d => href.includes(d))) {
                result.directoryUrls.push(item.link);
            }
            if (SNS_DOMAINS.some(d => href.includes(d))) {
                result.snsUrls.push(item.link);
            }
        }
        result.directoryUrls = [...new Set(result.directoryUrls)].slice(0, 5);
        result.snsUrls = [...new Set(result.snsUrls)].slice(0, 5);
    }
    // ── Process Google Places ──
    if (googlePlacesResult.status === "fulfilled" && googlePlacesResult.value) {
        const places = googlePlacesResult.value;
        if (places.results && places.results.length > 0) {
            // Find the best match (first result is usually most relevant)
            const place = places.results[0];
            result.googleBizFound = true;
            result.googleReviewCount = place.user_ratings_total || 0;
            result.googleRating = place.rating || 0;
            result.googleBizUrl = place.place_id ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}` : "";
            const reviewInfo = place.user_ratings_total
                ? ` (리뷰 ${place.user_ratings_total.toLocaleString()}개, 평점 ${place.rating})`
                : "";
            result.sources.push(`구글 비즈니스 프로필 발견${reviewInfo}`);
            // Use Google place address if no address found yet
            if (!result.address && place.formatted_address) {
                result.address = place.formatted_address;
            }
            // ── Google Place Details API: 공식 웹사이트 추출 ──
            if (place.place_id && hasGoogleAPI) {
                try {
                    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=website,formatted_phone_number&language=ko&key=${GOOGLE_PLACES_KEY}`;
                    const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(5000) });
                    if (detailsRes.ok) {
                        const detailsData = await detailsRes.json();
                        if (detailsData.result?.website) {
                            result.websiteUrl = detailsData.result.website;
                            result.sources.push(`공식 웹사이트 발견 (Google): ${detailsData.result.website}`);
                        }
                        if (!result.phone && detailsData.result?.formatted_phone_number) {
                            result.phone = detailsData.result.formatted_phone_number;
                        }
                    }
                }
                catch { /* Place Details failed — non-critical */ }
            }
        }
    }
    else if (!hasGoogleAPI) {
        result.sources.push("구글 Places API 키 미설정 — 구글 검색 건너뜀");
    }
    // ── Naver Place Review Count (via Playwright fallback — only if Place found) ──
    if (result.naverPlaceFound && result.naverPlaceUrl) {
        try {
            const browser = await getBrowser();
            const context = await browser.newContext({
                viewport: { width: 1280, height: 800 },
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            });
            const placePage = await context.newPage();
            try {
                await placePage.goto(result.naverPlaceUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
                await placePage.waitForTimeout(3000);
                const reviewCount = await placePage.evaluate(() => {
                    const bodyText = document.body?.innerText || "";
                    const match = bodyText.match(/(?:방문자\s*)?리뷰\s*([\d,]+)\s*(?:건|개)?/);
                    return match ? parseInt(match[1].replace(/,/g, "")) : 0;
                });
                result.naverPlaceReviewCount = reviewCount;
                if (reviewCount > 0)
                    result.sources.push(`네이버 플레이스 리뷰 ${reviewCount.toLocaleString()}건`);
            }
            catch { /* skip playwright review count — not critical */ }
            await context.close();
        }
        catch { /* browser init failed — non-critical */ }
    }
    return result;
}
async function runDiscovery(businessName, existingUrl, existingAddress, existingPhone, existingType) {
    const discovery = emptyDiscovery();
    // Run Gemini and Playwright in parallel
    const [geminiResult, playwrightResult] = await Promise.allSettled([
        discoverViaGemini(businessName),
        discoverViaAPIs(businessName),
    ]);
    const gemini = geminiResult.status === "fulfilled" ? geminiResult.value : {};
    const pw = playwrightResult.status === "fulfilled" ? playwrightResult.value : {};
    // Merge: user input > Playwright > Gemini
    discovery.websiteUrl = existingUrl || pw.websiteUrl || gemini.websiteUrl || "";
    discovery.address = existingAddress || gemini.address || "";
    discovery.phone = existingPhone || gemini.phone || "";
    discovery.businessType = existingType || gemini.businessType || "local_business";
    // Playwright search results
    discovery.naverPlaceFound = pw.naverPlaceFound || false;
    discovery.naverPlaceUrl = pw.naverPlaceUrl || "";
    discovery.naverPlaceReviewCount = pw.naverPlaceReviewCount || 0;
    discovery.naverBlogCount = pw.naverBlogCount || 0;
    discovery.naverNewsCount = pw.naverNewsCount || 0;
    discovery.googleBizFound = pw.googleBizFound || false;
    discovery.googleBizUrl = pw.googleBizUrl || "";
    discovery.googleReviewCount = pw.googleReviewCount || 0;
    discovery.googleRating = pw.googleRating || 0;
    discovery.blogUrls = [...new Set(pw.blogUrls || [])].slice(0, 10);
    discovery.directoryUrls = [...new Set(pw.directoryUrls || [])].slice(0, 5);
    discovery.snsUrls = [...new Set(pw.snsUrls || [])].slice(0, 5);
    discovery.sources = pw.sources || [];
    if (gemini.websiteUrl && !existingUrl) {
        discovery.sources.push(`Gemini 추천 웹사이트: ${gemini.websiteUrl}`);
    }
    if (gemini.address && !existingAddress) {
        discovery.sources.push(`주소 자동 수집: ${gemini.address}`);
    }
    return discovery;
}
// ── Schema Constants (used by analyzeWebOptimization) ────────────────────────
const LOCAL_BIZ_TYPES = [
    "LocalBusiness", "Restaurant", "CafeOrCoffeeShop", "Dentist",
    "MedicalBusiness", "BeautySalon", "NailSalon", "HealthClub",
    "SportsActivityLocation", "EducationalOrganization", "Store",
    "BarOrPub", "BakeryOrPatisserie", "LodgingBusiness",
];
const SPECIFIC_TYPES = {
    restaurant: ["Restaurant", "CafeOrCoffeeShop", "BarOrPub", "BakeryOrPatisserie"],
    cafe: ["CafeOrCoffeeShop", "Restaurant"],
    dermatology: ["MedicalBusiness", "Physician", "Dermatology"],
    dental: ["Dentist", "MedicalBusiness"],
    hair_salon: ["BeautySalon", "HealthAndBeautyBusiness"],
    nail_salon: ["NailSalon", "HealthAndBeautyBusiness"],
    academy: ["EducationalOrganization", "School"],
    gym: ["SportsActivityLocation", "HealthClub", "ExerciseGym"],
};
function analyzeStructuredData(html, businessType) {
    const items = [];
    // Extract all JSON-LD blocks
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const jsonLdBlocks = [];
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed))
                jsonLdBlocks.push(...parsed);
            else
                jsonLdBlocks.push(parsed);
            // Handle @graph
            if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
                jsonLdBlocks.push(...parsed["@graph"]);
            }
        }
        catch { /* skip */ }
    }
    const allTypes = jsonLdBlocks
        .map((b) => b["@type"])
        .filter(Boolean)
        .flat();
    // 1. LocalBusiness Schema 존재 (8점)
    const hasLocalBiz = allTypes.some((t) => LOCAL_BIZ_TYPES.includes(t));
    items.push({
        name: "LocalBusiness Schema 존재 여부",
        maxScore: 8,
        actualScore: hasLocalBiz ? 8 : 0,
        status: hasLocalBiz ? "pass" : "fail",
        recommendation: hasLocalBiz
            ? "LocalBusiness Schema가 올바르게 설치되어 있습니다."
            : "LocalBusiness Schema(JSON-LD)를 웹사이트 <head>에 추가하세요. AEO Schema Generator에서 자동 생성할 수 있습니다.",
    });
    // 2. 업종별 세부 타입 사용 (4점)
    const specificTypeList = SPECIFIC_TYPES[businessType] || [];
    const hasSpecific = specificTypeList.length > 0
        ? allTypes.some((t) => specificTypeList.includes(t))
        : hasLocalBiz;
    items.push({
        name: "업종별 세부 Schema 타입 사용",
        maxScore: 4,
        actualScore: hasSpecific ? 4 : 0,
        status: hasSpecific ? "pass" : "fail",
        recommendation: hasSpecific
            ? `업종에 맞는 세부 Schema 타입이 사용되고 있습니다.`
            : `일반 LocalBusiness 대신 업종에 맞는 세부 타입(${specificTypeList.join(", ") || "해당 업종"})을 사용하세요.`,
    });
    // 3. FAQPage Schema (4점)
    const hasFAQ = allTypes.includes("FAQPage");
    items.push({
        name: "FAQPage Schema 존재 여부",
        maxScore: 4,
        actualScore: hasFAQ ? 4 : 0,
        status: hasFAQ ? "pass" : "fail",
        recommendation: hasFAQ
            ? "FAQ Schema가 설치되어 있어 AI가 Q&A 데이터를 활용할 수 있습니다."
            : "자주 묻는 질문(FAQ)을 FAQPage Schema로 마크업하세요. AI가 답변에 직접 인용할 확률이 높아집니다.",
    });
    // 4. Menu/Service Schema (4점)
    const localBizBlock = jsonLdBlocks.find((b) => LOCAL_BIZ_TYPES.includes(b["@type"]));
    const hasMenu = !!(localBizBlock?.hasMenu || localBizBlock?.menu);
    const hasService = !!(localBizBlock?.availableService || localBizBlock?.makesOffer);
    const hasMenuOrService = hasMenu || hasService;
    items.push({
        name: "메뉴/서비스 Schema 존재 여부",
        maxScore: 4,
        actualScore: hasMenuOrService ? 4 : 0,
        status: hasMenuOrService ? "pass" : "fail",
        recommendation: hasMenuOrService
            ? "메뉴/서비스 정보가 Schema에 포함되어 있습니다."
            : "메뉴(hasMenu) 또는 서비스(availableService) 정보를 Schema에 추가하세요.",
    });
    // 5. GeoCoordinates (3점)
    const hasGeo = !!(localBizBlock?.geo);
    items.push({
        name: "GeoCoordinates(위치 좌표) 포함",
        maxScore: 3,
        actualScore: hasGeo ? 3 : 0,
        status: hasGeo ? "pass" : "fail",
        recommendation: hasGeo
            ? "위치 좌표가 Schema에 포함되어 있습니다."
            : "geo(GeoCoordinates)를 추가하면 AI가 위치 기반 추천 시 정확도가 높아집니다.",
    });
    // 6. OpeningHoursSpecification (3점)
    const hasHours = !!(localBizBlock?.openingHoursSpecification);
    items.push({
        name: "영업시간(OpeningHoursSpecification) 포함",
        maxScore: 3,
        actualScore: hasHours ? 3 : 0,
        status: hasHours ? "pass" : "fail",
        recommendation: hasHours
            ? "영업시간 정보가 Schema에 포함되어 있습니다."
            : "openingHoursSpecification을 추가하면 '지금 열려있는 곳' 질문에 노출될 수 있습니다.",
    });
    // 7. AggregateRating (2점)
    const hasRating = !!(localBizBlock?.aggregateRating);
    items.push({
        name: "AggregateRating(평점) 포함",
        maxScore: 2,
        actualScore: hasRating ? 2 : 0,
        status: hasRating ? "pass" : "fail",
        recommendation: hasRating
            ? "평점 정보가 Schema에 포함되어 있습니다."
            : "aggregateRating을 추가하면 AI가 평점 정보를 답변에 포함할 수 있습니다.",
    });
    // 8. NAP 일치 (2점)
    const hasName = !!(localBizBlock?.name);
    const hasAddress = !!(localBizBlock?.address);
    const hasPhone = !!(localBizBlock?.telephone);
    const napCount = [hasName, hasAddress, hasPhone].filter(Boolean).length;
    items.push({
        name: "NAP(이름/주소/전화) 정보 포함",
        maxScore: 2,
        actualScore: napCount >= 3 ? 2 : napCount >= 2 ? 1 : 0,
        status: napCount >= 3 ? "pass" : napCount >= 2 ? "partial" : "fail",
        recommendation: napCount >= 3
            ? "이름, 주소, 전화번호가 모두 Schema에 포함되어 있습니다."
            : `Schema에 ${!hasName ? "name, " : ""}${!hasAddress ? "address, " : ""}${!hasPhone ? "telephone, " : ""}정보를 추가하세요.`,
    });
    const score = items.reduce((sum, item) => sum + item.actualScore, 0);
    return { label: "구조화 데이터", maxScore: 30, score, items };
}
function analyzeContentQuality(content, businessName, address) {
    const items = [];
    // Extract location from address (first 2 parts usually)
    const locationParts = address.split(/\s+/).slice(0, 2);
    const locationStr = locationParts.join(" ");
    // 1. H1 태그에 업체명+지역명 포함 (5점)
    const h1Text = content.h1s.join(" ").toLowerCase();
    const nameLower = businessName.toLowerCase();
    const hasNameInH1 = h1Text.includes(nameLower) || nameLower.split(/\s+/).every(p => h1Text.includes(p));
    const hasLocationInH1 = locationParts.some((lp) => h1Text.includes(lp.toLowerCase()));
    const h1Score = hasNameInH1 && hasLocationInH1 ? 5 : hasNameInH1 ? 3 : 0;
    items.push({
        name: "H1 태그에 업체명+지역명 포함",
        maxScore: 5,
        actualScore: h1Score,
        status: h1Score >= 5 ? "pass" : h1Score > 0 ? "partial" : "fail",
        recommendation: h1Score >= 5
            ? "H1 태그에 업체명과 지역명이 포함되어 있습니다."
            : `H1 태그에 "${businessName} ${locationStr}" 형태로 업체명과 지역명을 포함하세요. AI가 페이지 주제를 정확히 파악합니다.`,
    });
    // 2. H2 태그 3개 이상 존재 (3점)
    const h2Count = content.h2s.length;
    const h2Score = h2Count >= 3 ? 3 : h2Count >= 1 ? 1 : 0;
    items.push({
        name: "H2 태그 3개 이상 존재",
        maxScore: 3,
        actualScore: h2Score,
        status: h2Count >= 3 ? "pass" : h2Count >= 1 ? "partial" : "fail",
        recommendation: h2Count >= 3
            ? `H2 태그가 ${h2Count}개 있어 콘텐츠가 잘 구조화되어 있습니다.`
            : `H2 태그를 3개 이상 사용하여 콘텐츠를 섹션별로 나누세요 (현재: ${h2Count}개). AI는 구조화된 콘텐츠를 선호합니다.`,
    });
    // 3. FAQ 섹션 존재 (5점)
    const faqScore = content.hasFaqPattern ? 5 : 0;
    items.push({
        name: "FAQ 섹션 존재 여부",
        maxScore: 5,
        actualScore: faqScore,
        status: content.hasFaqPattern ? "pass" : "fail",
        recommendation: content.hasFaqPattern
            ? "FAQ 형태의 Q&A 콘텐츠가 감지되었습니다."
            : "자주 묻는 질문(FAQ) 섹션을 추가하세요. AI가 '~는 어때요?' 같은 질문에 직접 답변으로 인용할 수 있습니다.",
    });
    // 4. 첫 문단 엔티티 선언 (5점)
    const firstP = content.firstParagraph.toLowerCase();
    const hasNameInFirst = firstP.includes(nameLower) || nameLower.split(/\s+/).every(p => firstP.includes(p));
    const hasLocationInFirst = locationParts.some((lp) => firstP.includes(lp.toLowerCase()));
    const firstPScore = hasNameInFirst && hasLocationInFirst ? 5 : hasNameInFirst ? 3 : 0;
    items.push({
        name: "첫 문단에 업체명+지역 선언",
        maxScore: 5,
        actualScore: firstPScore,
        status: firstPScore >= 5 ? "pass" : firstPScore > 0 ? "partial" : "fail",
        recommendation: firstPScore >= 5
            ? "첫 문단에서 업체와 지역이 명확히 선언되어 있습니다."
            : `페이지 첫 문단에 "${businessName}은(는) ${locationStr}에 위치한 ..." 형태로 엔티티를 명확히 선언하세요.`,
    });
    // 5. 패시지 독립성 (4점)
    const goodSections = content.h2Sections.filter((s) => s.firstParagraph.length >= 40).length;
    const passageScore = goodSections >= 3 ? 4 : goodSections >= 2 ? 2 : goodSections >= 1 ? 1 : 0;
    items.push({
        name: "패시지 독립성 (각 섹션 완결성)",
        maxScore: 4,
        actualScore: passageScore,
        status: passageScore >= 4 ? "pass" : passageScore > 0 ? "partial" : "fail",
        recommendation: passageScore >= 4
            ? "각 섹션이 독립적으로 읽힐 수 있는 완결된 문단을 포함하고 있습니다."
            : "각 H2 섹션의 첫 2~3문장을 그 섹션만 읽어도 이해할 수 있도록 완결적으로 작성하세요. AI는 페이지의 특정 패시지만 발췌하여 인용합니다.",
    });
    // 6. 메뉴/서비스 리스트 구조화 (4점)
    const listScore = content.hasListElements ? 4 : 0;
    items.push({
        name: "메뉴/서비스 리스트 구조화 (<ul><li>)",
        maxScore: 4,
        actualScore: listScore,
        status: content.hasListElements ? "pass" : "fail",
        recommendation: content.hasListElements
            ? "리스트 요소(<ul><li>)를 활용하여 정보가 구조화되어 있습니다."
            : "메뉴, 서비스, 특징 등을 <ul><li> 리스트로 구조화하세요. AI가 항목별 정보를 더 정확히 인용합니다.",
    });
    // 7. 페이지 텍스트 총량 (2점)
    const wordScore = content.wordCount >= 300 ? 2 : content.wordCount >= 150 ? 1 : 0;
    items.push({
        name: "페이지 텍스트 총량 (300단어 이상)",
        maxScore: 2,
        actualScore: wordScore,
        status: content.wordCount >= 300 ? "pass" : content.wordCount >= 150 ? "partial" : "fail",
        recommendation: content.wordCount >= 300
            ? `페이지 텍스트가 충분합니다 (약 ${content.wordCount}단어).`
            : `페이지 텍스트가 부족합니다 (약 ${content.wordCount}단어). 300단어 이상의 충실한 콘텐츠를 작성하세요.`,
    });
    // 8. meta description (2점)
    const metaOk = content.metaDesc.length >= 50 && content.metaDesc.length <= 160;
    const metaPartial = content.metaDesc.length > 0;
    items.push({
        name: "meta description 존재 및 길이 적정",
        maxScore: 2,
        actualScore: metaOk ? 2 : metaPartial ? 1 : 0,
        status: metaOk ? "pass" : metaPartial ? "partial" : "fail",
        recommendation: metaOk
            ? "meta description이 적정 길이로 설정되어 있습니다."
            : content.metaDesc.length === 0
                ? "meta description이 없습니다. 50~160자 사이로 페이지 내용을 요약하세요."
                : `meta description 길이가 ${content.metaDesc.length}자입니다. 50~160자 사이가 적정합니다.`,
    });
    const score = items.reduce((sum, item) => sum + item.actualScore, 0);
    return { label: "콘텐츠 품질", maxScore: 30, score, items };
}
// ── Category A: Entity Authority (40 pts) ────────────────────────────────────
// AI가 업체를 추천하는 핵심 근거: 리뷰 수, 블로그 언급, 뉴스 노출
function analyzeEntityAuthority(discovery) {
    const items = [];
    // 1. 네이버 플레이스 리뷰 수 (10점)
    const npReviews = discovery.naverPlaceReviewCount || 0;
    const npScore = npReviews >= 500 ? 10 : npReviews >= 200 ? 7 : npReviews >= 50 ? 4 : npReviews >= 10 ? 2 : 0;
    items.push({
        name: "네이버 플레이스 리뷰 수",
        maxScore: 10, actualScore: npScore,
        status: npScore >= 7 ? "pass" : npScore > 0 ? "partial" : "fail",
        recommendation: npReviews > 0
            ? `네이버 플레이스 리뷰 ${npReviews}건. ${npScore >= 7 ? "우수한 리뷰 수입니다." : "리뷰 수를 늘리면 AI 추천 확률이 높아집니다."}`
            : discovery.naverPlaceFound
                ? "네이버 플레이스에 등록되어 있지만 리뷰 수를 확인하지 못했습니다. 방문자 리뷰를 적극 유도하세요."
                : "네이버 플레이스에 먼저 등록하고, 방문자 리뷰를 수집하세요.",
    });
    // 2. 구글 리뷰 수 + 평점 (10점)
    const gReviews = discovery.googleReviewCount || 0;
    const gRating = discovery.googleRating || 0;
    const gReviewScore = gReviews >= 300 ? 7 : gReviews >= 100 ? 5 : gReviews >= 50 ? 3 : gReviews >= 10 ? 2 : gReviews > 0 ? 1 : 0;
    const gRatingScore = gRating >= 4.0 ? 3 : gRating >= 3.5 ? 2 : gRating > 0 ? 1 : 0;
    const gTotal = Math.min(gReviewScore + gRatingScore, 10);
    items.push({
        name: "구글 리뷰 수 + 평점",
        maxScore: 10, actualScore: gTotal,
        status: gTotal >= 7 ? "pass" : gTotal > 0 ? "partial" : "fail",
        recommendation: gReviews > 0
            ? `구글 리뷰 ${gReviews}건, 평점 ${gRating}점. ${gTotal >= 7 ? "우수합니다." : "리뷰를 더 수집하세요."}`
            : discovery.googleBizFound
                ? "구글 비즈니스 프로필이 있지만 리뷰 수를 확인하지 못했습니다. 구글 리뷰를 적극 유도하세요."
                : "구글 비즈니스 프로필(GBP)에 등록하고 리뷰를 수집하세요. 글로벌 AI 추천의 핵심입니다.",
    });
    // 3. 네이버 블로그 언급 수 (10점)
    const blogCount = discovery.naverBlogCount || 0;
    const blogScore = blogCount >= 1000 ? 10 : blogCount >= 500 ? 7 : blogCount >= 100 ? 4 : blogCount >= 10 ? 2 : blogCount > 0 ? 1 : 0;
    items.push({
        name: "네이버 블로그 언급 수",
        maxScore: 10, actualScore: blogScore,
        status: blogScore >= 7 ? "pass" : blogScore > 0 ? "partial" : "fail",
        recommendation: blogCount > 0
            ? `네이버 블로그에서 약 ${blogCount}건 언급. ${blogScore >= 7 ? "충분한 온라인 존재감입니다." : "블로그 마케팅으로 언급을 늘리세요."}`
            : "네이버 블로그에서 업체 관련 언급이 없습니다. 블로그 마케팅을 시작하세요.",
    });
    // 4. 뉴스/미디어 노출 (5점)
    const newsCount = discovery.naverNewsCount || 0;
    const newsScore = newsCount >= 50 ? 5 : newsCount >= 20 ? 3 : newsCount >= 5 ? 1 : 0;
    items.push({
        name: "뉴스/미디어 노출",
        maxScore: 5, actualScore: newsScore,
        status: newsScore >= 3 ? "pass" : newsScore > 0 ? "partial" : "fail",
        recommendation: newsCount > 0
            ? `네이버 뉴스에서 ${newsCount}건 검색됨. ${newsScore >= 3 ? "미디어 노출이 충분합니다." : "보도자료, 인터뷰 등으로 미디어 노출을 늘리세요."}`
            : "뉴스/미디어 노출이 없습니다. 보도자료 배포나 미디어 인터뷰를 통해 권위성을 높이세요.",
    });
    // 5. SNS 멘션 (5점)
    const snsCount = discovery.snsUrls?.length || 0;
    const snsScore = snsCount >= 5 ? 5 : snsCount >= 3 ? 4 : snsCount >= 2 ? 2 : snsCount >= 1 ? 1 : 0;
    items.push({
        name: "SNS 멘션",
        maxScore: 5, actualScore: snsScore,
        status: snsScore >= 4 ? "pass" : snsScore > 0 ? "partial" : "fail",
        recommendation: snsCount > 0
            ? `${snsCount}개 SNS 플랫폼에서 발견됨. ${snsScore >= 4 ? "우수합니다." : "인스타그램 해시태그 등 SNS 활동을 강화하세요."}`
            : "인스타그램, 페이스북 등 SNS 채널을 활용하여 브랜드 인지도를 높이세요.",
    });
    const score = items.reduce((sum, item) => sum + item.actualScore, 0);
    return { label: "엔티티 권위성", maxScore: 40, score, items };
}
// ── Category B: Platform Presence (30 pts) ───────────────────────────────────
// AI 학습 데이터 소스에 등록되어 있는가
function analyzePlatformPresence(discovery) {
    const items = [];
    // 1. 네이버 플레이스 등록 (8점)
    items.push({
        name: "네이버 플레이스 등록",
        maxScore: 8,
        actualScore: discovery.naverPlaceFound ? 8 : 0,
        status: discovery.naverPlaceFound ? "pass" : "fail",
        recommendation: discovery.naverPlaceFound
            ? `네이버 플레이스에 등록됨.${discovery.naverPlaceUrl ? ` ${discovery.naverPlaceUrl}` : ""}`
            : "네이버 플레이스에 업체를 등록하세요. 한국 AI 엔진 추천의 핵심 데이터 소스입니다.",
    });
    // 2. 구글 비즈니스 프로필 (8점)
    items.push({
        name: "구글 비즈니스 프로필",
        maxScore: 8,
        actualScore: discovery.googleBizFound ? 8 : 0,
        status: discovery.googleBizFound ? "pass" : "fail",
        recommendation: discovery.googleBizFound
            ? "구글 비즈니스 프로필(지식 패널)이 확인되었습니다."
            : "구글 비즈니스 프로필(GBP)에 등록하세요. 글로벌 AI 노출에 필수입니다.",
    });
    // 3. 카카오맵 등록 (4점)
    items.push({
        name: "카카오맵 등록",
        maxScore: 4,
        actualScore: discovery.kakaoMapFound ? 4 : 0,
        status: discovery.kakaoMapFound ? "pass" : "fail",
        recommendation: discovery.kakaoMapFound
            ? "카카오맵에 등록되어 있습니다."
            : "카카오맵에 업체를 등록하세요. 카카오 생태계 AI 노출에 도움됩니다.",
    });
    // 4. 업종 디렉토리 (4점)
    const dirCount = discovery.directoryUrls?.length || 0;
    const dirScore = dirCount >= 3 ? 4 : dirCount >= 2 ? 3 : dirCount >= 1 ? 2 : 0;
    items.push({
        name: "업종 디렉토리 등록 (다이닝코드, 식신 등)",
        maxScore: 4, actualScore: dirScore,
        status: dirScore >= 3 ? "pass" : dirScore > 0 ? "partial" : "fail",
        recommendation: dirCount > 0
            ? `${dirCount}개 업종 디렉토리에서 발견됨.`
            : "다이닝코드, 식신, 망고플레이트 등 업종 디렉토리에 등록하세요.",
    });
    // 5. 공식 웹사이트 보유 (3점)
    items.push({
        name: "공식 웹사이트 보유",
        maxScore: 3,
        actualScore: discovery.websiteUrl ? 3 : 0,
        status: discovery.websiteUrl ? "pass" : "fail",
        recommendation: discovery.websiteUrl
            ? `공식 웹사이트: ${discovery.websiteUrl}`
            : "공식 웹사이트를 제작하면 AI가 업체 정보를 더 정확하게 제공할 수 있습니다.",
    });
    // 6. SNS 프로필 존재 (3점)
    const hasSnsPlatforms = discovery.snsUrls?.length || 0;
    const snsPresScore = hasSnsPlatforms >= 2 ? 3 : hasSnsPlatforms >= 1 ? 2 : 0;
    items.push({
        name: "SNS 프로필 존재",
        maxScore: 3, actualScore: snsPresScore,
        status: snsPresScore >= 2 ? "pass" : snsPresScore > 0 ? "partial" : "fail",
        recommendation: hasSnsPlatforms > 0
            ? `${hasSnsPlatforms}개 SNS 플랫폼에서 프로필 확인됨.`
            : "인스타그램, 페이스북 공식 계정을 개설하세요.",
    });
    const score = items.reduce((sum, item) => sum + item.actualScore, 0);
    return { label: "플랫폼 존재감", maxScore: 30, score, items };
}
// ── Category C: Web Optimization (20 pts) ────────────────────────────────────
// 기존 Schema + Content를 통합한 웹사이트 최적화 점수
function analyzeWebOptimization(html, content, businessName, businessType) {
    const items = [];
    // Parse JSON-LD
    const jsonLdBlocks = [];
    const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
            jsonLdBlocks.push(JSON.parse(match[1]));
        }
        catch { /* skip */ }
    }
    const flatSchemas = [];
    for (const block of jsonLdBlocks) {
        if (Array.isArray(block))
            flatSchemas.push(...block);
        else
            flatSchemas.push(block);
    }
    const types = flatSchemas.map(s => String(s["@type"] || ""));
    // 1. LocalBusiness Schema (5점)
    const hasLocalBiz = types.some(t => LOCAL_BIZ_TYPES.includes(t));
    items.push({
        name: "LocalBusiness Schema 존재",
        maxScore: 5, actualScore: hasLocalBiz ? 5 : 0,
        status: hasLocalBiz ? "pass" : "fail",
        recommendation: hasLocalBiz ? "LocalBusiness Schema가 설치되어 있습니다." : "LocalBusiness 타입의 Schema를 설치하세요.",
    });
    // 2. 업종별 세부 타입 (2점)
    const expectedTypes = SPECIFIC_TYPES[businessType] || [];
    const hasSpecific = expectedTypes.length > 0 && types.some(t => expectedTypes.includes(t));
    items.push({
        name: "업종별 세부 Schema 타입",
        maxScore: 2, actualScore: hasSpecific ? 2 : 0,
        status: hasSpecific ? "pass" : "fail",
        recommendation: hasSpecific ? "업종에 맞는 세부 Schema 타입이 사용되고 있습니다." : "업종에 맞는 세부 타입(예: Restaurant, Dentist)을 사용하세요.",
    });
    // 3. FAQ Schema (3점)
    const hasFaq = types.includes("FAQPage") || content.hasFaqPattern;
    items.push({
        name: "FAQ 구조 존재",
        maxScore: 3, actualScore: hasFaq ? 3 : 0,
        status: hasFaq ? "pass" : "fail",
        recommendation: hasFaq ? "FAQ 구조가 확인되었습니다." : "FAQ 섹션을 추가하세요. AI가 Q&A 형태로 정보를 인용합니다.",
    });
    // 4. H1/H2 구조 + 엔티티 선언 (3점)
    const h1HasBiz = content.h1s.some(h => h.includes(businessName));
    const h2Count = content.h2s.length;
    const structScore = (h1HasBiz ? 1 : 0) + (h2Count >= 3 ? 1 : 0) + (content.firstParagraph.includes(businessName) ? 1 : 0);
    items.push({
        name: "H1/H2 구조 + 엔티티 선언",
        maxScore: 3, actualScore: structScore,
        status: structScore >= 2 ? "pass" : structScore > 0 ? "partial" : "fail",
        recommendation: structScore >= 2 ? "페이지 구조가 잘 되어 있습니다." : "H1에 업체명을 포함하고, 첫 문단에 업체명+지역을 선언하세요.",
    });
    // 5. 메뉴/서비스 구조화 (2점)
    items.push({
        name: "메뉴/서비스 리스트 구조화",
        maxScore: 2, actualScore: content.hasListElements ? 2 : 0,
        status: content.hasListElements ? "pass" : "fail",
        recommendation: content.hasListElements ? "리스트 구조가 존재합니다." : "메뉴나 서비스를 <ul><li>로 구조화하세요.",
    });
    // 6. 위치/영업시간/평점 Schema (3점)
    const bizSchema = flatSchemas.find(s => LOCAL_BIZ_TYPES.includes(String(s["@type"] || "")));
    const hasGeo = !!(bizSchema?.geo || bizSchema?.hasMap);
    const hasHours = !!bizSchema?.openingHoursSpecification;
    const hasRating = !!bizSchema?.aggregateRating;
    const detailScore = (hasGeo ? 1 : 0) + (hasHours ? 1 : 0) + (hasRating ? 1 : 0);
    items.push({
        name: "위치/영업시간/평점 Schema",
        maxScore: 3, actualScore: detailScore,
        status: detailScore >= 2 ? "pass" : detailScore > 0 ? "partial" : "fail",
        recommendation: detailScore >= 2 ? "세부 정보가 Schema에 포함되어 있습니다." : "GeoCoordinates, 영업시간, 평점을 Schema에 추가하세요.",
    });
    // 7. meta description (2점)
    const metaLen = content.metaDesc?.length || 0;
    const metaOk = metaLen >= 50 && metaLen <= 160;
    items.push({
        name: "meta description",
        maxScore: 2, actualScore: metaOk ? 2 : metaLen > 0 ? 1 : 0,
        status: metaOk ? "pass" : metaLen > 0 ? "partial" : "fail",
        recommendation: metaOk ? "적정 길이의 meta description이 설정되어 있습니다." : "50~160자의 meta description을 설정하세요.",
    });
    const score = items.reduce((sum, item) => sum + item.actualScore, 0);
    return { label: "웹사이트 최적화", maxScore: 20, score, items };
}
// ── Category D: AI Accessibility (10 pts) ────────────────────────────────────
// AI 크롤러가 콘텐츠를 수집할 수 있는가
async function analyzeAiAccessibility(websiteUrl) {
    const items = [];
    if (!websiteUrl) {
        items.push({ name: "robots.txt AI 크롤링 허용", maxScore: 3, actualScore: 0, status: "fail", recommendation: "웹사이트가 없어 진단 불가. 웹사이트를 먼저 제작하세요." }, { name: "llms.txt 존재", maxScore: 3, actualScore: 0, status: "fail", recommendation: "웹사이트가 없어 진단 불가." }, { name: "sitemap.xml 존재", maxScore: 2, actualScore: 0, status: "fail", recommendation: "웹사이트가 없어 진단 불가." }, { name: "페이지 로딩 속도", maxScore: 2, actualScore: 0, status: "fail", recommendation: "웹사이트가 없어 진단 불가." });
        return { label: "AI 접근성", maxScore: 10, score: 0, items };
    }
    const baseUrl = websiteUrl.replace(/\/$/, "");
    // 1. robots.txt (3점)
    try {
        const robotsRes = await fetch(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(5000) });
        if (robotsRes.ok) {
            const robotsText = await robotsRes.text();
            const blocksAi = /disallow:\s*\/\s*$/mi.test(robotsText) && /user-agent:\s*\*/mi.test(robotsText);
            const allowsAi = !blocksAi;
            items.push({
                name: "robots.txt AI 크롤링 허용",
                maxScore: 3, actualScore: allowsAi ? 3 : 1,
                status: allowsAi ? "pass" : "partial",
                recommendation: allowsAi ? "robots.txt가 AI 크롤링을 허용합니다." : "robots.txt가 AI 크롤러를 차단하고 있습니다. GPTBot, ClaudeBot 등을 허용하세요.",
            });
        }
        else {
            items.push({ name: "robots.txt AI 크롤링 허용", maxScore: 3, actualScore: 2, status: "partial", recommendation: "robots.txt 파일이 없습니다. 기본적으로 크롤링 허용 상태입니다." });
        }
    }
    catch {
        items.push({ name: "robots.txt AI 크롤링 허용", maxScore: 3, actualScore: 0, status: "fail", recommendation: "robots.txt 확인 실패." });
    }
    // 2. llms.txt (3점)
    try {
        const llmsRes = await fetch(`${baseUrl}/llms.txt`, { signal: AbortSignal.timeout(5000) });
        items.push({
            name: "llms.txt 존재",
            maxScore: 3, actualScore: llmsRes.ok ? 3 : 0,
            status: llmsRes.ok ? "pass" : "fail",
            recommendation: llmsRes.ok ? "llms.txt 파일이 존재합니다. AI 크롤러에게 구조화된 정보를 제공합니다." : "llms.txt 파일을 생성하세요. AI 엔진이 업체 정보를 정확하게 인용하는 데 도움됩니다.",
        });
    }
    catch {
        items.push({ name: "llms.txt 존재", maxScore: 3, actualScore: 0, status: "fail", recommendation: "llms.txt 확인 실패." });
    }
    // 3. sitemap.xml (2점)
    try {
        const smRes = await fetch(`${baseUrl}/sitemap.xml`, { signal: AbortSignal.timeout(5000) });
        items.push({
            name: "sitemap.xml 존재",
            maxScore: 2, actualScore: smRes.ok ? 2 : 0,
            status: smRes.ok ? "pass" : "fail",
            recommendation: smRes.ok ? "sitemap.xml이 정상적으로 제공됩니다." : "sitemap.xml을 생성하면 크롤링 효율이 높아집니다.",
        });
    }
    catch {
        items.push({ name: "sitemap.xml 존재", maxScore: 2, actualScore: 0, status: "fail", recommendation: "sitemap.xml 확인 실패." });
    }
    // 4. 페이지 로딩 속도 (2점) — 간이 체크
    try {
        const start = Date.now();
        await fetch(websiteUrl, { signal: AbortSignal.timeout(8000) });
        const elapsed = Date.now() - start;
        const speedScore = elapsed < 2000 ? 2 : elapsed < 5000 ? 1 : 0;
        items.push({
            name: "페이지 로딩 속도",
            maxScore: 2, actualScore: speedScore,
            status: speedScore >= 2 ? "pass" : speedScore > 0 ? "partial" : "fail",
            recommendation: `응답 시간: ${elapsed}ms. ${speedScore >= 2 ? "빠른 응답입니다." : "페이지 로딩 속도를 개선하세요."}`,
        });
    }
    catch {
        items.push({ name: "페이지 로딩 속도", maxScore: 2, actualScore: 0, status: "fail", recommendation: "페이지 응답 시간 초과." });
    }
    const score = items.reduce((sum, item) => sum + item.actualScore, 0);
    return { label: "AI 접근성", maxScore: 10, score, items };
}
async function generateAiSummary(businessName, totalScore, grade, categories) {
    const client = getGeminiClient();
    if (!client) {
        return {
            summary: `${businessName}의 AEO 점수는 ${totalScore}점 (${grade}등급)입니다.`,
            topPriorities: categories
                .flatMap((c) => c.items)
                .filter((i) => i.status === "fail")
                .sort((a, b) => b.maxScore - a.maxScore)
                .slice(0, 3)
                .map((i) => i.name),
        };
    }
    const model = client.getGenerativeModel({
        model: process.env.GEMINI_CONFIG_MODEL || "gemini-2.5-flash",
    });
    const categoryDetails = categories
        .map((c) => `${c.label} (${c.score}/${c.maxScore}점):\n${c.items.map((i) => `  - ${i.name}: ${i.status} (${i.actualScore}/${i.maxScore})`).join("\n")}`)
        .join("\n\n");
    const prompt = `당신은 AEO(Answer Engine Optimization) 전문가입니다.
아래 진단 결과를 바탕으로:

1. 종합 평가를 한국어 2~3문장으로 작성하세요.
2. 우선 개선해야 할 항목 Top 3를 짧은 문장으로 알려주세요.

업체명: ${businessName}
총점: ${totalScore}/100 (${grade}등급)

${categoryDetails}

JSON으로만 반환 (설명 없이):
{"summary": "종합 평가 문장", "topPriorities": ["개선1", "개선2", "개선3"]}`;
    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    }
    catch { /* fallback */ }
    return {
        summary: `${businessName}의 AEO 진단 점수는 ${totalScore}점(${grade}등급)입니다. 구조화 데이터와 콘텐츠 품질 개선이 필요합니다.`,
        topPriorities: categories
            .flatMap((c) => c.items)
            .filter((i) => i.status === "fail")
            .sort((a, b) => b.maxScore - a.maxScore)
            .slice(0, 3)
            .map((i) => i.recommendation.slice(0, 50)),
    };
}
// ── Route ────────────────────────────────────────────────────────────────────
// ── No-Website Placeholder Categories ────────────────────────────────────────
function noWebsiteOptimization() {
    const baseMsg = "웹사이트가 없어 진단 불가. 웹사이트를 제작하고 Schema + llms.txt를 설치하면 최대 30점을 추가 확보할 수 있습니다.";
    const items = [
        { name: "LocalBusiness Schema 존재", maxScore: 5, actualScore: 0, status: "fail", recommendation: baseMsg },
        { name: "업종별 세부 Schema 타입", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
        { name: "FAQ 구조 존재", maxScore: 3, actualScore: 0, status: "fail", recommendation: baseMsg },
        { name: "H1/H2 구조 + 엔티티 선언", maxScore: 3, actualScore: 0, status: "fail", recommendation: baseMsg },
        { name: "메뉴/서비스 리스트 구조화", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
        { name: "위치/영업시간/평점 Schema", maxScore: 3, actualScore: 0, status: "fail", recommendation: baseMsg },
        { name: "meta description", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
    ];
    return { label: "웹사이트 최적화", maxScore: 20, score: 0, items };
}
// ── Route ────────────────────────────────────────────────────────────────────
export async function scoreCheckerRoutes(app) {
    // ─── POST /score-checker/analyze ───────────────────────────
    app.post("/score-checker/analyze", async (req, reply) => {
        const body = req.body;
        if (!body.businessName) {
            return reply.status(400).send({ error: "업체명은 필수입니다." });
        }
        const { send, close } = setupSSE(reply);
        try {
            send({
                type: "start",
                businessName: body.businessName,
                message: `${body.businessName} 진단 시작... 업체 정보를 자동 수집합니다.`,
            });
            // ── Step 1: Auto-Discovery ──
            send({ type: "step", step: 1, label: "업체 정보 자동 수집 중...", message: "Gemini + 검색 엔진으로 업체 정보를 수집합니다..." });
            const discovery = await runDiscovery(body.businessName, body.websiteUrl?.trim() || "", body.address?.trim() || "", body.phone?.trim() || "", body.businessType || "");
            // Use discovered values
            const websiteUrl = discovery.websiteUrl;
            const address = discovery.address;
            const businessType = discovery.businessType || "local_business";
            const hasWebsite = !!websiteUrl;
            send({
                type: "step-done", step: 1,
                message: `✅ 자동 수집 완료${hasWebsite ? ` — 웹사이트: ${websiteUrl}` : " — 웹사이트 미발견"}`,
                discovery: {
                    websiteUrl,
                    address: discovery.address,
                    phone: discovery.phone,
                    naverPlaceFound: discovery.naverPlaceFound,
                    googleBizFound: discovery.googleBizFound,
                    blogCount: discovery.blogUrls.length,
                    directoryCount: discovery.directoryUrls.length,
                    snsCount: discovery.snsUrls.length,
                    sources: discovery.sources,
                },
            });
            let webOptimization = noWebsiteOptimization();
            let crawlSuccess = false;
            let crawlFailedReason = "";
            if (hasWebsite) {
                // ── Step 2: Crawl website ──
                send({ type: "step", step: 2, label: "웹페이지 크롤링 중...", message: `${websiteUrl} HTML을 가져오고 있습니다...` });
                try {
                    const browser = await getBrowser();
                    const context = await browser.newContext({
                        viewport: { width: 1280, height: 800 },
                        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    });
                    const page = await context.newPage();
                    await page.goto(websiteUrl, {
                        waitUntil: "domcontentloaded",
                        timeout: 15000,
                    });
                    await page.waitForTimeout(2000);
                    const pageData = await page.evaluate(() => {
                        const title = document.title || "";
                        const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
                        const html = document.documentElement.outerHTML;
                        const bodyText = document.body?.innerText || "";
                        const h1s = Array.from(document.querySelectorAll("h1")).map((el) => el.textContent?.trim() || "");
                        const h2s = Array.from(document.querySelectorAll("h2")).map((el) => el.textContent?.trim() || "");
                        const firstP = document.querySelector("p")?.textContent?.trim() || "";
                        const hasListElements = document.querySelectorAll("ul li, ol li").length >= 3;
                        const cleanText = bodyText.replace(/\s+/g, " ").trim();
                        const wordCount = cleanText.length > 0
                            ? Math.round(cleanText.split(/\s+/).length + cleanText.replace(/[a-zA-Z\s]/g, "").length / 2)
                            : 0;
                        const h2Sections = [];
                        document.querySelectorAll("h2").forEach((h2) => {
                            const heading = h2.textContent?.trim() || "";
                            let nextEl = h2.nextElementSibling;
                            let fp = "";
                            while (nextEl && nextEl.tagName !== "H2" && !fp) {
                                if (nextEl.tagName === "P" && nextEl.textContent)
                                    fp = nextEl.textContent.trim();
                                nextEl = nextEl.nextElementSibling;
                            }
                            h2Sections.push({ heading, firstParagraph: fp });
                        });
                        const hasFaqPattern = !!document.querySelector('[class*="faq"], [id*="faq"], [class*="FAQ"], [id*="FAQ"]') ||
                            html.includes("FAQPage") ||
                            bodyText.match(/Q[.:]\s|A[.:]\s|질문|답변|자주\s*묻는/i) !== null;
                        return { title, metaDesc, html, bodyText, h1s, h2s, firstParagraph: firstP, hasListElements, wordCount, h2Sections, hasFaqPattern };
                    });
                    await context.close();
                    send({ type: "step-done", step: 2, message: "✅ 웹페이지 크롤링 완료" });
                    crawlSuccess = true;
                    // Step 3: Web Optimization (Schema + Content combined, 20pts)
                    send({ type: "step", step: 3, label: "웹사이트 최적화 분석 중...", message: "Schema + 콘텐츠 구조를 분석합니다..." });
                    webOptimization = analyzeWebOptimization(pageData.html, pageData, body.businessName, businessType);
                    send({
                        type: "category-done", step: 3, category: "web_optimization",
                        label: webOptimization.label, score: webOptimization.score, maxScore: webOptimization.maxScore,
                        message: `✅ 웹사이트 최적화: ${webOptimization.score}/${webOptimization.maxScore}점`,
                    });
                }
                catch (crawlError) {
                    const errMsg = crawlError instanceof Error ? crawlError.message : String(crawlError);
                    let userMessage;
                    crawlSuccess = false;
                    if (errMsg.includes("ERR_NAME_NOT_RESOLVED")) {
                        userMessage = `웹사이트 주소(${websiteUrl})를 찾을 수 없습니다.`;
                    }
                    else if (errMsg.includes("ERR_CONNECTION_REFUSED")) {
                        userMessage = `웹사이트(${websiteUrl})에 연결할 수 없습니다.`;
                    }
                    else if (errMsg.includes("Timeout")) {
                        userMessage = `웹사이트(${websiteUrl}) 연결 시간 초과.`;
                    }
                    else {
                        userMessage = `웹사이트(${websiteUrl}) 크롤링 실패: ${errMsg.slice(0, 100)}`;
                    }
                    crawlFailedReason = userMessage;
                    send({ type: "step-done", step: 2, message: `⚠️ ${userMessage}` });
                }
                if (!crawlSuccess) {
                    send({ type: "step", step: 3, label: "웹사이트 최적화...", message: "웹사이트 접근 불가로 진단할 수 없습니다." });
                    webOptimization = noWebsiteOptimization();
                    send({ type: "category-done", step: 3, category: "web_optimization", label: webOptimization.label, score: 0, maxScore: 20, message: "⚠️ 웹사이트 최적화: 0/20점 (접근 불가)" });
                }
            }
            else {
                send({ type: "step", step: 2, label: "웹사이트 확인...", message: "웹사이트 미발견. 권위성 진단으로 넘어갑니다." });
                send({ type: "step-done", step: 2, message: "⏭️ 웹사이트 미발견 — 크롤링 건너뜀" });
                send({ type: "step", step: 3, label: "웹사이트 최적화...", message: "웹사이트가 없어 진단할 수 없습니다." });
                webOptimization = noWebsiteOptimization();
                send({ type: "category-done", step: 3, category: "web_optimization", label: webOptimization.label, score: 0, maxScore: 20, message: "⚠️ 웹사이트 최적화: 0/20점 (웹사이트 없음)" });
            }
            // Step 4: Entity Authority (40pts) — 핵심 점수
            send({ type: "step", step: 4, label: "엔티티 권위성 분석 중...", message: "리뷰 수, 블로그 언급, 뉴스 노출을 분석합니다..." });
            const entityAuthority = analyzeEntityAuthority(discovery);
            send({
                type: "category-done", step: 4, category: "entity_authority",
                label: entityAuthority.label, score: entityAuthority.score, maxScore: entityAuthority.maxScore,
                message: `✅ 엔티티 권위성: ${entityAuthority.score}/${entityAuthority.maxScore}점`,
            });
            // Step 5: Platform Presence (30pts)
            send({ type: "step", step: 5, label: "플랫폼 존재감 확인 중...", message: "네이버/구글/카카오 등록 여부를 확인합니다..." });
            const platformPresence = analyzePlatformPresence(discovery);
            send({
                type: "category-done", step: 5, category: "platform_presence",
                label: platformPresence.label, score: platformPresence.score, maxScore: platformPresence.maxScore,
                message: `✅ 플랫폼 존재감: ${platformPresence.score}/${platformPresence.maxScore}점`,
            });
            // Step 6: AI Accessibility (10pts)
            send({ type: "step", step: 6, label: "AI 접근성 확인 중...", message: "robots.txt, llms.txt, sitemap 등을 확인합니다..." });
            const aiAccessibility = await analyzeAiAccessibility(websiteUrl);
            send({
                type: "category-done", step: 6, category: "ai_accessibility",
                label: aiAccessibility.label, score: aiAccessibility.score, maxScore: aiAccessibility.maxScore,
                message: `✅ AI 접근성: ${aiAccessibility.score}/${aiAccessibility.maxScore}점`,
            });
            // Step 7: Calculate total & generate summary
            const categories = [entityAuthority, platformPresence, webOptimization, aiAccessibility];
            const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
            const grade = computeGrade(totalScore);
            send({ type: "step", step: 7, label: "AI 종합 평가 생성 중...", message: "결과를 분석하고 개선 가이드를 작성합니다..." });
            const { summary, topPriorities } = await generateAiSummary(body.businessName, totalScore, grade, categories);
            // Final result
            send({
                type: "done",
                businessName: body.businessName,
                websiteUrl: websiteUrl || "",
                hasWebsite,
                crawlFailed: hasWebsite && !crawlSuccess,
                crawlError: crawlFailedReason || undefined,
                totalScore,
                grade,
                categories,
                summary,
                topPriorities,
                scanDate: new Date().toISOString(),
                discoveredSources: discovery.sources,
                message: `진단 완료! ${body.businessName}: ${totalScore}점 (${grade}등급)${!hasWebsite ? " — 웹사이트 제작 시 최대 30점 추가 가능" : ""}`,
            });
        }
        catch (error) {
            send({
                type: "error",
                message: `진단 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
            });
        }
        finally {
            close();
        }
    });
}
//# sourceMappingURL=score-checker.js.map