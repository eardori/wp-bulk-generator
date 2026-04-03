import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";
import { sanitizeGeneratedArticle } from "../lib/article-sanitizer.js";
import type {
  ScrapedProduct,
  ProductReview,
  ReviewImage,
  ReviewCollection,
  ReviewTheme,
} from "../types.js";

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
    age: number;
    concern: string;
    expertise: string;
    tone: string;
    bio: string;
  } | null;
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

type ArticleTask = {
  site: SiteCredential;
  siteArticleIndex: number;
  diversityIndex: number;
};

type IndexedReview = {
  globalIndex: number;
  review: ProductReview;
};

type ProductAngleConfig = {
  label: string;
  titleFormat: string;
  h2Structure: string;
  emphasis: string;
};

type ReviewImageIndex = [number, number];
type SitePersona = NonNullable<SiteCredential["persona"]>;
type ReaderLens = {
  label: string;
  instruction: string;
  narrativeAngle: string;
};

// ── Content Strategy Types ──────────────────────────────────────────────────

type ContentStrategy = {
  name: string;
  description?: string;
  toneOverride?: string;
  targetKeywords?: string[];
  semanticKeywords?: string[];
  keywordOptimization?: {
    titleRule?: string;
    introRule?: string;
    h2Rule?: string;
  };
  htmlStructureRules?: {
    useBulletPoints?: string;
    endingSection?: string;
  };
  coreNarratives?: Array<{
    label: string;
    content: string;
  }>;
};

// ── AEO Types ───────────────────────────────────────────────────────────────

type AeoBusinessType = "restaurant" | "cafe" | "dermatology" | "beauty_salon" | "academy" | "fitness" | "dental";

type AeoConfig = {
  businessType: AeoBusinessType;
  businessName: string;
  mainKeyword: string;
  subKeywords?: string;
  locationShort: string;
  broaderArea: string;
  address?: string;
  phone?: string;
  hours?: string;
  reservations?: boolean;
  menuItems?: string;
  visitPurposes?: string;
  additionalInfo?: string;
};

type AeoBusinessTypeMapping = {
  persona: string;
  schemaType: string;
  foodType: string;
  sectionTitles: {
    highlight: string;
    atmosphere: string;
    menu: string;
    visitInfo: string;
  };
};

const DEFAULT_PERSONA: SitePersona = {
  name: "운영팀",
  age: 35,
  concern: "실사용 후기",
  expertise: "제품 분석",
  tone: "신뢰감 있는",
  bio: "실구매 리뷰와 공개 정보를 바탕으로 핵심만 정리해 전달합니다.",
};
const GEMINI_CONTENT_MODEL =
  process.env.GEMINI_CONTENT_MODEL || "gemini-2.5-flash-lite";
const GEMINI_CONTENT_FALLBACK_MODEL =
  process.env.GEMINI_CONTENT_FALLBACK_MODEL || "gemini-2.5-flash";

const REVIEW_TERM_STOPWORDS = new Set([
  "정말", "진짜", "그냥", "약간", "조금", "너무", "엄청", "가장", "많이", "매우",
  "그리고", "하지만", "그래서", "또한", "이런", "저런", "같은", "이곳", "여기", "거의",
  "방문", "후기", "리뷰", "매장", "가게", "음식", "제품", "사용", "구매", "추천",
  "about", "with", "this", "that", "very", "really", "good", "nice",
]);

const PRODUCT_READER_LENSES: ReaderLens[] = [
  { label: "입문자 관점", instruction: "처음 접하는 사람이 이해하기 쉽게, 용어를 풀어서 설명하세요.", narrativeAngle: "처음 사는 사람이 가장 궁금해할 포인트 중심" },
  { label: "가성비 중시 관점", instruction: "가격 대비 만족도와 아쉬운 점을 냉정하게 비교하세요.", narrativeAngle: "돈값 하는지 판단하는 흐름" },
  { label: "성분 분석 관점", instruction: "성분/원료와 리뷰 반응의 연결을 중심으로 해석하세요.", narrativeAngle: "스펙과 실제 반응을 엮는 분석형" },
  { label: "민감형 사용자 관점", instruction: "자극, 불편감, 호불호 포인트를 선명하게 나누세요.", narrativeAngle: "맞는 사람과 주의할 사람을 분리" },
  { label: "실사용 루틴 관점", instruction: "언제, 어떻게 쓰는지와 사용 팁을 구체적으로 정리하세요.", narrativeAngle: "실제 사용 장면을 중심으로 전개" },
  { label: "장단점 균형 관점", instruction: "광고처럼 보이지 않게 장점과 단점을 거의 같은 비중으로 다루세요.", narrativeAngle: "구매 전 체크리스트형" },
  { label: "재구매 판단 관점", instruction: "다시 살지 말지를 결정하는 기준으로 서술하세요.", narrativeAngle: "재구매 의사와 추천 대상을 분리" },
  { label: "문제 해결 관점", instruction: "사용자 고민이 실제로 얼마나 해결되는지를 리뷰 근거로 판단하세요.", narrativeAngle: "질문 해결형 결론 우선 구조" },
];

const PLACE_READER_LENSES: ReaderLens[] = [
  { label: "첫 방문자 관점", instruction: "처음 가는 사람이 헷갈릴 포인트를 미리 알려주세요.", narrativeAngle: "처음 가는 사람용 실전 안내" },
  { label: "데이트 방문 관점", instruction: "분위기, 좌석, 동선, 예약 포인트를 강조하세요.", narrativeAngle: "분위기와 체류 경험 중심" },
  { label: "가족 외식 관점", instruction: "주차, 좌석, 메뉴 난이도, 아이/어르신 적합성을 나눠 설명하세요.", narrativeAngle: "가족 단위 방문 판단형" },
  { label: "가성비 중시 관점", instruction: "가격대, 양, 만족도, 재방문 의사를 중심으로 평가하세요.", narrativeAngle: "가격 대비 만족도 검증형" },
  { label: "로컬 추천 관점", instruction: "관광객보다 동네 단골이 좋아할 포인트를 강조하세요.", narrativeAngle: "숨은 맛집 발굴형" },
  { label: "메뉴 선택 관점", instruction: "무엇을 시켜야 하는지와 피해야 할 선택지를 명확히 나누세요.", narrativeAngle: "메뉴 추천과 조합 중심" },
  { label: "웨이팅 회피 관점", instruction: "방문 시간대, 예약/대기, 동선 팁을 실용적으로 정리하세요.", narrativeAngle: "실전 방문 팁 중심" },
  { label: "SNS 기대 대비 현실 관점", instruction: "사진발과 실제 만족도를 분리해서 솔직하게 다루세요.", narrativeAngle: "기대 vs 현실 비교형" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const temp = x % y;
    x = y;
    y = temp;
  }
  return x || 1;
}

function pickCoPrimeStep(reviewCount: number, preferredStep: number): number {
  let step = Math.max(1, preferredStep);
  while (greatestCommonDivisor(step, reviewCount) !== 1) {
    step += 1;
  }
  return step;
}

async function requestGeminiContent(
  apiKey: string,
  prompt: string,
  generationConfig: Record<string, unknown>
) {
  const models = Array.from(
    new Set([GEMINI_CONTENT_MODEL, GEMINI_CONTENT_FALLBACK_MODEL].filter(Boolean))
  );

  let lastError: Error | null = null;

  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }),
      }
    );

    if (res.ok) {
      return res.json();
    }

    const err = await res.text();
    lastError = new Error(`Gemini API 오류 (${res.status}, model=${model}): ${err.slice(0, 200)}`);

    if ((res.status === 400 || res.status === 404) && model !== models[models.length - 1]) {
      console.warn(`[generate-articles] Gemini model unavailable, retrying with fallback: ${model}`);
      continue;
    }

    throw lastError;
  }

  throw lastError || new Error("Gemini API 요청에 실패했습니다.");
}

function pickReviewIndices(reviewCount: number, articleVariation: number, windowSize = 30, segments = 8) {
  if (reviewCount <= 0) return [];
  if (reviewCount <= windowSize) {
    return Array.from({ length: reviewCount }, (_, idx) => idx);
  }

  const offsetStep = pickCoPrimeStep(reviewCount, Math.max(3, Math.floor(reviewCount / segments)));
  const spreadStep = pickCoPrimeStep(reviewCount, Math.max(2, Math.floor(reviewCount / windowSize) + 1));
  const offset = (articleVariation * offsetStep) % reviewCount;

  return Array.from({ length: windowSize }, (_, idx) => (offset + idx * spreadStep) % reviewCount);
}

function buildIndexedReviews(
  reviews: ProductReview[],
  articleVariation: number,
  windowSize = 30,
  segments = 8
): IndexedReview[] {
  return pickReviewIndices(reviews.length, articleVariation, windowSize, segments).map((globalIndex) => ({
    globalIndex,
    review: reviews[globalIndex],
  }));
}

function truncateText(text: string, limit = 90) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function formatPercent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function estimateVisibleWordCount(html: string) {
  const $ = cheerio.load(html || "", null, false);
  $("script, style, pre, code").remove();
  const text = $.text().replace(/\s+/g, " ").trim();
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches?.length ?? 0;
}

function normalizeContentPrompt(prompt: string): string {
  return (prompt || "").replace(/\r\n/g, "\n").trim();
}

function summarizeContentPrompt(prompt: string, limit = 90): string {
  const normalized = normalizeContentPrompt(prompt).replace(/\s+/g, " ");
  if (!normalized) {
    return "사용자 프롬프트 기반";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function normalizeRestaurantPlaceTitle(title: string): string {
  const normalized = (title || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[-:|].*$/, "")
    .trim();

  return normalized || "방문 장소";
}

function buildStructuredRestaurantTitleFromAngle(placeTitle: string, angleLabel: string): string {
  const place = normalizeRestaurantPlaceTitle(placeTitle);

  const angleMap: Record<string, string> = {
    "첫 방문 포인트 정리": "첫 방문 가이드",
    "메뉴 & 가격 정리": "메뉴와 가격 정리",
    "데이트 & 분위기 맛집": "분위기와 방문 포인트 정리",
    "가성비 & 만족도 정리": "가격대와 방문 포인트 정리",
    "대표 메뉴 선택 가이드": "추천 메뉴 정리",
    "타 가게와의 차별점": "차별점 정리",
    "가족 & 단체 방문 완전 가이드": "가족 모임 가이드",
    "인기 이유 & 방문 전 체크": "방문 전 체크포인트",
  };

  const angle = angleMap[angleLabel] || "방문 가이드";
  return `${place}: ${angle}`;
}

function firstNonEmptyText(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function getProductSpecValue(product: ScrapedProduct, aliases: string[]): string {
  for (const alias of aliases) {
    const value = product.specs[alias]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function buildRestaurantFactMap(product: ScrapedProduct) {
  return {
    address: getProductSpecValue(product, ["주소", "address"]),
    lotAddress: getProductSpecValue(product, ["지번주소", "formattedAddress"]),
    region: getProductSpecValue(product, ["지역", "region"]),
    phone: getProductSpecValue(product, ["전화", "phone"]),
    hours: getProductSpecValue(product, ["영업시간", "hours"]),
    facilities: getProductSpecValue(product, ["편의시설", "facilities"]),
    directions: getProductSpecValue(product, ["찾아가는길", "directions"]),
    keywords: getProductSpecValue(product, ["키워드", "tags"]),
    naverReviewSummary: getProductSpecValue(product, ["네이버리뷰", "aiBriefing"]),
    blogReviewCount: getProductSpecValue(product, ["블로그리뷰", "blogReviews"]),
    menuSummary: getProductSpecValue(product, ["대표메뉴", "menuSummary"]),
    priceRange: firstNonEmptyText(
      product.price,
      getProductSpecValue(product, ["가격대", "priceRange"])
    ),
  };
}

function pickReaderLens(isRestaurant: boolean, articleVariation: number): ReaderLens {
  const pool = isRestaurant ? PLACE_READER_LENSES : PRODUCT_READER_LENSES;
  return pool[articleVariation % pool.length];
}

function extractFrequentReviewTerms(reviews: ProductReview[], limit = 8): string[] {
  const counts = new Map<string, number>();

  for (const review of reviews) {
    const source = [
      review.purchaseOption?.trim() || "",
      review.text || "",
    ].join(" ");

    const tokens = source.match(/[A-Za-z0-9가-힣]{2,}/g) || [];
    for (const rawToken of tokens) {
      const token = rawToken.toLowerCase();
      if (REVIEW_TERM_STOPWORDS.has(token)) continue;
      if (/^\d+$/.test(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token, count]) => `${token}(${count})`);
}

function buildDirectReviewCoverageSummary(
  reviews: ProductReview[],
  heading = "전체 리뷰 공통 패턴"
): string {
  if (reviews.length === 0) return "";

  const averageRating = Math.round(
    (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10
  ) / 10;
  const positiveCount = reviews.filter((review) => review.rating >= 4).length;
  const negativeCount = reviews.filter((review) => review.rating > 0 && review.rating <= 3).length;
  const photoCount = reviews.filter((review) => (review.images?.length || 0) > 0).length;
  const reviewerCount = new Set(
    reviews.map((review) => review.reviewerName?.trim()).filter(Boolean)
  ).size;
  const frequentTerms = extractFrequentReviewTerms(reviews, 8);
  const optionCounts = Array.from(
    reviews.reduce((acc, review) => {
      const option = review.purchaseOption?.trim();
      if (!option) return acc;
      acc.set(option, (acc.get(option) || 0) + 1);
      return acc;
    }, new Map<string, number>())
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const datedReviews = reviews
    .map((review) => review.date?.trim())
    .filter(Boolean)
    .sort() as string[];

  let section = `\n### ${heading}:\n`;
  section += `- 전체 확보 리뷰: ${reviews.length}건\n`;
  section += `- 평균 평점: ${averageRating || 0}점\n`;
  section += `- 만족 리뷰 비율(4~5점): ${formatPercent(positiveCount, reviews.length)}%\n`;
  if (negativeCount > 0) {
    section += `- 아쉬움이 언급된 리뷰 비율(1~3점): ${formatPercent(negativeCount, reviews.length)}%\n`;
  }
  if (photoCount > 0) {
    section += `- 사진 첨부 리뷰: ${photoCount}건\n`;
  }
  if (reviewerCount > 0) {
    section += `- 확인 가능한 리뷰어 수: ${reviewerCount}명\n`;
  }
  if (datedReviews.length > 1) {
    section += `- 리뷰 시기 범위: ${datedReviews[0]!.slice(0, 10)} ~ ${datedReviews[datedReviews.length - 1]!.slice(0, 10)}\n`;
  }
  if (optionCounts.length > 0) {
    section += `- 자주 언급된 메뉴/옵션: ${optionCounts.map(([name, count]) => `${name}(${count})`).join(", ")}\n`;
  }
  if (frequentTerms.length > 0) {
    section += `- 전체 리뷰에서 반복된 핵심 단어: ${frequentTerms.join(", ")}\n`;
  }

  return section;
}

function pickRepresentativeReviews(indexedReviews: IndexedReview[]) {
  const picked: Array<{ label: string; item: IndexedReview }> = [];
  const seen = new Set<number>();

  const add = (label: string, item?: IndexedReview) => {
    if (!item || seen.has(item.globalIndex)) return;
    seen.add(item.globalIndex);
    picked.push({ label, item });
  };

  const byLength = [...indexedReviews].sort((a, b) => b.review.text.length - a.review.text.length);
  const highRated = [...indexedReviews]
    .filter(({ review }) => review.rating >= 5)
    .sort((a, b) => b.review.text.length - a.review.text.length);
  const lowRated = [...indexedReviews]
    .filter(({ review }) => review.rating <= 3)
    .sort((a, b) => b.review.text.length - a.review.text.length);
  const withImages = [...indexedReviews]
    .filter(({ review }) => (review.images?.length || 0) > 0)
    .sort((a, b) => (b.review.images?.length || 0) - (a.review.images?.length || 0));
  const withOption = [...indexedReviews]
    .filter(({ review }) => Boolean(review.purchaseOption?.trim()))
    .sort((a, b) => b.review.text.length - a.review.text.length);

  add("만족도가 높은 대표 리뷰", highRated[0] ?? byLength[0]);
  add("아쉬움이 드러난 리뷰", lowRated[0]);
  add("실사용 디테일이 있는 리뷰", withImages[0] ?? withOption[0]);
  add("서술이 가장 구체적인 리뷰", byLength[0]);

  return picked.slice(0, 4);
}

function extractReviewImageIndicesFromHtml(html: string): ReviewImageIndex[] {
  const matches = html.matchAll(/<!--\s*REVIEW_IMG:(\d+):(\d+)\s*-->/g);
  const indices: ReviewImageIndex[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const pair: ReviewImageIndex = [Number(match[1]), Number(match[2])];
    const key = `${pair[0]}:${pair[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    indices.push(pair);
  }

  return indices;
}

function normalizeReviewImageIndices(raw: unknown, reviews: ProductReview[], limit = 5): ReviewImageIndex[] {
  if (!Array.isArray(raw)) return [];

  const result: ReviewImageIndex[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const reviewIdx = Number(item[0]);
    const imageIdx = Number(item[1]);
    if (!Number.isInteger(reviewIdx) || !Number.isInteger(imageIdx)) continue;
    if (reviewIdx < 0 || imageIdx < 0) continue;
    if (!reviews[reviewIdx]?.images?.[imageIdx]) continue;

    const key = `${reviewIdx}:${imageIdx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([reviewIdx, imageIdx]);

    if (result.length >= limit) break;
  }

  return result;
}

function mergeReviewImageIndices(...lists: ReviewImageIndex[][]): ReviewImageIndex[] {
  const merged: ReviewImageIndex[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const pair of list) {
      const key = `${pair[0]}:${pair[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(pair);
    }
  }

  return merged;
}

function pickFallbackReviewImageIndices(
  reviews: ProductReview[],
  preferredReviewIndices: number[] = [],
  limit = 3
): ReviewImageIndex[] {
  const result: ReviewImageIndex[] = [];
  const seen = new Set<string>();

  const orderedReviewIndices = [
    ...preferredReviewIndices,
    ...Array.from({ length: reviews.length }, (_, idx) => idx),
  ];

  for (const reviewIdx of orderedReviewIndices) {
    const images = reviews[reviewIdx]?.images;
    if (!images?.length) continue;

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const key = `${reviewIdx}:${imageIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push([reviewIdx, imageIdx]);
      break;
    }

    if (result.length >= limit) break;
  }

  return result;
}

function buildReviewImagesFromIndices(reviews: ProductReview[], usedReviewImageIndices: ReviewImageIndex[]) {
  return usedReviewImageIndices
    .map(([reviewIdx, imageIdx]) => reviews[reviewIdx]?.images?.[imageIdx])
    .filter(Boolean) as ReviewImage[];
}

function normalizePersona(site: Pick<SiteCredential, "slug" | "title" | "persona">): SitePersona {
  const raw = (site.persona ?? {}) as Partial<SitePersona>;
  const fallbackName =
    (typeof site.title === "string" && site.title.trim()) ||
    (typeof site.slug === "string" && site.slug.trim()) ||
    DEFAULT_PERSONA.name;

  return {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : fallbackName,
    age:
      typeof raw.age === "number" && Number.isFinite(raw.age) && raw.age > 0
        ? raw.age
        : DEFAULT_PERSONA.age,
    concern:
      typeof raw.concern === "string" && raw.concern.trim()
        ? raw.concern.trim()
        : DEFAULT_PERSONA.concern,
    expertise:
      typeof raw.expertise === "string" && raw.expertise.trim()
        ? raw.expertise.trim()
        : DEFAULT_PERSONA.expertise,
    tone:
      typeof raw.tone === "string" && raw.tone.trim()
        ? raw.tone.trim()
        : DEFAULT_PERSONA.tone,
    bio:
      typeof raw.bio === "string" && raw.bio.trim()
        ? raw.bio.trim()
        : `${fallbackName} 관점에서 실사용 후기와 공개 정보를 정리합니다.`,
  };
}

function injectReviewImagePlaceholders(html: string, usedReviewImageIndices: ReviewImageIndex[]) {
  if (!html || usedReviewImageIndices.length === 0 || /REVIEW_IMG:\d+:\d+/.test(html)) {
    return html;
  }

  const placeholders = usedReviewImageIndices
    .slice(0, 3)
    .map(([reviewIdx, imageIdx]) => `<!-- REVIEW_IMG:${reviewIdx}:${imageIdx} -->`);

  if (placeholders.length === 0) return html;

  const $ = cheerio.load(html, null, false);
  let inserted = 0;

  const summaryBox = $("div.summary-box").first();
  if (summaryBox.length && inserted < placeholders.length) {
    summaryBox.after(placeholders[inserted]);
    inserted += 1;
  }

  $("h2").each((_, el) => {
    if (inserted >= placeholders.length) return false;
    $(el).after(placeholders[inserted]);
    inserted += 1;
    return undefined;
  });

  if (inserted < placeholders.length) {
    $.root().append(`\n${placeholders.slice(inserted).join("\n")}`);
  }

  return $.html();
}

// ── Review prompt builders ───────────────────────────────────────────────────

function buildReviewPromptSection(reviewCollection: ReviewCollection, articleVariation = 0): string {
  const { reviews, totalCount, averageRating, ratingDistribution, themes } = reviewCollection;

  if (totalCount === 0) return "";

  const distStr = Object.entries(ratingDistribution)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([star, cnt]) => `${star}점: ${cnt}건`)
    .join(", ");

  const indexedReviews = buildIndexedReviews(reviews, articleVariation, 30, 8);
  const windowAverageRating = Math.round(
    (indexedReviews.reduce((sum, { review }) => sum + review.rating, 0) / indexedReviews.length) * 10
  ) / 10;
  const positiveCount = indexedReviews.filter(({ review }) => review.rating >= 4).length;
  const negativeCount = indexedReviews.filter(({ review }) => review.rating <= 3).length;
  const photoReviewCount = indexedReviews.filter(({ review }) => (review.images?.length || 0) > 0).length;

  const optionCounts = Array.from(
    indexedReviews.reduce((acc, { review }) => {
      const option = review.purchaseOption?.trim();
      if (option) acc.set(option, (acc.get(option) || 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  const windowThemes = themes
    .map((theme) => {
      let count = 0;
      const sampleTexts: string[] = [];

      for (const { review } of indexedReviews) {
        if (!review.text.includes(theme.keyword)) continue;
        count += 1;
        if (sampleTexts.length < 2) sampleTexts.push(truncateText(review.text, 80));
      }

      return { ...theme, count, sampleTexts };
    })
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count);

  const positiveThemes = windowThemes.filter((theme) => theme.sentiment === "positive").slice(0, 4);
  const negativeThemes = windowThemes.filter((theme) => theme.sentiment === "negative").slice(0, 3);
  const neutralThemes = windowThemes.filter((theme) => theme.sentiment === "neutral").slice(0, 3);

  const focusCandidates = [
    positiveThemes.length > 0
      ? {
          label: "반복 장점 검증형",
          instruction: `리뷰에서 반복된 장점 "${positiveThemes
            .slice(0, 2)
            .map((theme) => theme.keyword)
            .join(", ")}"을 근거 중심으로 검증하듯 설명하세요.`,
        }
      : null,
    negativeThemes.length > 0
      ? {
          label: "주의점 균형형",
          instruction: `장점만 나열하지 말고 "${negativeThemes
            .slice(0, 2)
            .map((theme) => theme.keyword)
            .join(", ")}" 같은 주의점도 분명히 적어 신뢰도를 확보하세요.`,
        }
      : null,
    optionCounts.length >= 2
      ? {
          label: "옵션 비교형",
          instruction: `리뷰에 자주 나온 옵션/구매 형태 ${optionCounts
            .slice(0, 2)
            .map(([option]) => `"${option}"`)
            .join(" vs ")}를 비교하는 흐름을 넣으세요.`,
        }
      : null,
    photoReviewCount >= 2
      ? {
          label: "실사용 디테일형",
          instruction: "사진이 포함된 리뷰를 근거로 제형, 크기감, 사용 장면처럼 눈에 보이는 디테일을 구체적으로 묘사하세요.",
        }
      : null,
    {
      label: "리뷰어 경험 종합형",
      instruction: '서로 다른 리뷰어들의 맥락을 묶어 "누구에게 잘 맞고, 누가 주의해야 하는지"가 드러나게 쓰세요.',
    },
  ].filter(Boolean) as Array<{ label: string; instruction: string }>;

  const selectedFocus = focusCandidates[articleVariation % focusCandidates.length];
  const representativeReviews = pickRepresentativeReviews(indexedReviews);

  let section = `\n\n## 실구매자 리뷰 분석 (핵심 콘텐츠 소스):\n`;
  section += `- 총 리뷰 수: ${totalCount}건\n`;
  section += `- 평균 평점: ${averageRating}점\n`;
  section += `- 평점 분포: ${distStr}\n`;
  section += buildDirectReviewCoverageSummary(reviews, "전체 리뷰 공통 패턴");

  section += `\n### 이번 글의 리뷰 포커스:\n`;
  section += `- 핵심 프레임: ${selectedFocus.label}\n`;
  section += `- 전개 지시: ${selectedFocus.instruction}\n`;
  section += `- 이번 글에 실제로 전달된 리뷰 묶음: ${indexedReviews.length}건\n`;
  section += `- 이번 리뷰 묶음 평균 평점: ${windowAverageRating}점\n`;
  section += `- 고평점 비율(4~5점): ${formatPercent(positiveCount, indexedReviews.length)}%\n`;
  section += `- 저평점/주의 리뷰 비율(1~3점): ${formatPercent(negativeCount, indexedReviews.length)}%\n`;

  if (positiveThemes.length > 0) {
    section += `- 반복 장점: ${positiveThemes.map((theme) => `${theme.keyword}(${theme.count})`).join(", ")}\n`;
  }
  if (negativeThemes.length > 0) {
    section += `- 반복 주의점: ${negativeThemes.map((theme) => `${theme.keyword}(${theme.count})`).join(", ")}\n`;
  }
  if (neutralThemes.length > 0) {
    section += `- 자주 언급된 맥락/속성: ${neutralThemes.map((theme) => `${theme.keyword}(${theme.count})`).join(", ")}\n`;
  }
  if (optionCounts.length > 0) {
    section += `- 자주 언급된 옵션/구매 형태: ${optionCounts
      .slice(0, 4)
      .map(([option, count]) => `${option}(${count})`)
      .join(", ")}\n`;
  }
  if (photoReviewCount > 0) {
    section += `- 사진 첨부 리뷰: ${photoReviewCount}건\n`;
  }

  if (representativeReviews.length > 0) {
    section += `\n### 대표 리뷰 근거 (서로 다른 섹션에 분산 활용):\n`;
    for (const { label, item } of representativeReviews) {
      section += `- ${label}: ${truncateText(item.review.text, 110)}\n`;
    }
  }

  section += `\n### 실제 리뷰 전문 (${indexedReviews.length}건, 아래 번호는 내부 이미지 매핑용이며 최종 글에 노출 금지):\n`;
  for (const { globalIndex, review } of indexedReviews) {
    const optionLabel = review.purchaseOption?.trim() ? ` | 옵션: ${review.purchaseOption.trim()}` : "";
    const reviewerLabel = review.reviewerName?.trim() ? ` | 작성자: ${review.reviewerName.trim()}` : "";
    const dateLabel = review.date?.trim() ? ` | 날짜: ${review.date.slice(0, 10)}` : "";
    section += `\n[리뷰#${globalIndex}] ★${review.rating}${optionLabel}${reviewerLabel}${dateLabel}\n${review.text.slice(0, 500)}\n`;

    if (review.images && review.images.length > 0) {
      section += `사용 가능 이미지 placeholder: ${review.images
        .map((_, imgIdx) => `<!-- REVIEW_IMG:${globalIndex}:${imgIdx} -->`)
        .join(", ")}\n`;
    }
  }

  return section;
}

function buildPlaceReviewPromptSection(reviews: ProductReview[], articleVariation = 0): string {
  const indexedReviews = buildIndexedReviews(reviews, articleVariation, 20, 6);
  if (indexedReviews.length === 0) return "";

  const representativeReviews = pickRepresentativeReviews(indexedReviews);

  let section = `\n\n## 후기 원문 참고 (팩트 확인용):\n`;
  section += `- 아래 후기는 메뉴명, 맛 표현, 서비스, 공간, 좌석, 대기, 주차, 발렛, 룸처럼 후기 문장 안에 직접 적힌 사실만 참고하세요.\n`;
  section += `- 후기 건수, 통계, "많은 방문자들이", "리뷰 기반" 같은 메타 해석은 최종 글에 쓰지 마세요.\n`;

  if (representativeReviews.length > 0) {
    section += `\n### 먼저 볼 사실 메모:\n`;
    for (const { label, item } of representativeReviews) {
      section += `- ${label}: ${truncateText(item.review.text, 110)}\n`;
    }
  }

  section += `\n### 후기 원문 발췌 (${indexedReviews.length}건, 아래 번호는 내부 이미지 매핑용이며 최종 글에 노출 금지):\n`;
  for (const { globalIndex, review } of indexedReviews) {
    const optionLabel = review.purchaseOption?.trim() ? ` | 메뉴/옵션: ${review.purchaseOption.trim()}` : "";
    const dateLabel = review.date?.trim() ? ` | 날짜: ${review.date.slice(0, 10)}` : "";
    section += `\n[리뷰#${globalIndex}] ★${review.rating}${optionLabel}${dateLabel}\n${review.text.slice(0, 500)}\n`;

    if (review.images && review.images.length > 0) {
      section += `사용 가능 이미지 placeholder: ${review.images
        .map((_, imgIdx) => `<!-- REVIEW_IMG:${globalIndex}:${imgIdx} -->`)
        .join(", ")}\n`;
    }
  }

  return section;
}

// ── AEO Helpers ─────────────────────────────────────────────────────────────

const __filename_aeo = fileURLToPath(import.meta.url);
const __dirname_aeo = path.dirname(__filename_aeo);

let aeoBusinessTypesCache: Record<string, AeoBusinessTypeMapping> | null = null;

function loadAeoBusinessTypes(): Record<string, AeoBusinessTypeMapping> {
  if (aeoBusinessTypesCache) return aeoBusinessTypesCache;
  const configPath = path.resolve(__dirname_aeo, "../../../configs/aeo/business-types.json");
  aeoBusinessTypesCache = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return aeoBusinessTypesCache!;
}

function parseKoreanAddress(address: string): { city: string; region: string } {
  const parts = address.trim().split(/\s+/);
  // 한국 주소: "서울 강남구 선릉로152길 18" or "서울특별시 강남구 ..."
  const region = parts[0] || "";
  const city = parts[1] || "";
  return { city, region };
}

function buildMenuItemsJson(menuStr: string): string {
  if (!menuStr?.trim()) return "[]";
  const items = menuStr.split("/").map((item) => item.trim()).filter(Boolean);
  const jsonItems = items.map((item) => {
    const match = item.match(/^(.+?)\s+([\d,]+)원?$/);
    if (match) {
      return `{"@type":"MenuItem","name":"${match[1].trim()}","offers":{"@type":"Offer","price":"${match[2].replace(/,/g, "")}","priceCurrency":"KRW"}}`;
    }
    return `{"@type":"MenuItem","name":"${item}"}`;
  });
  return `[${jsonItems.join(",")}]`;
}

function resolveAeoSectionTitle(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || "");
}

function autoEnhanceAeoPrompt(contentPrompt: string): string {
  if (!contentPrompt.trim()) return "";
  const aeoMarkers = ["패시지", "JSON-LD", "구조화", "엔티티", "AEO", "스키마", "FAQPage"];
  const hasAeoAwareness = aeoMarkers.some((m) => contentPrompt.includes(m));
  if (hasAeoAwareness) return contentPrompt;
  return `${contentPrompt}\n\n---\n## AEO 자동 보강 규칙 (시스템 추가):\n- 각 H2 섹션의 처음 2-3문장은 독립적인 완결 답변으로 작성\n- 첫 문단에 사업장명 + 위치 + 업종 엔티티 선언\n- H2 중 최소 1개는 대화형 질문 형태로 작성\n- 글 하단에 JSON-LD 구조화 데이터 포함\n- FAQ 섹션은 FAQPage 마이크로데이터로 마크업`;
}

function buildAeoPrompt(
  aeoConfig: AeoConfig,
  persona: SitePersona,
  product: ScrapedProduct,
  reviewsSection: string,
  promptBlock: string,
  variationHint: string,
  placeHasReviewImages: boolean,
): string {
  const businessTypes = loadAeoBusinessTypes();
  const mapping = businessTypes[aeoConfig.businessType] || businessTypes["restaurant"];
  const subKeyword1 = aeoConfig.subKeywords?.split(",")[0]?.trim() || "";
  const { city, region } = aeoConfig.address ? parseKoreanAddress(aeoConfig.address) : { city: "", region: "" };

  const titleVars: Record<string, string> = {
    LOCATION_SHORT: aeoConfig.locationShort,
    FOOD_TYPE: mapping.foodType,
    BUSINESS_NAME: aeoConfig.businessName,
  };

  const sectionHighlight = resolveAeoSectionTitle(mapping.sectionTitles.highlight, titleVars);
  const sectionAtmosphere = mapping.sectionTitles.atmosphere;
  const sectionMenu = mapping.sectionTitles.menu;
  const sectionVisitInfo = mapping.sectionTitles.visitInfo;

  const placeInfo = [
    aeoConfig.address && `주소: ${aeoConfig.address}`,
    product.specs["주소"] && !aeoConfig.address && `주소: ${product.specs["주소"]}`,
    aeoConfig.phone && `전화: ${aeoConfig.phone}`,
    product.specs["전화"] && !aeoConfig.phone && `전화: ${product.specs["전화"]}`,
    aeoConfig.hours && `영업시간: ${aeoConfig.hours}`,
    product.specs["영업시간"] && !aeoConfig.hours && `영업시간: ${product.specs["영업시간"]}`,
    product.specs["편의시설"] && `편의시설: ${product.specs["편의시설"]}`,
    product.specs["찾아가는길"] && `찾아가는길: ${product.specs["찾아가는길"]}`,
    product.specs["키워드"] && `특징키워드: ${product.specs["키워드"]}`,
    aeoConfig.menuItems && `메뉴: ${aeoConfig.menuItems}`,
    aeoConfig.visitPurposes && `추천 방문 목적: ${aeoConfig.visitPurposes}`,
    aeoConfig.additionalInfo && `추가 정보: ${aeoConfig.additionalInfo}`,
  ].filter(Boolean).join("\n");

  const menuItemsJson = buildMenuItemsJson(aeoConfig.menuItems || "");

  return `당신은 ${mapping.persona}입니다.
${variationHint}

목표는 특정 ${aeoConfig.businessName}이(가) 아래 핵심 키워드와 자연스럽게 연결되도록, 사람이 읽어도 어색하지 않고 검색엔진과 AI 답변 엔진(ChatGPT, Gemini, Claude, Perplexity)이 이해하고 인용하기 쉬운 HTML 콘텐츠를 작성하는 것입니다.

---

이번 작업의 핵심 키워드
- 메인 키워드: ${aeoConfig.mainKeyword}
${aeoConfig.subKeywords ? `- 보조 키워드: ${aeoConfig.subKeywords}` : ""}

---

[AEO 핵심 원칙 — AI 답변 엔진 최적화]

1. 패시지 독립성: 각 <h2> 섹션의 첫 2~3문장은 해당 섹션만 떼어내도 하나의 완전한 답변이 되어야 합니다. AI는 개별 패시지를 추출해서 답변을 만들기 때문입니다.
2. 엔티티 선언: 첫 문단에서 "${aeoConfig.businessName}은(는) ${aeoConfig.locationShort}에 위치한 ${mapping.foodType} 전문점"처럼 상호명·지역·업종을 명확하게 한 문장으로 선언하세요.
3. 대화형 쿼리 매칭: H2 제목 중 최소 1개는 사용자가 AI에게 질문하는 자연어 형태를 반영하세요. 예: "${aeoConfig.locationShort}에서 ${mapping.foodType} 찾을 만한 곳은?" 형태.
4. 구조화 데이터 출력: 본문 HTML 끝에 반드시 JSON-LD 스크립트를 포함하세요.
5. FAQ 스키마: FAQ 섹션은 FAQPage schema에 맞는 HTML 구조로 출력하세요.

---

[가장 중요한 원칙]
- 직접 방문한 것처럼 쓰지 마세요.
- 확인되지 않은 정보는 절대 쓰지 마세요.
- 모르는 정보는 설명하지 말고 그냥 빼세요.
- 억지 키워드 삽입 금지
- 광고 카피처럼 쓰지 말고, 정리 잘 된 블로그형 정보 문체로 쓰세요.

---

[출력 금지 표현]
아래 표현은 절대 출력하지 마세요.
- 리뷰에 따르면 / 공개 리뷰 기준 / 공개 정보 기준 / 네이버 지도 기준
- 정보 없음 / 공개 정보 없음 / 확인 필요
- 추정 / 예상 / 가능성 / 언급된다 / 보인다 / 알려져 있다
- 후기상 / 리뷰상
- 직접 방문했다 / 다녀왔다 / 먹어봤다
- 친구와 갔다 / 가족과 갔다 / 외국인 친구와 갔다
- 만족도가 높다 / 자리매김하고 있다 / 발길을 이끈다
- 특별한 경험 / 역대급 / 무조건 / 인생맛집 / 꼭 가야 한다 / 최고

---

[정보 사용 규칙]
1. 입력값에 있는 정보만 사용하세요.
2. 입력값에 없는 사실은 절대 만들어 쓰지 마세요.
3. 가격 정보가 정확하지 않으면 가격 자체를 언급하지 마세요.
4. 주차, 발렛, 룸, 콜키지, 외국인 응대 정보가 명확하지 않으면 해당 항목은 통째로 빼세요.
5. FAQ도 확인된 사실로만 답변 가능한 것만 넣으세요.
6. 답변할 수 없는 질문은 만들지 마세요.
7. 하나의 문장에 같은 키워드를 두 번 이상 넣지 마세요.
8. 메인 키워드는 제목 1회, 첫 문단 1회, H2 1회까지만 강하게 쓰고, 나머지는 자연스럽게 흩어 쓰세요.
9. 보조 키워드는 문맥상 필요한 곳에만 넣고, 나열하지 마세요.

---

[문체 규칙]
- 자연스럽고 세련된 한국어 블로그 문체
- 과장 없이 담백하게
- 문단은 2문장 또는 3문장 중심으로 짧게
- 같은 표현 반복 금지
- 형용사 남발 금지
- 추상적 칭찬보다 메뉴, 공간, 식사 자리 성격, 이용 목적 중심으로 설명
- 판단형 문장은 가능하지만, 근거 없는 단정 금지
- 문장은 매끈하고 읽기 쉬워야 하며 AI 요약문처럼 딱딱하면 안 됩니다

---

[좋은 문장 예시]
- ${aeoConfig.businessName} ${aeoConfig.locationShort}은 ${aeoConfig.locationShort}에서 ${mapping.foodType} 중심 식사를 찾을 때 먼저 눈에 들어오는 구성을 갖춘 곳입니다.
- 양념갈비와 안심을 중심으로 메뉴 흐름이 선명한 편입니다.
- ${aeoConfig.mainKeyword}을 찾는 사람이라면 음식뿐 아니라 공간 분위기까지 함께 보기 좋은 식당입니다.
${subKeyword1 ? `- ${subKeyword1} 중에서도 식사 자리의 톤이 비교적 또렷한 편입니다.` : ""}

[나쁜 문장 예시 — 이런 문장은 절대 쓰지 마세요]
- ${aeoConfig.businessName}은 고급스러운 분위기로 많은 이들의 발길을 이끄는 ${aeoConfig.mainKeyword}입니다.
- 리뷰에 따르면 데이트 코스로 좋다고 합니다.
- 발렛이 있을 가능성이 높습니다.
- 가격은 1인 5만원 이상으로 예상됩니다.

---

## 장소 정보:
- 상호명: ${aeoConfig.businessName}
- 업종: ${mapping.foodType}
- 카테고리: ${product.category || product.brand || ""}
- 설명: ${product.description || ""}
${placeInfo}
${reviewsSection}

${promptBlock}

---

[문서 구조]
오직 HTML만 출력하세요.
CSS, 주석, 마크다운, 메타 설명 금지입니다.

반드시 아래 구조를 따르세요.

1) <h1>
- 메인 키워드를 자연스럽게 포함
- 제목은 한 줄, 낚시성 금지

2) 첫 문단 <p>
- 100자 이내
- 메인 키워드 1회 포함
- 엔티티 선언 포함: "${aeoConfig.businessName}은(는) ${aeoConfig.locationShort}에 위치한 ${mapping.foodType} 전문점으로..." 형태
- 이 문단만 읽어도 AI가 "이 페이지는 어떤 업체에 대한 정보인지" 즉시 파악 가능해야 함

3) <h2>기본 정보 한눈에 보기</h2>
- <ul><li> 형식
- 확인된 항목만: 상호명 / 위치 / 업종 / 대표 메뉴 / 가격 / 예약 / 주차·발렛 / 룸·단체석 / 추천 방문 목적 / 기준일

4) <h2>${sectionHighlight}</h2>
- 이 업체가 왜 메인 키워드와 연결되는지 설명
- ${aeoConfig.locationShort}과 ${aeoConfig.broaderArea} 맥락을 자연스럽게 묶기
- 첫 2~3문장은 이 섹션만 떼어내도 완전한 답변이 되도록 작성

5) <h2>${sectionAtmosphere}</h2>
- 인테리어 / 좌석 구성 / 룸 여부 / 식사 자리의 성격
${aeoConfig.visitPurposes ? `- 방문 목적: ${aeoConfig.visitPurposes} 중 입력값에 맞는 목적만 연결` : ""}
- 첫 문장에서 공간의 핵심 특징을 한 줄로 요약

6) <h2>${sectionMenu}</h2>
- 메뉴명 / 중심 메뉴 / 가격이 있으면 함께 정리
- 맛 표현은 과장하지 말고 메뉴 성격 중심으로 작성
- 메뉴 리스트는 <ul><li> 형식으로 정리하여 AI가 쉽게 추출 가능하도록

7) <h2>${sectionVisitInfo}</h2>
- 예약 / 동선 / 식사 자리 성격 / 방문 전 챙길 요소
- 입력값에 있는 정보만 사용

8) 장점 또는 포인트 정리
- <ul><li> 형식, 3개에서 6개, 짧고 명확하게

9) <h2>총평 및 방문 전 체크포인트</h2>
- 누구에게 맞는지 정리, 과장 없이 마무리
- 입력값에 없는 사실 추가 금지

10) FAQ (FAQPage Schema 적용)
- 2개에서 4개만 작성
- 확인된 사실로 답변 가능한 질문만 사용
- AI가 자주 받는 질문 형태로 작성
- 각 답변은 1~2문장, 40단어 이내로 완결성 있게
- HTML 형식:
<div itemscope itemtype="https://schema.org/FAQPage">
  <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
    <h3 itemprop="name">Q. 질문</h3>
    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
      <p itemprop="text">답변</p>
    </div>
  </div>
</div>

${placeHasReviewImages ? '11) 사진이 있는 리뷰는 본문 내 적절한 위치에 <!-- REVIEW_IMG:리뷰인덱스:이미지인덱스 --> 형식으로 삽입하고, 메뉴/분위기 설명이 나오는 문단 가까이에 배치할 것' : ""}

---

[핵심 제약]
- 입력값에 없는 내용으로 FAQ 만들지 마세요.
- 가격이 정확하지 않으면 가격 질문 자체를 만들지 마세요.
- 주차 정보가 정확하지 않으면 주차 질문 자체를 만들지 마세요.
- 룸 정보가 확실하지 않으면 룸 질문 자체를 만들지 마세요.
- 콜키지가 확실하지 않으면 콜키지 질문 자체를 만들지 마세요.
- 외국인 응대 정보가 없으면 관련 문장 자체를 만들지 마세요.
- JSON-LD에서도 입력값에 없는 필드는 해당 키를 통째로 생략하세요.

---

[중복 방지]
- 같은 업체로 여러 글을 만들더라도 이번 글은 "${aeoConfig.mainKeyword}" 중심으로 쓰세요.
${subKeyword1 ? `- "${subKeyword1}"은 보조 연결만 하세요.` : ""}
- 문단 첫 문장 패턴을 반복하지 마세요.
- "고급스럽다", "세련되다", "특별하다" 같은 형용사를 연속 반복하지 마세요.

---

[출력 전 자가 점검]
출력 직전에 아래를 반드시 점검하세요.
1. 금지 표현이 하나라도 들어갔는가
2. 입력값에 없는 정보를 추가했는가
3. 추정 문장이 들어갔는가
4. 제목, 첫 문단, H2에 메인 키워드가 들어갔는가
5. 키워드 삽입이 부자연스럽지 않은가
6. FAQ가 확인된 정보만으로 구성되었는가
7. 문장이 광고처럼 과장되지 않았는가
8. 사람이 읽어도 어색하지 않은가
9. 첫 문단에 엔티티 선언(상호명+지역+업종)이 포함되었는가
10. 각 H2 섹션의 첫 2~3문장이 독립적으로 완전한 답변이 되는가
11. FAQ가 FAQPage Schema 마크업으로 출력되었는가
12. 메뉴 리스트가 구조화되어 AI가 추출 가능한가

---

JSON 형식으로 응답하세요:
{
  "title": "글 제목 (메인 키워드 포함, 60자 이내)",
  "metaTitle": "메타 타이틀 (60자 이내)",
  "metaDescription": "메타 설명 (155자 이내, 위치+특징+추천 포함)",
  "slug": "business-name-keyword-slug",
  "htmlContent": "<h1>...</h1><p>엔티티 선언 포함 첫 문단</p>...<div itemscope itemtype=\\"https://schema.org/FAQPage\\">...</div>",
  "excerpt": "발췌문 (2-3문장)",
  "category": "${aeoConfig.businessType === "restaurant" || aeoConfig.businessType === "cafe" ? "맛집리뷰" : "정보"}",
  "tags": ["${aeoConfig.businessName}", "${aeoConfig.locationShort}", "${mapping.foodType}"],
  "faq": [{"question": "질문?", "answer": "답변"}],
  "jsonLd": {
    "@context": "https://schema.org",
    "@type": "${mapping.schemaType}",
    "name": "${aeoConfig.businessName}",
    ${aeoConfig.address ? `"address": {"@type": "PostalAddress", "streetAddress": "${aeoConfig.address}", "addressLocality": "${city}", "addressRegion": "${region}", "addressCountry": "KR"},` : ""}
    ${aeoConfig.phone ? `"telephone": "${aeoConfig.phone}",` : ""}
    ${aeoConfig.reservations !== undefined ? `"acceptsReservations": "${aeoConfig.reservations}",` : ""}
    "image": "대표 이미지 URL (있으면 포함, 없으면 이 키 생략)",
    "url": "업체 공식 URL 또는 네이버 플레이스 URL (있으면 포함, 없으면 이 키 생략)",
    "geo": {"@type": "GeoCoordinates", "latitude": "위도 (있으면 포함, 없으면 geo 키 통째로 생략)", "longitude": "경도"},
    ${mapping.schemaType === "Restaurant" || mapping.schemaType === "CafeOrCoffeeShop" ? `"servesCuisine": "${mapping.foodType} (업종에 맞게 작성, 없으면 이 키 생략)",` : ""}
    "priceRange": "가격대 (예: '₩₩₩', 있으면 포함, 없으면 이 키 생략)",
    ${aeoConfig.hours ? `"openingHoursSpecification": [{"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], "opens": "영업시작시간", "closes": "영업종료시간"}],` : ""}
    ${aeoConfig.menuItems ? `"hasMenu": {"@type": "Menu", "hasMenuSection": {"@type": "MenuSection", "name": "대표 메뉴", "hasMenuItem": ${menuItemsJson}}},` : ""}
    "description": "${aeoConfig.mainKeyword}"
  }${placeHasReviewImages ? ',\n  "usedReviewImageIndices": [[리뷰인덱스, 이미지인덱스], ...]' : ""}
}

중요: jsonLd 필드는 입력값에 있는 정보만으로 구성하세요. 없는 필드는 통째로 생략하세요.`;
}

// ── Gemini call ──────────────────────────────────────────────────────────────

function buildContentStrategyBlock(contentStrategy: ContentStrategy, articleVariation: number): string {
  const selectedKeyword = contentStrategy.targetKeywords && contentStrategy.targetKeywords.length > 0
    ? contentStrategy.targetKeywords[articleVariation % contentStrategy.targetKeywords.length]
    : null;

  let block = `\n\n## SEO 콘텐츠 전략 (반드시 준수):\n`;

  if (selectedKeyword) {
    block += `\n### 이번 글의 타겟 키워드: "${selectedKeyword}"\n`;
    if (contentStrategy.keywordOptimization) {
      const ko = contentStrategy.keywordOptimization;
      if (ko.titleRule) block += `- 제목: ${ko.titleRule}\n`;
      if (ko.introRule) block += `- 도입부: ${ko.introRule}\n`;
      if (ko.h2Rule) block += `- H2: ${ko.h2Rule}\n`;
    }
  }

  if (contentStrategy.semanticKeywords && contentStrategy.semanticKeywords.length > 0) {
    block += `\n### 시맨틱 키워드 (본문 전체에 문맥에 맞게 자연스럽게 분산 배치):\n`;
    block += contentStrategy.semanticKeywords.join(", ") + "\n";
  }

  if (contentStrategy.coreNarratives && contentStrategy.coreNarratives.length > 0) {
    block += `\n### 반드시 포함할 핵심 경험담:\n`;
    contentStrategy.coreNarratives.forEach((n, i) => {
      block += `${i + 1}. [${n.label}] ${n.content}\n`;
    });
  }

  if (contentStrategy.htmlStructureRules) {
    const hr = contentStrategy.htmlStructureRules;
    block += `\n### 추가 HTML 구조 규칙:\n`;
    if (hr.useBulletPoints) block += `- ${hr.useBulletPoints}\n`;
    if (hr.endingSection) block += `- ${hr.endingSection}\n`;
  }

  return block;
}

async function generateForSite(
  apiKey: string,
  product: ScrapedProduct,
  contentPrompt: string,
  site: SiteCredential,
  reviewCollection?: ReviewCollection,
  articleVariation = 0,
  siteArticleIndex = 0,
  aeoConfig?: AeoConfig,
  contentStrategy?: ContentStrategy,
): Promise<GeneratedArticle> {
  const persona = normalizePersona(site);
  const sourceTitle = product.title?.trim() || site.title || site.slug;
  const normalizedPrompt = normalizeContentPrompt(contentPrompt);
  const promptSummary = summarizeContentPrompt(normalizedPrompt);
  const isRestaurant = product.source === "naver-place";
  const readerLens = pickReaderLens(isRestaurant, articleVariation);
  // Content Strategy: 톤 오버라이드 적용
  const effectiveTone = contentStrategy?.toneOverride
    ? `${contentStrategy.toneOverride} (페르소나 특성을 유지하면서)`
    : persona.tone;

  const strategyBlock = contentStrategy ? buildContentStrategyBlock(contentStrategy, articleVariation) : "";

  const promptInstructionBlock = `## 사용자 작성 프롬프트 (반드시 반영):
${normalizedPrompt}

## 프롬프트 반영 원칙:
- 위 프롬프트의 핵심 질문, 원하는 톤, 구조, 강조 포인트, 금지 사항을 최우선으로 반영할 것
- 단, 리뷰/상품 데이터와 충돌하는 내용은 지어내지 말고 실제 데이터 기준으로만 해석할 것
- 프롬프트의 문장을 그대로 복붙하지 말고, 최종 블로그 글 안에서 자연스럽게 소화할 것
- 사용자가 "다양한 페르소나", "각기 다른 관점"을 요구한 경우 이번 글은 아래 독자 렌즈를 우선 적용할 것:
  - 독자 렌즈: ${readerLens.label}
  - 적용 지시: ${readerLens.instruction}
  - 서술 각도: ${readerLens.narrativeAngle}${strategyBlock}`;

  const specsSummary =
    Object.keys(product.specs).length > 0
      ? `\n\n## 제품 스펙:\n${Object.entries(product.specs)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")}`
      : "";

  let reviewSection = "";
  if (reviewCollection && reviewCollection.totalCount > 0) {
    reviewSection = buildReviewPromptSection(reviewCollection, articleVariation);
  } else if (product.reviews.length > 0) {
    const indexedReviews = buildIndexedReviews(product.reviews, articleVariation, 15, 5);
    reviewSection =
      `\n\n## 제품 리뷰 (스크랩 기반)\n` +
      buildDirectReviewCoverageSummary(product.reviews, "전체 스크랩 리뷰 공통 패턴") +
      `\n### 이번 글에 전달된 대표 리뷰 묶음 (${indexedReviews.length}건, 내부 인덱스는 노출 금지):\n` +
      indexedReviews
        .map(
          ({ globalIndex, review }) =>
            `[리뷰#${globalIndex}] (★${review.rating}) ${review.purchaseOption ? `[${review.purchaseOption}] ` : ""}${review.text}`
        )
        .join("\n");
  }

  const hasRichReviews = Boolean(reviewCollection && reviewCollection.totalCount > 0);
  const hasAnyReviews = hasRichReviews || product.reviews.length > 0;
  const reviewCount = reviewCollection?.totalCount || product.reviews.length;
  const availableReviewsForImages = hasRichReviews ? reviewCollection!.reviews : product.reviews;
  const hasAnyReviewImages = availableReviewsForImages.some((review) => (review.images?.length || 0) > 0);
  const reviewIntro = hasRichReviews
    ? `리뷰 ${reviewCount}건의 실제 구매자 경험이 콘텐츠의 핵심입니다. 리뷰에서 발견한 인사이트를 근거로 서술하세요.`
    : hasAnyReviews
      ? `스크랩된 리뷰 ${reviewCount}건이 콘텐츠의 핵심 근거입니다. 반복적으로 나온 장점과 불만을 중심으로 서술하세요.`
      : "제품 정보를 바탕으로 전문적인 글을 작성하세요.";
  const reviewRule1 = hasAnyReviews
    ? `"실제 구매자 ${reviewCount}명 중 다수가..." / "리뷰를 분석한 결과..." 등 근거 기반 서술 필수`
    : "제품명에서 핵심 성분과 기능을 분석하여 상세히 설명";
  const reviewRule2 = hasRichReviews
    ? "긍정 키워드 테마는 장점으로, 부정 키워드 테마는 주의점으로 자연스럽게 녹임"
    : hasAnyReviews
      ? "스크랩 리뷰에서 반복된 장점과 불만을 장단점 섹션 전반에 자연스럽게 녹임"
      : "키워드/카테고리 정보를 활용하여 제품의 용도와 타겟층을 명확히 설명";
  const reviewRule7 = hasAnyReviews
    ? "대표 리뷰 근거 섹션의 포인트를 최소 4개 이상 서로 다른 문단/H2에 분산 반영하고, 같은 장점만 반복하지 말 것"
    : "핵심 특징을 중복 없이 분산 배치할 것";
  const numericRule = hasAnyReviews
    ? `"리뷰 ${reviewCount}명 중 X%가 재구매 의사" / "평균 평점 X점" 등`
    : '"성분 농도", "사용 기간", "효과 발현 시기" 등 구체적 수치 포함';

  const productAngleConfigs: ProductAngleConfig[] = [
    {
      label: "핵심 효과 검증형",
      titleFormat: `제목 형식: "[제품명] 효과 있나요?" 또는 "후기 보고 정리한 체감 포인트 3가지" — 질문형/검증형 톤`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 먼저 결론 — 어떤 사람에게 맞는가
② 리뷰에서 반복된 핵심 효과
③ 사용감·제형·향/복용감 디테일
④ 아쉬운 점과 주의할 점
⑤ 재구매 의사 & 추천 대상`,
      emphasis: "리뷰에서 반복되는 장점과 체감 변화를 근거 중심으로 설명하세요.",
    },
    {
      label: "가성비 비교형",
      titleFormat: `제목 형식: "[제품명] 가성비 어떨까?" 또는 "비슷한 제품 대신 이걸 고를 이유" — 비교/가격 판단형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 가격대와 첫인상
② 다른 제품 대비 차별점
③ 리뷰 기준 가성비가 갈린 포인트
④ 돈 아깝지 않은 사람 / 아까운 사람
⑤ 최종 구매 판단`,
      emphasis: "가격, 용량, 만족도 대비 체감 차이를 리뷰 근거로 정리하세요.",
    },
    {
      label: "초보자 입문 가이드형",
      titleFormat: `제목 형식: "처음 쓰는 사람 기준 [제품명] 괜찮을까?" 또는 "입문자가 보기 쉽게 정리한 [제품명]" — 초보자/가이드형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 초보자 기준 한 줄 결론
② 처음 쓸 때 기대해도 되는 점
③ 사용 순서·사용량·사용 팁
④ 이런 경우는 주의해야 함
⑤ 이런 입문자에게 추천`,
      emphasis: "어려운 설명보다 처음 쓰는 사람이 헷갈릴 포인트를 리뷰 사례로 풀어주세요.",
    },
    {
      label: "장단점 비교형",
      titleFormat: `제목 형식: "[제품명] 장점만 있는 건 아니었습니다" 또는 "직접 사기 전 알아둘 장단점" — 솔직 비교형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 먼저 총평
② 실제로 만족도가 높았던 이유
③ 아쉬움이 나온 이유
④ 장단점이 갈리는 사용자 조건
⑤ 결국 추천할지 말지`,
      emphasis: "긍정 후기와 부정 후기를 같은 비중으로 다뤄 광고처럼 보이지 않게 쓰세요.",
    },
    {
      label: "고민 해결형",
      titleFormat: `제목 형식: "[고민] 때문에 찾는다면 [제품명] 어떨까?" 또는 "이런 고민에 맞는지 후기 기반으로 판단" — 문제 해결형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 어떤 고민에 맞는 제품인지
② 리뷰에서 보인 해결 포인트
③ 기대보다 약했던 부분
④ 같이 쓰면 좋은 방법 / 피해야 할 조합
⑤ 추천 대상과 비추천 대상`,
      emphasis: "메인 질문의 고민을 리뷰 데이터로 풀고, 맞는 사람과 안 맞는 사람을 분리하세요.",
    },
    {
      label: "성분·원료 해석형",
      titleFormat: `제목 형식: "[제품명] 성분 보니 왜 반응이 갈리는지 알겠더라" 또는 "후기와 성분을 같이 보면 보이는 포인트" — 분석형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 핵심 성분/원료 한눈에 보기
② 성분과 리뷰 반응이 연결되는 부분
③ 사용감과 성분의 상관관계
④ 민감 포인트와 주의할 점
⑤ 성분 기준 추천 대상`,
      emphasis: "제품 스펙과 리뷰 반응을 연결해 해석하되, 리뷰에 없는 효능은 만들지 마세요.",
    },
    {
      label: "리뷰어 사례 스토리형",
      titleFormat: `제목 형식: "후기 읽다 보니 [제품명]은 이런 사람이 만족하더라" 또는 "리뷰어 사례로 정리한 [제품명]" — 사례/스토리형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 가장 먼저 보인 공통 반응
② 만족도가 높은 리뷰어 사례
③ 불만이 나온 리뷰어 사례
④ 사용 맥락별 차이
⑤ 사례 기반 최종 결론`,
      emphasis: "한 사람의 체험담처럼 쓰지 말고, 서로 다른 리뷰 사례를 엮어 패턴을 보여주세요.",
    },
    {
      label: "구매 전 체크리스트형",
      titleFormat: `제목 형식: "[제품명] 사기 전에 체크할 5가지" 또는 "구매 전 꼭 확인할 포인트 정리" — 체크리스트형`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 이 제품을 볼 때 가장 먼저 체크할 점
② 리뷰에서 자주 언급된 장점 체크
③ 불만 리뷰에서 나온 리스크 체크
④ 사용법·보관법·옵션 체크
⑤ 구매 여부 최종 체크`,
      emphasis: "독자가 구매 직전 판단할 수 있게 장점과 리스크를 체크리스트처럼 정리하세요.",
    },
  ];

  const restaurantAngleConfigs = [
    {
      label: "첫 방문 포인트 정리",
      titleFormat: `제목 형식: "[가게명] 첫 방문 가이드" 또는 "[지역] [음식종류] 방문 전 체크할 점" — 정보형 문장으로 차분하게`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 방문하게 된 계기 & 찾아가는 법
② 들어서는 순간 첫인상 & 분위기
③ 대표 메뉴 구성과 맛 포인트
④ 좋았던 점 3가지 / 아쉬웠던 점 2가지
⑤ 재방문 의향 & 이런 분께 추천합니다`,
    },
    {
      label: "메뉴 & 가격 정리",
      titleFormat: `제목 형식: "[가게명] 메뉴와 가격 정리" 또는 "[주메뉴] 메뉴 선택 가이드" — 메뉴와 가격 정보가 바로 드러나게`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 전체 메뉴판 & 가격 총정리 (표로 정리)
② 시그니처 메뉴 상세 정리 (맛, 양, 비주얼)
③ 사이드 & 추가 메뉴 구성 비교
④ 대표 메뉴 비교 정리
⑤ 처음 방문자 추천 조합`,
    },
    {
      label: "데이트 & 분위기 맛집",
      titleFormat: `제목 형식: "[가게명] 분위기와 방문 포인트 정리" 또는 "[지역] 데이트 방문 가이드" — 분위기 정보를 차분하게`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 공간 & 인테리어 상세 묘사 (조명, 좌석, 동선)
② 프라이빗한 좌석 vs 오픈 좌석 구성
③ 데이트 코스 추천 (주변 카페·관광지 포함)
④ 커플·소개팅 방문 시 주의사항 & 팁
⑤ 예약 방법 & 방문 최적 시간대`,
    },
    {
      label: "가성비 & 만족도 정리",
      titleFormat: `제목 형식: "[가게명] 가격대와 방문 포인트 정리" 또는 "[가격대] [음식종류] 방문 가이드" — 가격 정보 중심으로`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 가격표 & 경쟁 가게 대비 가성비 분석
② 양 & 퀄리티 정리
③ 만족도가 갈리는 포인트
④ 세트 조합과 주문 포인트
⑤ 가성비 판단 기준 정리`,
    },
    {
      label: "대표 메뉴 선택 가이드",
      titleFormat: `제목 형식: "[가게명] 추천 메뉴 정리" 또는 "[가게명] 대표 메뉴 선택 가이드" — 메뉴 선택 도움 중심으로`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 대표 메뉴를 고른 기준
② 많이 선택되는 메뉴 정리
③ 함께 비교할 메뉴 정리
④ 사이드 메뉴와 추가 주문 포인트
⑤ 처음 방문자 추천 조합`,
    },
    {
      label: "타 가게와의 차별점",
      titleFormat: `제목 형식: "[가게명] 차별점 정리" 또는 "[음식종류] 비교 포인트" — 비교 기준이 보이게`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 비슷한 가게들과 무엇이 다른가
② 이 가게만의 시그니처 조리법 & 맛의 비결
③ 서비스 스타일 & 사장님 스토리
④ 손님들이 자주 찾는 포인트
⑤ 이런 분께는 추천 / 이런 분께는 비추`,
    },
    {
      label: "가족 & 단체 방문 완전 가이드",
      titleFormat: `제목 형식: "[가게명] 가족 모임 가이드" 또는 "[지역] 가족 방문 체크리스트" — 가족 방문 정보 중심으로`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 단체석 & 유아시설 (아이 의자, 수유실, 키즈존)
② 어르신·아이 함께 먹기 좋은 메뉴 구성
③ 주차 & 접근성 (대중교통 + 자차 방문 기준)
④ 가족 모임으로 이 가게를 선택한 이유
⑤ 방문 전 예약/대기 체크 포인트`,
    },
    {
      label: "인기 이유 & 방문 전 체크",
      titleFormat: `제목 형식: "[가게명] 방문 전 체크포인트" 또는 "[음식종류] 첫 방문 체크리스트" — 방문 전 필요한 정보를 중심으로`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 방문 전 먼저 볼 기본 정보
② 실제 공간과 분위기 정리
③ 방문 전 알아둘 포인트
④ 좌석·대기·동선 포인트
⑤ 붐비는 시간대와 예약 체크 포인트`,
    },
  ];

  const thisRestaurantAngleConfig = isRestaurant
    ? restaurantAngleConfigs[articleVariation % restaurantAngleConfigs.length]
    : null;
  const thisProductAngleConfig = productAngleConfigs[articleVariation % productAngleConfigs.length];

  const variationHint =
    articleVariation > 0
      ? `\n⚠️ 이번 배치의 ${articleVariation + 1}번째 글입니다. 같은 배치 다른 글들과 제목 형식·H2 구조·도입부·결론 문장이 겹치지 않아야 합니다.${siteArticleIndex > 0 ? ` 동일 사이트의 ${siteArticleIndex + 1}번째 글이므로 같은 사이트 기존 글과도 표현을 더 강하게 분리하세요.` : ""}`
      : "";

  // ── AEO 로컬 비즈니스 전용 프롬프트 ────────────────────────────
  if (aeoConfig) {
    const reviewsSection = buildPlaceReviewPromptSection(product.reviews, articleVariation);
    const placeHasReviewImages = product.reviews.some((review) => (review.images?.length || 0) > 0);

    const enhancedPrompt = autoEnhanceAeoPrompt(normalizedPrompt);
    const aeoPromptBlock = enhancedPrompt
      ? `## 사용자 작성 프롬프트 (반드시 반영):\n${enhancedPrompt}\n\n## 프롬프트 반영 원칙:\n- 위 프롬프트의 핵심 질문, 원하는 톤, 구조를 최우선으로 반영할 것\n- 단, 리뷰/장소 데이터와 충돌하는 내용은 지어내지 말 것`
      : "";

    const aeoPrompt = buildAeoPrompt(
      aeoConfig, persona, product, reviewsSection, aeoPromptBlock, variationHint, placeHasReviewImages
    );

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONTENT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aeoPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 8192 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API 오류 (${res.status}): ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI 응답이 비어있습니다.");

    let parsed;
    try { parsed = JSON.parse(text); } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) parsed = JSON.parse(match[1]); else throw new Error("AI 응답 JSON 파싱 실패");
    }

    const faqItems: FAQItem[] = (parsed.faq || []).map((f: { question: string; answer: string }) => ({
      question: f.question, answer: f.answer,
    }));

    // JSON-LD를 htmlContent 끝에 append
    let aeoHtmlContent = parsed.htmlContent || "";
    if (parsed.jsonLd) {
      const jsonLdStr = typeof parsed.jsonLd === "string" ? parsed.jsonLd : JSON.stringify(parsed.jsonLd, null, 2);
      aeoHtmlContent += `\n<script type="application/ld+json">\n${jsonLdStr}\n</script>`;
    }

    // 리뷰 이미지 처리 (기존 맛집 로직 재사용)
    const aeoPromptIndices = extractReviewImageIndicesFromHtml(aeoHtmlContent);
    const aeoUsedReviewImageIndices = mergeReviewImageIndices(
      normalizeReviewImageIndices(parsed.usedReviewImageIndices, product.reviews),
      aeoPromptIndices
    );
    const finalAeoReviewImageIndices =
      aeoUsedReviewImageIndices.length > 0
        ? aeoUsedReviewImageIndices
        : pickFallbackReviewImageIndices(
            product.reviews,
            pickReviewIndices(product.reviews.length, articleVariation, 20, 6),
            3
          );
    const aeoReviewImages = buildReviewImagesFromIndices(product.reviews, finalAeoReviewImageIndices);
    const finalAeoHtmlContent = injectReviewImagePlaceholders(aeoHtmlContent, finalAeoReviewImageIndices);

    return sanitizeGeneratedArticle({
      id: `${site.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      siteSlug: site.slug,
      siteDomain: site.domain,
      personaName: persona.name,
      sourceTitle,
      targetQuestion: promptSummary,
      title: parsed.title || product.title,
      metaTitle: parsed.metaTitle || parsed.title || "",
      metaDescription: parsed.metaDescription || "",
      slug: parsed.slug || product.title.toLowerCase().replace(/\s+/g, "-").slice(0, 60),
      htmlContent: finalAeoHtmlContent,
      excerpt: parsed.excerpt || "",
      category: parsed.category || "정보",
      tags: parsed.tags || [],
      faqSchema: faqItems,
      wordCount: estimateVisibleWordCount(finalAeoHtmlContent),
      status: "generated" as const,
      reviewImages: aeoReviewImages,
      usedReviewImageIndices: finalAeoReviewImageIndices,
    });
  }

  // ── 맛집/장소 전용 프롬프트 ────────────────────────────────────
  if (isRestaurant) {
    const reviewsSection = buildPlaceReviewPromptSection(product.reviews, articleVariation);
    const placeHasReviewImages = product.reviews.some((review) => (review.images?.length || 0) > 0);
    const restaurantFacts = buildRestaurantFactMap(product);
    const supportFacts = [
      restaurantFacts.menuSummary && `- 참고 가능한 메뉴명: ${restaurantFacts.menuSummary}`,
      restaurantFacts.priceRange && `- 참고 가능한 가격대: ${restaurantFacts.priceRange}`,
      restaurantFacts.address && `- 참고 가능한 주소: ${restaurantFacts.address}`,
      restaurantFacts.phone && `- 참고 가능한 전화번호: ${restaurantFacts.phone}`,
    ].filter(Boolean).join("\n");

    const restaurantPrompt = `당신은 "${persona.name}"입니다. ${persona.bio || ""}
나이: ${persona.age}세 | 글쓰기 톤: ${effectiveTone}
${variationHint}

아래 사용자 프롬프트를 가장 우선으로 보고, 참고 후기 원문에서 직접 확인되는 사실만 보조 근거로 사용해 실제 블로그에 바로 올릴 수 있는 맛집 글을 작성하세요.
스크랩 데이터는 사진/기본 식별용 참고 자료로만 취급하세요. 프롬프트에 이미 적힌 내용보다 스크랩 데이터를 우선하지 마세요.

## 기본 식별 정보:
- 가게명: ${product.title}
- 카테고리: ${firstNonEmptyText(product.category, product.brand)}
- 설명: ${product.description || ""}
${supportFacts ? `\n## 보조 참고용 스크랩 정보 (필요할 때만 사용):\n${supportFacts}\n` : ""}${reviewsSection}

${promptInstructionBlock}

## 이번 글의 구조 콘셉트:
- 글쓰기 각도: ${thisRestaurantAngleConfig!.label}
- 이번 글 독자 렌즈: ${readerLens.label}
- 독자 렌즈 적용 지시: ${readerLens.instruction}
- ${thisRestaurantAngleConfig!.titleFormat}
- ${thisRestaurantAngleConfig!.h2Structure}
- 전개 원칙: 사용자 프롬프트를 중심으로 글을 전개하고, 후기 원문에 직접 적힌 메뉴/분위기/서비스/공간 관련 사실만 필요한 만큼 덧붙일 것

## 작성 규칙:
1. htmlContent는 반드시 하나의 <h2>로 시작하고, 첫 문단에서 사용자 프롬프트의 핵심 요청에 대한 한 문장 결론을 먼저 제시할 것
2. 본문 HTML 안에는 <h1> 태그를 절대 넣지 말 것. 페이지의 유일한 H1은 워드프레스 테마가 출력하므로, 본문은 <h2>/<h3>부터 시작해야 함
3. 위 구조 콘셉트의 제목 형식과 H2 순서를 반드시 지킬 것
4. 사용자 프롬프트에 적은 발렛, 룸, 주차, 예약, 방문 팁, 분위기 정보는 그대로 반영하고, 스크랩에 없다는 이유로 "정보 없음", "문의 필요", "확인 필요"라고 쓰지 말 것
5. 대표 리뷰 근거 섹션의 포인트를 서로 다른 H2에 분산 배치하여 같은 문단 톤이 반복되지 않게 할 것
6. 후기 원문은 메뉴명, 맛, 서비스, 공간, 대기, 좌석, 주차, 발렛, 룸처럼 문장 안에 직접 적힌 사실만 참고하고, 후기 건수/통계/공통 패턴 서술은 금지
7. 장단점을 균형있게 서술 (단점 없으면 광고로 보임 → 신뢰도 하락)
8. 주소, 영업시간, 전화번호, 대표메뉴, 가격대 같은 운영 정보는 사용자 프롬프트에 있으면 그대로 쓰고, 프롬프트에 없더라도 보조 참고용 스크랩 정보가 있을 때만 선택적으로 사용할 것
9. FAQ는 사용자 프롬프트에서 중요하게 다룬 정보 위주로 4개 작성하고, 없는 항목을 억지로 채우지 말 것
10. 2000~3000자 분량
11. HTML 형식 (h2, h3, p, ul, li, strong, em, table 태그)
12. 마지막 정보 정리 <table>은 사용자 프롬프트나 후기 원문에 실제로 들어 있는 항목만 넣고, 빈 행이나 "정보 없음" 행은 만들지 말 것
13. 후기 원문과 프롬프트에 없는 내용은 만들지 말 것. 다만 사용자 프롬프트에 명시된 정보는 사실값으로 취급하고 그대로 반영할 것
14. 리뷰 전문의 [리뷰#숫자]와 내부 인덱스는 작성용 메모일 뿐이며, 최종 HTML/제목/FAQ/요약문에 절대 노출하지 말 것
15. 같은 배치의 다른 글과 겹치지 않도록, 도입부 비유·핵심 메뉴 선정·결론 문장·추천 대상 설명을 이번 글만의 방식으로 바꿀 것
16. 참고 후기 건수, 후기 키워드 횟수, "총 50개 리뷰", "방문자들이 공통적으로", "리뷰 데이터", "리뷰를 보면" 같은 메타 설명은 최종 HTML/제목/FAQ/요약문에 쓰지 말 것
${placeHasReviewImages ? '17. 사진이 있는 리뷰는 본문 내 적절한 위치에 <!-- REVIEW_IMG:리뷰인덱스:이미지인덱스 --> 형식으로 삽입하되, 이 placeholder 주석 외에는 리뷰 인덱스를 노출하지 말 것' : ""}
18. 제목과 메타타이틀에 "리뷰 141개 분석", "SNS 난리난", "웨이팅 0분?", "TOP 3", "극찬", "완벽한 선택", "실패 없는 선택", "찐 맛집", "맛잘알 픽", "완벽 가이드", "끝판왕", "요즘 핫한", "비교불가", "놓치면 후회할" 같은 과장 카피를 절대 쓰지 말 것
19. 제목은 정보형 문장으로 작성하고, 가게명/메뉴/방문 상황을 중심으로 차분하게 표현할 것

## GEO (AI 검색 최적화) 규칙:
G1. 인용 가능 단락(Citable Passage): 각 H2 섹션 첫 부분에 해당 질문에 대한 완결된 답변을 3~5문장으로 작성할 것. 주변 맥락 없이 그 단락만 읽어도 의미가 통해야 함
G2. 정의 패턴: 핵심 개념이 처음 나올 때 "X는(은) ~이다(하다)" 형식으로 명확히 정의
G3. 통계 밀도: 가격, 퍼센트, 평점, 기간 등 구체적 수치를 문단마다 최소 1개 포함
G4. 대명사 최소화: "이것", "그것", "해당 가게" 대신 실제 가게명/메뉴명을 반복 사용
G5. 질문형 소제목: H2를 "~일까?", "~어떨까?", "~차이는?" 등 질문형으로 작성 (AI 쿼리 매칭)
G6. 비교 테이블: 메뉴, 가격, 장단점 비교 시 반드시 <table> 사용 (방문 정보 테이블 외 추가 1개)
G7. 핵심 용어 볼드: 중요 키워드가 처음 나올 때 <strong> 태그로 강조
G8. 상투적 표현 금지: "오늘날 디지털 시대에", "주목할 만한 점은", "결론적으로 말하자면", "다양한 측면에서", "~에 대해 알아보겠습니다" 등 사용 금지
G9. 답변 우선 구조: 각 섹션 첫 1~2문장은 해당 소제목 질문에 대한 직접 답변

JSON 형식으로 응답하세요:
{
  "title": "블로그 글 제목 (맛집명 + 핵심 특징 포함, 60자 이내)",
  "metaTitle": "메타 타이틀 (60자 이내)",
  "metaDescription": "메타 설명 (155자 이내, 위치+특징+추천 포함)",
  "slug": "restaurant-name-review-korean",
  "htmlContent": "<h2>...</h2><p>...</p>...",
  "excerpt": "발췌문 (2-3문장, 가게 특징 압축)",
  "category": "맛집리뷰",
  "tags": ["가게명", "카테고리", "지역명", "특징키워드"],
  "faq": [
    {"question": "질문?", "answer": "답변"}
  ]${placeHasReviewImages ? ',\n  "usedReviewImageIndices": [[리뷰인덱스, 이미지인덱스], ...]' : ""}
}`;

    const data = await requestGeminiContent(apiKey, restaurantPrompt, {
      responseMimeType: "application/json",
      temperature: 0.95,
      maxOutputTokens: 8192,
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI 응답이 비어있습니다.");

    let parsed;
    try { parsed = JSON.parse(text); } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) parsed = JSON.parse(match[1]); else throw new Error("AI 응답 JSON 파싱 실패");
    }

    const faqItems: FAQItem[] = (parsed.faq || []).map((f: { question: string; answer: string }) => ({
      question: f.question, answer: f.answer,
    }));

    const restaurantPromptIndices = extractReviewImageIndicesFromHtml(parsed.htmlContent || "");
    const restaurantUsedReviewImageIndices = mergeReviewImageIndices(
      normalizeReviewImageIndices(parsed.usedReviewImageIndices, product.reviews),
      restaurantPromptIndices
    );
    const finalRestaurantReviewImageIndices =
      restaurantUsedReviewImageIndices.length > 0
        ? restaurantUsedReviewImageIndices
        : pickFallbackReviewImageIndices(
            product.reviews,
            pickReviewIndices(product.reviews.length, articleVariation, 20, 6),
            3
          );
    const restaurantReviewImages = buildReviewImagesFromIndices(product.reviews, finalRestaurantReviewImageIndices);
    const restaurantHtmlContent = injectReviewImagePlaceholders(parsed.htmlContent || "", finalRestaurantReviewImageIndices);

    return sanitizeGeneratedArticle({
      id: `${site.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      siteSlug: site.slug,
      siteDomain: site.domain,
      personaName: persona.name,
      sourceTitle,
      targetQuestion: promptSummary,
      title: parsed.title || product.title,
      metaTitle: parsed.metaTitle || parsed.title || "",
      metaDescription: parsed.metaDescription || "",
      slug: parsed.slug || product.title.toLowerCase().replace(/\s+/g, "-").slice(0, 60),
      htmlContent: restaurantHtmlContent,
      excerpt: parsed.excerpt || "",
      category: parsed.category || "맛집리뷰",
      tags: parsed.tags || [],
      faqSchema: faqItems,
      wordCount: estimateVisibleWordCount(restaurantHtmlContent),
      status: "generated" as const,
      reviewImages: restaurantReviewImages,
      usedReviewImageIndices: finalRestaurantReviewImageIndices,
    });
  }

  // ── 일반 제품 리뷰 프롬프트 ──────────────────────────────
  const prompt = `당신은 "${persona.name}"입니다. ${persona.bio || ""}
		나이: ${persona.age}세
		전문분야: ${persona.expertise}
		주요 관심사: ${persona.concern}
		글쓰기 톤: ${persona.tone}
		${variationHint}
		아래 제품 정보와 실구매자 리뷰 데이터를 바탕으로, 당신의 페르소나에 맞는 SEO 최적화 블로그 글을 작성하세요.
		${reviewIntro}

## 제품 정보:
- 제품명: ${product.title}
- 가격: ${product.price || "정보 없음"}
- 브랜드: ${product.brand || "정보 없음"}
- 제품 URL: ${product.url}
- 설명/키워드: ${product.description || "정보 없음"}${specsSummary}${reviewSection}

${promptInstructionBlock}

## 이번 글의 구조 콘셉트:
- 글쓰기 각도: ${thisProductAngleConfig.label}
- 이번 글 독자 렌즈: ${readerLens.label}
- 독자 렌즈 적용 지시: ${readerLens.instruction}
- ${thisProductAngleConfig.titleFormat}
- ${thisProductAngleConfig.h2Structure}
- 강조 포인트: ${thisProductAngleConfig.emphasis}

		## 작성 규칙:
		1. ${reviewRule1}
		2. ${reviewRule2}
		3. 사용자 프롬프트의 핵심 요청을 글의 제목/도입부/결론의 중심에 둘 것
		4. htmlContent는 반드시 하나의 <h2>로 시작하고, 첫 문단에서 사용자 프롬프트 핵심 요청에 대한 한 문장 명확한 결론을 먼저 제시할 것
		5. 본문 HTML 안에는 <h1> 태그를 절대 넣지 말 것. 페이지의 유일한 H1은 워드프레스 테마가 출력하므로, 본문은 <h2>/<h3>부터 시작해야 함
	6. 위 구조 콘셉트의 제목 형식과 H2 흐름을 반드시 지킬 것
	7. ${reviewRule7}
	8. 본문 내 구체적 수치 필수: ${numericRule}
	9. FAQ 섹션 포함 (타겟 질문 기반 + 추가 질문 3개)
	10. 2000~3000자 분량 (AI 인용 가능성은 길이와 비례)
	11. 제품의 장단점을 균형있게 서술 (E-E-A-T 신뢰도 확보 — 단점 없으면 광고로 인식)
	12. HTML 형식으로 작성 (h2, h3, p, ul, li, strong, em, table 태그 사용)
	13. <h2> 사용법 섹션에는 <ol> 단계별 리스트 필수 (HowTo 구조). 각 <li>는 구체적인 행동 단계를 포함할 것
14. 리뷰 전문의 [리뷰#숫자]와 내부 인덱스는 작성용 메모이므로 최종 HTML/제목/FAQ/요약문에 절대 노출하지 말 것
15. 같은 배치의 다른 글과 겹치지 않도록, 제목 톤·도입부 사례·핵심 장단점 배열 순서·결론 문장을 이번 글만의 방식으로 바꿀 것
		${hasAnyReviewImages ? '16. 리뷰 사진이 있는 경우 글 본문 내 적절한 위치에 <!-- REVIEW_IMG:리뷰인덱스:이미지인덱스 --> 형식으로 삽입하되, 이 placeholder 주석 외에는 리뷰 인덱스를 노출하지 말 것' : ""}
	17. 리뷰에 없는 효능, 사용 기간, 개선 수치를 임의로 만들지 말고 "리뷰상", "대체로", "많이 언급된"처럼 근거 기반 표현만 사용할 것
	18. 제목과 메타타이틀에 "리뷰 141개 분석", "SNS 난리난", "웨이팅 0분?", "TOP 3", "극찬", "완벽한 선택", "실패 없는 선택", "찐 맛집", "맛잘알 픽", "완벽 가이드", "끝판왕", "요즘 핫한", "비교불가", "놓치면 후회할" 같은 과장 카피를 절대 쓰지 말 것
	19. 제목은 정보형 문장으로 작성하고, 실제 제품명/핵심 특징/사용 상황을 차분하게 배치할 것
	20. 첫 번째 H2 바로 앞에 핵심 요약 박스를 삽입할 것. 형식: <div class="summary-box" style="background:#f8f9fa;border-left:4px solid #4caf50;padding:16px 20px;margin:20px 0;border-radius:8px"><strong>한눈에 보기</strong><ul><li>핵심 포인트 1</li><li>핵심 포인트 2</li><li>핵심 포인트 3</li></ul></div>. 이 박스는 AI 음성 답변(Speakable)의 주요 소스가 됨

	## GEO (AI 검색 최적화) 규칙:
	G1. 인용 가능 단락(Citable Passage): 각 H2 섹션 첫 부분에 해당 질문에 대한 완결된 답변을 3~5문장으로 작성할 것. 주변 맥락 없이 그 단락만 읽어도 의미가 통해야 함
	G2. 정의 패턴: 핵심 개념이 처음 나올 때 "X는(은) ~이다(하다)" 형식으로 명확히 정의
	G3. 통계 밀도: 가격, 퍼센트, 평점, 기간 등 구체적 수치를 문단마다 최소 1개 포함
	G4. 대명사 최소화: "이것", "그것", "해당 제품" 대신 실제 제품명/성분명을 반복 사용
	G5. 질문형 소제목: H2를 "~일까?", "~어떨까?", "~차이는?" 등 질문형으로 작성 (AI 쿼리 매칭)
	G6. 비교 테이블: 스펙, 가격, 장단점 비교 시 반드시 <table> 사용 (최소 1개)
	G7. 핵심 용어 볼드: 중요 키워드가 처음 나올 때 <strong> 태그로 강조
	G8. 상투적 표현 금지: "오늘날 디지털 시대에", "주목할 만한 점은", "결론적으로 말하자면", "다양한 측면에서", "~에 대해 알아보겠습니다" 등 사용 금지
	G9. 답변 우선 구조: 각 섹션 첫 1~2문장은 해당 소제목 질문에 대한 직접 답변

JSON 형식으로 응답하세요:
{
  "title": "블로그 글 제목 (SEO 최적화, 60자 이내)",
  "metaTitle": "메타 타이틀 (검색 결과용, 60자 이내)",
  "metaDescription": "메타 설명 (155자 이내, 핵심 키워드 포함)",
  "slug": "url-slug-in-english",
  "htmlContent": "<h2>...</h2><p>...</p>...",
  "excerpt": "발췌문 (2-3문장)",
  "category": "적절한 카테고리명",
	  "tags": ["태그1", "태그2", "태그3"],
	  "faq": [
	    {"question": "질문?", "answer": "답변"}
		  ]${hasAnyReviewImages ? ',\n  "usedReviewImageIndices": [[리뷰인덱스, 이미지인덱스], ...]' : ""}
		}`;

  const data = await requestGeminiContent(apiKey, prompt, {
    responseMimeType: "application/json",
    temperature: 0.9,
    maxOutputTokens: 8192,
  });
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("AI 응답이 비어있습니다.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new Error("AI 응답 JSON 파싱 실패");
    }
  }

  const faqItems: FAQItem[] = (parsed.faq || []).map(
    (f: { question: string; answer: string }) => ({
      question: f.question,
      answer: f.answer,
    })
  );

  const promptReviewImageIndices = extractReviewImageIndicesFromHtml(parsed.htmlContent || "");
  const modelReviewImageIndices = normalizeReviewImageIndices(parsed.usedReviewImageIndices, availableReviewsForImages);
  const fallbackReviewImageIndices = hasAnyReviewImages
    ? pickFallbackReviewImageIndices(
        availableReviewsForImages,
        hasRichReviews
          ? pickReviewIndices(reviewCollection!.reviews.length, articleVariation, 30, 8)
          : pickReviewIndices(product.reviews.length, articleVariation, 15, 5),
        3
      )
    : [];
  const finalUsedReviewImageIndices = mergeReviewImageIndices(
    modelReviewImageIndices,
    promptReviewImageIndices,
    fallbackReviewImageIndices
  ).slice(0, 5);
  const normalizedHtmlContent = injectReviewImagePlaceholders(parsed.htmlContent || "", finalUsedReviewImageIndices);

  const faqHtml =
    faqItems.length > 0
      ? `\n<h2>자주 묻는 질문 (FAQ)</h2>\n${faqItems
          .map(
            (f) =>
              `<details><summary><strong>${f.question}</strong></summary>\n<p>${f.answer}</p></details>`
          )
          .join("\n")}`
      : "";

  const fullHtml = normalizedHtmlContent + faqHtml;
  const wordCount = estimateVisibleWordCount(fullHtml);

  const reviewImages = buildReviewImagesFromIndices(availableReviewsForImages, finalUsedReviewImageIndices);
  const structuredRestaurantTitle = isRestaurant
    ? buildStructuredRestaurantTitleFromAngle(sourceTitle, thisRestaurantAngleConfig?.label || "")
    : parsed.title;

  return sanitizeGeneratedArticle({
    id: `${site.slug}-${Date.now()}-${articleVariation}`,
    siteSlug: site.slug,
    siteDomain: site.domain,
    personaName: persona.name,
    sourceTitle,
    targetQuestion: promptSummary,
    title: structuredRestaurantTitle,
    metaTitle: isRestaurant ? structuredRestaurantTitle : parsed.metaTitle || parsed.title,
    metaDescription: parsed.metaDescription || parsed.excerpt || "",
    slug: parsed.slug || site.slug + "-" + Date.now(),
    htmlContent: fullHtml,
    excerpt: parsed.excerpt || "",
    category: parsed.category || "일반",
    tags: parsed.tags || [],
    faqSchema: faqItems,
    wordCount,
    status: "generated" as const,
    reviewImages,
    usedReviewImageIndices: finalUsedReviewImageIndices,
  });
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function generateArticlesRoutes(app: FastifyInstance) {
  app.post("/generate-articles", async (req, reply) => {
    const {
      product,
      contentPrompt,
      siteConfigs,
      reviewCollection,
      offset = 0,
      limit,
      globalTotal,
      aeoConfig,
      contentStrategy,
    } = req.body as {
      product: ScrapedProduct;
      contentPrompt: string;
      siteConfigs: { site: SiteCredential; count: number }[];
      reviewCollection?: ReviewCollection;
      offset?: number;
      limit?: number;
      globalTotal?: number;
      aeoConfig?: AeoConfig;
      contentStrategy?: ContentStrategy;
    };

    if (!product || !contentPrompt?.trim() || !siteConfigs?.length) {
      return reply.status(400).send({ error: "필수 데이터가 누락되었습니다." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return reply.status(500).send({ error: "GEMINI_API_KEY가 설정되지 않았습니다." });
    }

    // 전체 작업 목록 생성 후 배치 슬라이싱
    const allTasks: ArticleTask[] = [];
    for (const { site, count } of siteConfigs) {
      for (let i = 0; i < count; i++) {
        allTasks.push({
          site,
          siteArticleIndex: i,
          diversityIndex: allTasks.length,
        });
      }
    }

    const batchTasks = limit != null ? allTasks.slice(offset, offset + limit) : allTasks.slice(offset);
    const total = globalTotal ?? allTasks.length;
    const PARALLEL = 3;
    const promptSummary = summarizeContentPrompt(contentPrompt);

    const { send, close } = setupSSE(reply);

    const allArticles: GeneratedArticle[] = [];

    try {
      for (let i = 0; i < batchTasks.length; i += PARALLEL) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1000));

        const parallelSlice = batchTasks.slice(i, i + PARALLEL);

        const results = await Promise.allSettled(
          parallelSlice.map(async ({ site, diversityIndex, siteArticleIndex }, sliceIdx) => {
            const globalNum = offset + i + sliceIdx + 1;

            send({
              type: "progress",
              current: globalNum,
              total,
              message: `[${globalNum}/${total}] ${normalizePersona(site).name} — "${promptSummary}" 생성 중...`,
            });

            // 최대 5회 재시도 — 429는 지수 백오프
            const RETRY_DELAYS = [0, 30, 60, 120, 180];
            let lastErr: Error | null = null;
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                if (attempt > 0) {
                  const waitSec = RETRY_DELAYS[attempt];
                  send({ type: "progress", current: globalNum, total, message: `[${globalNum}/${total}] ⏳ 429 재시도 ${attempt}/4 — ${waitSec}초 대기 중...` });
                  await new Promise((r) => setTimeout(r, waitSec * 1000));
                }
                return await generateForSite(
                  apiKey,
                  product,
                  contentPrompt,
                  site,
                  reviewCollection,
                  diversityIndex,
                  siteArticleIndex,
                  aeoConfig,
                  contentStrategy
                );
              } catch (err) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                const is429 = lastErr.message.includes("429") || lastErr.message.includes("RESOURCE_EXHAUSTED");
                if (!is429) break;
              }
            }
            throw lastErr ?? new Error("알 수 없는 오류");
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            allArticles.push(result.value);
            send({ type: "article", article: result.value });
          } else {
            send({ type: "error", message: (result.reason as Error).message?.slice(0, 150) ?? "생성 실패" });
          }
        }
      }

      send({
        type: "done",
        articles: allArticles,
        message: `${allArticles.length}개 글 생성 완료`,
      });
    } finally {
      close();
    }
  });
}
