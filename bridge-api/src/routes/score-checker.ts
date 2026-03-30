import type { FastifyInstance } from "fastify";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { setupSSE } from "../utils/sse.js";
import { getBrowser } from "../utils/browser.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface DiagnosisRequest {
  businessName: string;
  websiteUrl: string;
  address: string;
  businessType: string;
  phone: string;
}

interface CheckItem {
  name: string;
  maxScore: number;
  actualScore: number;
  status: "pass" | "fail" | "partial";
  recommendation: string;
}

interface CategoryResult {
  label: string;
  maxScore: number;
  score: number;
  items: CheckItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGeminiClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY;
  return key ? new GoogleGenerativeAI(key) : null;
}

function computeGrade(score: number): string {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

// ── Category A: Structured Data (30 pts) ─────────────────────────────────────

const LOCAL_BIZ_TYPES = [
  "LocalBusiness", "Restaurant", "CafeOrCoffeeShop", "Dentist",
  "MedicalBusiness", "BeautySalon", "NailSalon", "HealthClub",
  "SportsActivityLocation", "EducationalOrganization", "Store",
  "BarOrPub", "BakeryOrPatisserie", "LodgingBusiness",
];

const SPECIFIC_TYPES: Record<string, string[]> = {
  restaurant: ["Restaurant", "CafeOrCoffeeShop", "BarOrPub", "BakeryOrPatisserie"],
  cafe: ["CafeOrCoffeeShop", "Restaurant"],
  dermatology: ["MedicalBusiness", "Physician", "Dermatology"],
  dental: ["Dentist", "MedicalBusiness"],
  hair_salon: ["BeautySalon", "HealthAndBeautyBusiness"],
  nail_salon: ["NailSalon", "HealthAndBeautyBusiness"],
  academy: ["EducationalOrganization", "School"],
  gym: ["SportsActivityLocation", "HealthClub", "ExerciseGym"],
};

function analyzeStructuredData(
  html: string,
  businessType: string
): CategoryResult {
  const items: CheckItem[] = [];

  // Extract all JSON-LD blocks
  const jsonLdRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const jsonLdBlocks: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) jsonLdBlocks.push(...parsed);
      else jsonLdBlocks.push(parsed);
      // Handle @graph
      if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
        jsonLdBlocks.push(...parsed["@graph"]);
      }
    } catch { /* skip */ }
  }

  const allTypes = jsonLdBlocks
    .map((b) => b["@type"] as string)
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
  const localBizBlock = jsonLdBlocks.find((b) =>
    LOCAL_BIZ_TYPES.includes(b["@type"] as string)
  ) as Record<string, unknown> | undefined;
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
    recommendation:
      napCount >= 3
        ? "이름, 주소, 전화번호가 모두 Schema에 포함되어 있습니다."
        : `Schema에 ${!hasName ? "name, " : ""}${!hasAddress ? "address, " : ""}${!hasPhone ? "telephone, " : ""}정보를 추가하세요.`,
  });

  const score = items.reduce((sum, item) => sum + item.actualScore, 0);
  return { label: "구조화 데이터", maxScore: 30, score, items };
}

// ── Category B: Content Quality (30 pts) ─────────────────────────────────────

interface PageContent {
  title: string;
  metaDesc: string;
  h1s: string[];
  h2s: string[];
  bodyText: string;
  firstParagraph: string;
  hasListElements: boolean;
  wordCount: number;
  h2Sections: Array<{ heading: string; firstParagraph: string }>;
  hasFaqPattern: boolean;
}

function analyzeContentQuality(
  content: PageContent,
  businessName: string,
  address: string
): CategoryResult {
  const items: CheckItem[] = [];

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
    recommendation:
      h1Score >= 5
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
    recommendation:
      h2Count >= 3
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
    recommendation:
      firstPScore >= 5
        ? "첫 문단에서 업체와 지역이 명확히 선언되어 있습니다."
        : `페이지 첫 문단에 "${businessName}은(는) ${locationStr}에 위치한 ..." 형태로 엔티티를 명확히 선언하세요.`,
  });

  // 5. 패시지 독립성 (4점)
  const goodSections = content.h2Sections.filter(
    (s) => s.firstParagraph.length >= 40
  ).length;
  const passageScore =
    goodSections >= 3 ? 4 : goodSections >= 2 ? 2 : goodSections >= 1 ? 1 : 0;
  items.push({
    name: "패시지 독립성 (각 섹션 완결성)",
    maxScore: 4,
    actualScore: passageScore,
    status: passageScore >= 4 ? "pass" : passageScore > 0 ? "partial" : "fail",
    recommendation:
      passageScore >= 4
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
    recommendation:
      content.wordCount >= 300
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

// ── Category C: Entity Presence (25 pts) ─────────────────────────────────────

async function analyzeEntityPresence(
  businessName: string,
  address: string
): Promise<CategoryResult> {
  const items: CheckItem[] = [];
  const hasNaverApi = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
  const hasKakaoApi = !!process.env.KAKAO_REST_API_KEY;
  const hasGoogleApi = !!process.env.GOOGLE_PLACES_API_KEY;

  // 1. 네이버 플레이스 (7점)
  if (hasNaverApi) {
    try {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(businessName)}&display=5`,
        {
          headers: {
            "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
            "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
          },
        }
      );
      const data = (await res.json()) as { total: number; items: Array<{ title: string }> };
      const found = data.total > 0;
      items.push({
        name: "네이버 플레이스 등록 여부",
        maxScore: 7,
        actualScore: found ? 7 : 0,
        status: found ? "pass" : "fail",
        recommendation: found
          ? `네이버 플레이스에 등록되어 있습니다 (검색 결과 ${data.total}건).`
          : "네이버 플레이스에 업체를 등록하세요. 한국 시장에서 AI 노출의 핵심입니다.",
      });
    } catch {
      items.push({
        name: "네이버 플레이스 등록 여부",
        maxScore: 7, actualScore: 0, status: "fail",
        recommendation: "네이버 API 호출 중 오류가 발생했습니다.",
      });
    }
  } else {
    items.push({
      name: "네이버 플레이스 등록 여부",
      maxScore: 7, actualScore: 0, status: "fail",
      recommendation: "네이버 검색 API 키가 설정되지 않아 진단할 수 없습니다. (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)",
    });
  }

  // 2. 구글 비즈니스 (7점)
  if (hasGoogleApi) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(businessName + " " + address)}&inputtype=textquery&fields=name,formatted_address&key=${process.env.GOOGLE_PLACES_API_KEY}`
      );
      const data = (await res.json()) as { candidates: unknown[] };
      const found = data.candidates?.length > 0;
      items.push({
        name: "구글 비즈니스 프로필 등록 여부",
        maxScore: 7,
        actualScore: found ? 7 : 0,
        status: found ? "pass" : "fail",
        recommendation: found
          ? "구글 비즈니스 프로필에 등록되어 있습니다."
          : "구글 비즈니스 프로필(GBP)에 업체를 등록하세요. 글로벌 AI 노출에 필수입니다.",
      });
    } catch {
      items.push({
        name: "구글 비즈니스 프로필 등록 여부",
        maxScore: 7, actualScore: 0, status: "fail",
        recommendation: "Google Places API 호출 중 오류가 발생했습니다.",
      });
    }
  } else {
    items.push({
      name: "구글 비즈니스 프로필 등록 여부",
      maxScore: 7, actualScore: 0, status: "fail",
      recommendation: "Google Places API 키가 설정되지 않아 진단할 수 없습니다. (GOOGLE_PLACES_API_KEY)",
    });
  }

  // 3. 카카오맵 (4점)
  if (hasKakaoApi) {
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(businessName)}`,
        {
          headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
        }
      );
      const data = (await res.json()) as { meta: { total_count: number } };
      const found = data.meta?.total_count > 0;
      items.push({
        name: "카카오맵 등록 여부",
        maxScore: 4,
        actualScore: found ? 4 : 0,
        status: found ? "pass" : "fail",
        recommendation: found
          ? `카카오맵에 등록되어 있습니다 (${data.meta.total_count}건).`
          : "카카오맵에 업체를 등록하면 카카오 생태계 내 AI 노출에 도움됩니다.",
      });
    } catch {
      items.push({
        name: "카카오맵 등록 여부",
        maxScore: 4, actualScore: 0, status: "fail",
        recommendation: "카카오 API 호출 중 오류가 발생했습니다.",
      });
    }
  } else {
    items.push({
      name: "카카오맵 등록 여부",
      maxScore: 4, actualScore: 0, status: "fail",
      recommendation: "카카오 REST API 키가 설정되지 않아 진단할 수 없습니다. (KAKAO_REST_API_KEY)",
    });
  }

  // 4. NAP 일관성 (4점) — 간소화: API 사용 가능 여부에 따라
  items.push({
    name: "NAP 일관성 (플랫폼 간 정보 일치)",
    maxScore: 4,
    actualScore: 0,
    status: "fail",
    recommendation: "여러 플랫폼의 업체명/주소/전화번호가 동일한지 수동 확인이 필요합니다.",
  });

  // 5. 업종 디렉토리 등록 수 (3점)
  items.push({
    name: "업종 디렉토리 등록 수",
    maxScore: 3,
    actualScore: 0,
    status: "fail",
    recommendation: "업종별 전문 디렉토리(예: 다이닝코드, 식신, 강남닷컴 등)에 등록하면 엔티티 존재감이 강화됩니다.",
  });

  const score = items.reduce((sum, item) => sum + item.actualScore, 0);
  return { label: "엔티티 존재감", maxScore: 25, score, items };
}

// ── Category D: Authority Signals (15 pts) ───────────────────────────────────

async function analyzeAuthoritySignals(
  businessName: string
): Promise<CategoryResult> {
  const items: CheckItem[] = [];
  const hasNaverApi = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
  const hasGoogleApi = !!process.env.GOOGLE_PLACES_API_KEY;

  // 1. 구글 리뷰 수 (4점)
  if (hasGoogleApi) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(businessName)}&inputtype=textquery&fields=user_ratings_total,rating&key=${process.env.GOOGLE_PLACES_API_KEY}`
      );
      const data = (await res.json()) as {
        candidates: Array<{ user_ratings_total?: number; rating?: number }>;
      };
      const c = data.candidates?.[0];
      const reviewCount = c?.user_ratings_total || 0;
      const reviewScore = reviewCount >= 100 ? 4 : reviewCount >= 50 ? 3 : reviewCount >= 10 ? 2 : reviewCount > 0 ? 1 : 0;
      items.push({
        name: "구글 리뷰 수",
        maxScore: 4,
        actualScore: reviewScore,
        status: reviewScore >= 3 ? "pass" : reviewScore > 0 ? "partial" : "fail",
        recommendation: reviewCount > 0
          ? `구글 리뷰 ${reviewCount}개 (${reviewScore >= 3 ? "충분" : "더 수집 권장"}).`
          : "구글 리뷰를 수집하세요. 리뷰 수가 많을수록 AI가 신뢰하는 업체로 판단합니다.",
      });

      // 2. 구글 리뷰 평균 평점 (2점)
      const rating = c?.rating || 0;
      const ratingScore = rating >= 4.0 ? 2 : rating >= 3.5 ? 1 : 0;
      items.push({
        name: "구글 리뷰 평균 평점",
        maxScore: 2,
        actualScore: ratingScore,
        status: ratingScore >= 2 ? "pass" : ratingScore > 0 ? "partial" : "fail",
        recommendation: rating > 0
          ? `구글 평점 ${rating}점 (${rating >= 4.0 ? "우수" : "개선 여지 있음"}).`
          : "구글 리뷰를 수집하여 평점을 확보하세요.",
      });
    } catch {
      items.push(
        { name: "구글 리뷰 수", maxScore: 4, actualScore: 0, status: "fail", recommendation: "Google API 오류." },
        { name: "구글 리뷰 평균 평점", maxScore: 2, actualScore: 0, status: "fail", recommendation: "Google API 오류." }
      );
    }
  } else {
    items.push(
      { name: "구글 리뷰 수", maxScore: 4, actualScore: 0, status: "fail", recommendation: "Google Places API 키 미설정." },
      { name: "구글 리뷰 평균 평점", maxScore: 2, actualScore: 0, status: "fail", recommendation: "Google Places API 키 미설정." }
    );
  }

  // 3. 네이버 리뷰/블로그 언급 수 (4점)
  if (hasNaverApi) {
    try {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(businessName)}&display=1`,
        {
          headers: {
            "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
            "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
          },
        }
      );
      const data = (await res.json()) as { total: number };
      const blogCount = data.total || 0;
      const blogScore = blogCount >= 100 ? 4 : blogCount >= 30 ? 3 : blogCount >= 10 ? 2 : blogCount > 0 ? 1 : 0;
      items.push({
        name: "네이버 블로그 언급 수",
        maxScore: 4,
        actualScore: blogScore,
        status: blogScore >= 3 ? "pass" : blogScore > 0 ? "partial" : "fail",
        recommendation: `네이버 블로그에서 ${blogCount}건 언급. ${blogScore >= 3 ? "충분한 온라인 존재감입니다." : "블로그 마케팅을 통해 언급 수를 늘리세요."}`,
      });
    } catch {
      items.push({
        name: "네이버 블로그 언급 수",
        maxScore: 4, actualScore: 0, status: "fail",
        recommendation: "네이버 API 호출 오류.",
      });
    }
  } else {
    items.push({
      name: "네이버 블로그 언급 수",
      maxScore: 4, actualScore: 0, status: "fail",
      recommendation: "네이버 검색 API 키 미설정.",
    });
  }

  // 4. 블로그 포스트 빈도 (3점) — 네이버 blog 검색 활용
  items.push({
    name: "블로그 포스트 언급 빈도",
    maxScore: 3,
    actualScore: 0,
    status: "fail",
    recommendation: "정기적인 블로그 포스팅과 리뷰 관리로 온라인 권위성을 높이세요.",
  });

  // 5. SNS 멘션 (2점)
  items.push({
    name: "SNS 멘션 (인스타그램 해시태그 등)",
    maxScore: 2,
    actualScore: 0,
    status: "fail",
    recommendation: "인스타그램 해시태그, SNS 언급을 통해 브랜드 인지도를 높이세요.",
  });

  const score = items.reduce((sum, item) => sum + item.actualScore, 0);
  return { label: "권위성 신호", maxScore: 15, score, items };
}

// ── AI Summary Generation ────────────────────────────────────────────────────

async function generateAiSummary(
  businessName: string,
  totalScore: number,
  grade: string,
  categories: CategoryResult[]
): Promise<{ summary: string; topPriorities: string[] }> {
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
    .map(
      (c) =>
        `${c.label} (${c.score}/${c.maxScore}점):\n${c.items.map((i) => `  - ${i.name}: ${i.status} (${i.actualScore}/${i.maxScore})`).join("\n")}`
    )
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
  } catch { /* fallback */ }

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

function noWebsiteStructuredData(): CategoryResult {
  const baseMsg = "자체 웹사이트가 없어 진단할 수 없습니다. 웹사이트를 제작하고 Schema를 설치하면 최대 30점을 추가 확보할 수 있습니다.";
  const items: CheckItem[] = [
    { name: "LocalBusiness Schema 존재 여부", maxScore: 8, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "업종별 세부 Schema 타입 사용", maxScore: 4, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "FAQPage Schema 존재 여부", maxScore: 4, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "메뉴/서비스 Schema 존재 여부", maxScore: 4, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "GeoCoordinates(위치 좌표) 포함", maxScore: 3, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "영업시간(OpeningHoursSpecification) 포함", maxScore: 3, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "AggregateRating(평점) 포함", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "NAP(이름/주소/전화) 정보 포함", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
  ];
  return { label: "구조화 데이터", maxScore: 30, score: 0, items };
}

function noWebsiteContentQuality(): CategoryResult {
  const baseMsg = "자체 웹사이트가 없어 진단할 수 없습니다. 웹사이트를 제작하고 AEO 최적화 콘텐츠를 작성하면 최대 30점을 추가 확보할 수 있습니다.";
  const items: CheckItem[] = [
    { name: "H1 태그에 업체명+지역명 포함", maxScore: 5, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "FAQ 섹션 존재 여부", maxScore: 5, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "첫 문단에 업체명+지역 선언", maxScore: 5, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "패시지 독립성 (각 섹션 완결성)", maxScore: 4, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "메뉴/서비스 리스트 구조화 (<ul><li>)", maxScore: 4, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "H2 태그 3개 이상 존재", maxScore: 3, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "페이지 텍스트 총량 (300단어 이상)", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
    { name: "meta description 존재 및 길이 적정", maxScore: 2, actualScore: 0, status: "fail", recommendation: baseMsg },
  ];
  return { label: "콘텐츠 품질", maxScore: 30, score: 0, items };
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function scoreCheckerRoutes(app: FastifyInstance) {
  // ─── POST /score-checker/analyze ───────────────────────────
  app.post("/score-checker/analyze", async (req, reply) => {
    const body = req.body as DiagnosisRequest;

    if (!body.businessName) {
      return reply.status(400).send({ error: "업체명은 필수입니다." });
    }

    const hasWebsite = !!body.websiteUrl?.trim();
    const { send, close } = setupSSE(reply);

    try {
      send({
        type: "start",
        businessName: body.businessName,
        hasWebsite,
        message: `${body.businessName} 진단 시작...${hasWebsite ? "" : " (웹사이트 없음 — 엔티티/권위성만 진단)"}`,
      });

      let structuredData: CategoryResult;
      let contentQuality: CategoryResult;

      if (hasWebsite) {
        // ── Website exists: crawl and analyze A & B ──
        send({ type: "step", step: 1, label: "웹페이지 크롤링 중...", message: "웹사이트 HTML을 가져오고 있습니다..." });

        const browser = await getBrowser();
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();

        await page.goto(body.websiteUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        const pageData = await page.evaluate(() => {
          const title = document.title || "";
          const metaDesc =
            document
              .querySelector('meta[name="description"]')
              ?.getAttribute("content") || "";
          const html = document.documentElement.outerHTML;
          const bodyText = document.body?.innerText || "";

          const h1s = Array.from(document.querySelectorAll("h1")).map(
            (el) => el.textContent?.trim() || ""
          );
          const h2s = Array.from(document.querySelectorAll("h2")).map(
            (el) => el.textContent?.trim() || ""
          );
          const firstP =
            document.querySelector("p")?.textContent?.trim() || "";
          const hasListElements =
            document.querySelectorAll("ul li, ol li").length >= 3;
          const cleanText = bodyText.replace(/\s+/g, " ").trim();
          const wordCount = cleanText.length > 0
            ? Math.round(cleanText.split(/\s+/).length + cleanText.replace(/[a-zA-Z\s]/g, "").length / 2)
            : 0;

          const h2Sections: Array<{ heading: string; firstParagraph: string }> = [];
          const h2Elements = document.querySelectorAll("h2");
          h2Elements.forEach((h2) => {
            const heading = h2.textContent?.trim() || "";
            let nextEl = h2.nextElementSibling;
            let fp = "";
            while (nextEl && nextEl.tagName !== "H2" && !fp) {
              if (nextEl.tagName === "P" && nextEl.textContent) {
                fp = nextEl.textContent.trim();
              }
              nextEl = nextEl.nextElementSibling;
            }
            h2Sections.push({ heading, firstParagraph: fp });
          });

          const hasFaqPattern =
            !!document.querySelector('[class*="faq"], [id*="faq"], [class*="FAQ"], [id*="FAQ"]') ||
            html.includes("FAQPage") ||
            bodyText.match(/Q[.:]\s|A[.:]\s|질문|답변|자주\s*묻는/i) !== null;

          return {
            title, metaDesc, html, bodyText,
            h1s, h2s, firstParagraph: firstP,
            hasListElements, wordCount, h2Sections,
            hasFaqPattern,
          };
        });

        await context.close();

        send({ type: "step-done", step: 1, message: "✅ 웹페이지 크롤링 완료" });

        // Step 2: Structured Data
        send({ type: "step", step: 2, label: "구조화 데이터 분석 중...", message: "JSON-LD Schema를 분석하고 있습니다..." });
        structuredData = analyzeStructuredData(pageData.html, body.businessType);
        send({
          type: "category-done", step: 2, category: "structured_data",
          label: structuredData.label, score: structuredData.score, maxScore: structuredData.maxScore,
          message: `✅ 구조화 데이터: ${structuredData.score}/${structuredData.maxScore}점`,
        });

        // Step 3: Content Quality
        send({ type: "step", step: 3, label: "콘텐츠 품질 체크 중...", message: "페이지 구조와 콘텐츠를 분석하고 있습니다..." });
        contentQuality = analyzeContentQuality(pageData as PageContent, body.businessName, body.address);
        send({
          type: "category-done", step: 3, category: "content_quality",
          label: contentQuality.label, score: contentQuality.score, maxScore: contentQuality.maxScore,
          message: `✅ 콘텐츠 품질: ${contentQuality.score}/${contentQuality.maxScore}점`,
        });
      } else {
        // ── No website: skip A & B with 0 points ──
        send({ type: "step", step: 1, label: "웹사이트 확인...", message: "웹사이트가 입력되지 않았습니다. 엔티티/권위성 진단으로 넘어갑니다." });
        send({ type: "step-done", step: 1, message: "⏭️ 웹사이트 없음 — 크롤링 건너뜀" });

        send({ type: "step", step: 2, label: "구조화 데이터...", message: "웹사이트가 없어 구조화 데이터를 진단할 수 없습니다." });
        structuredData = noWebsiteStructuredData();
        send({
          type: "category-done", step: 2, category: "structured_data",
          label: structuredData.label, score: 0, maxScore: 30,
          message: "⚠️ 구조화 데이터: 0/30점 (웹사이트 없음)",
        });

        send({ type: "step", step: 3, label: "콘텐츠 품질...", message: "웹사이트가 없어 콘텐츠 품질을 진단할 수 없습니다." });
        contentQuality = noWebsiteContentQuality();
        send({
          type: "category-done", step: 3, category: "content_quality",
          label: contentQuality.label, score: 0, maxScore: 30,
          message: "⚠️ 콘텐츠 품질: 0/30점 (웹사이트 없음)",
        });
      }

      // Step 4: Entity Presence (always runs)
      send({ type: "step", step: 4, label: "엔티티 존재감 확인 중...", message: "네이버/구글/카카오 등록 여부를 확인합니다..." });
      const entityPresence = await analyzeEntityPresence(body.businessName, body.address);
      send({
        type: "category-done", step: 4, category: "entity_presence",
        label: entityPresence.label, score: entityPresence.score, maxScore: entityPresence.maxScore,
        message: `✅ 엔티티 존재감: ${entityPresence.score}/${entityPresence.maxScore}점`,
      });

      // Step 5: Authority Signals (always runs)
      send({ type: "step", step: 5, label: "권위성 신호 수집 중...", message: "리뷰, 블로그 언급 등을 확인합니다..." });
      const authoritySignals = await analyzeAuthoritySignals(body.businessName);
      send({
        type: "category-done", step: 5, category: "authority_signals",
        label: authoritySignals.label, score: authoritySignals.score, maxScore: authoritySignals.maxScore,
        message: `✅ 권위성 신호: ${authoritySignals.score}/${authoritySignals.maxScore}점`,
      });

      // Step 6: Calculate total & generate summary
      const categories = [structuredData, contentQuality, entityPresence, authoritySignals];
      const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
      const grade = computeGrade(totalScore);

      send({ type: "step", step: 6, label: "AI 종합 평가 생성 중...", message: "결과를 분석하고 개선 가이드를 작성합니다..." });
      const { summary, topPriorities } = await generateAiSummary(
        body.businessName,
        totalScore,
        grade,
        categories
      );

      // Final result
      send({
        type: "done",
        businessName: body.businessName,
        websiteUrl: body.websiteUrl || "",
        hasWebsite,
        totalScore,
        grade,
        categories,
        summary,
        topPriorities,
        scanDate: new Date().toISOString(),
        message: `진단 완료! ${body.businessName}: ${totalScore}점 (${grade}등급)${!hasWebsite ? " — 웹사이트 제작 시 최대 60점 추가 가능" : ""}`,
      });
    } catch (error) {
      send({
        type: "error",
        message: `진단 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      });
    } finally {
      close();
    }
  });
}
