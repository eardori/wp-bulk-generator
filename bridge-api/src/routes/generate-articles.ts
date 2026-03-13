import * as cheerio from "cheerio";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";
import type {
  ScrapedProduct,
  ProductReview,
  ReviewImage,
  ReviewCollection,
  ReviewTheme,
} from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

type TargetQuestion = {
  question: string;
  intent: "recommendation" | "comparison" | "review" | "howto";
};

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
  questionIndex: number;
  articleVariation: number;
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

const DEFAULT_PERSONA: SitePersona = {
  name: "운영팀",
  age: 35,
  concern: "실사용 후기",
  expertise: "제품 분석",
  tone: "신뢰감 있는",
  bio: "실구매 리뷰와 공개 정보를 바탕으로 핵심만 정리해 전달합니다.",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickReviewIndices(reviewCount: number, articleVariation: number, windowSize = 30, segments = 8) {
  if (reviewCount <= 0) return [];
  if (reviewCount <= windowSize) {
    return Array.from({ length: reviewCount }, (_, idx) => idx);
  }
  const step = Math.max(5, Math.floor(reviewCount / segments));
  const offset = (articleVariation * step) % reviewCount;
  return Array.from({ length: windowSize }, (_, idx) => (offset + idx) % reviewCount);
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
      section += `- ${label} [리뷰#${item.globalIndex}] ${truncateText(item.review.text, 110)}\n`;
    }
  }

  section += `\n### 실제 리뷰 전문 (${indexedReviews.length}건, 아래 번호는 전역 인덱스):\n`;
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

  const averageRating = Math.round(
    (indexedReviews.reduce((sum, { review }) => sum + review.rating, 0) / indexedReviews.length) * 10
  ) / 10;
  const positiveCount = indexedReviews.filter(({ review }) => review.rating >= 4).length;
  const optionCounts = Array.from(
    indexedReviews.reduce((acc, { review }) => {
      const option = review.purchaseOption?.trim();
      if (option) acc.set(option, (acc.get(option) || 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);
  const representativeReviews = pickRepresentativeReviews(indexedReviews);

  let section = `\n\n## 실방문자 리뷰 분석:\n`;
  section += `- 이번 글에 전달된 리뷰: ${indexedReviews.length}건\n`;
  section += `- 이번 리뷰 묶음 평균 평점: ${averageRating}점\n`;
  section += `- 만족 리뷰 비율(4~5점): ${formatPercent(positiveCount, indexedReviews.length)}%\n`;

  if (optionCounts.length > 0) {
    section += `- 자주 언급된 메뉴/옵션: ${optionCounts
      .slice(0, 4)
      .map(([option, count]) => `${option}(${count})`)
      .join(", ")}\n`;
  }

  if (representativeReviews.length > 0) {
    section += `\n### 대표 리뷰 근거:\n`;
    for (const { label, item } of representativeReviews) {
      section += `- ${label} [리뷰#${item.globalIndex}] ${truncateText(item.review.text, 110)}\n`;
    }
  }

  section += `\n### 실제 리뷰 전문 (${indexedReviews.length}건, 아래 번호는 전역 인덱스):\n`;
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

// ── Gemini call ──────────────────────────────────────────────────────────────

async function generateForSite(
  apiKey: string,
  product: ScrapedProduct,
  primaryQuestion: TargetQuestion,
  otherQuestions: TargetQuestion[],
  site: SiteCredential,
  reviewCollection?: ReviewCollection,
  articleVariation = 0,
): Promise<GeneratedArticle> {
  const persona = normalizePersona(site);
  const sourceTitle = product.title?.trim() || site.title || site.slug;

  const primaryLine = `"${primaryQuestion.question}" (의도: ${primaryQuestion.intent})`;
  const otherQuestionsList =
    otherQuestions.length > 0
      ? otherQuestions.map((q, i) => `${i + 1}. "${q.question}"`).join("\n")
      : "";

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
      `\n\n## 제품 리뷰 (스크랩 기반, 이번 글에 전달된 리뷰 ${indexedReviews.length}건):\n` +
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
  const isRestaurant = product.source === "naver-place";
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
      label: "첫 방문 솔직 후기",
      titleFormat: `제목 형식: "처음 가봤는데 [솔직한 결과]" 또는 "[지역] [음식종류] 추천받아서 가봤더니" — 가게명을 제목 앞에 넣지 말 것`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 방문하게 된 계기 & 찾아가는 법
② 들어서는 순간 첫인상 & 분위기
③ 실제로 먹어본 메뉴 솔직 평가 (기대 vs 현실)
④ 좋았던 점 3가지 / 아쉬웠던 점 2가지
⑤ 재방문 의향 & 이런 분께 추천합니다`,
    },
    {
      label: "메뉴 & 가격 완전 정복",
      titleFormat: `제목 형식: "[주메뉴] 가격 & 후기 총정리" 또는 "메뉴 뭐 시킬지 고민됐는데 다 먹어봤습니다" — 가게명보다 음식/메뉴를 제목 앞에 배치`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 전체 메뉴판 & 가격 총정리 (표로 정리)
② 시그니처 메뉴 상세 리뷰 (맛, 양, 비주얼)
③ 사이드 & 추가 메뉴 가성비 평가
④ 리뷰어들이 가장 많이 언급한 메뉴 TOP 3
⑤ 처음 방문자 추천 조합 & 피해야 할 메뉴`,
    },
    {
      label: "데이트 & 분위기 맛집",
      titleFormat: `제목 형식: "데이트하기 좋은 [음식종류]집" 또는 "[지역] 분위기 좋은 [음식종류] 맛집" — 분위기/데이트 키워드를 제목에 포함`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 공간 & 인테리어 상세 묘사 (조명, 좌석, 동선)
② 프라이빗한 좌석 vs 오픈 좌석 구성
③ 데이트 코스 추천 (주변 카페·관광지 포함)
④ 커플·소개팅 방문 시 주의사항 & 팁
⑤ 예약 방법 & 방문 최적 시간대`,
    },
    {
      label: "가성비 & 재방문 분석",
      titleFormat: `제목 형식: "가성비 [음식종류] 찾다가 발견한 곳" 또는 "[가격대]에 이 퀄리티?" — 가격/가성비 키워드를 제목에 포함`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 가격표 & 경쟁 가게 대비 가성비 분석
② 양 & 퀄리티 — 실제로 배부를까?
③ 리뷰 분석으로 본 재방문율 & 단골 비율
④ 더 저렴하게 먹는 꿀팁 (타이밍, 세트 조합)
⑤ 총합 가성비 점수 & 추천 기준`,
    },
    {
      label: "리뷰 기반 베스트 메뉴 추천",
      titleFormat: `제목 형식: "꼭 먹어야 할 메뉴 TOP [숫자]" 또는 "리뷰 [N]개 분석해서 뽑은 최애 메뉴" — 추천/TOP 키워드로 시작`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 리뷰 데이터로 선정한 베스트 메뉴 선정 기준
② TOP 1 — 압도적 1위 메뉴 심층 리뷰
③ TOP 2~3 — 강력 추천 메뉴 상세 비교
④ 의외의 숨겨진 메뉴 & 직원 추천 메뉴
⑤ 이 조합이 최고입니다 (주메뉴 + 사이드 세트)`,
    },
    {
      label: "타 가게와의 차별점",
      titleFormat: `제목 형식: "다른 [음식종류]집이랑 다른 점" 또는 "왜 이 가게만 줄을 서는가" — 비교/차별화 키워드 포함`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 비슷한 가게들과 무엇이 다른가
② 이 가게만의 시그니처 조리법 & 맛의 비결
③ 서비스 스타일 & 사장님 스토리
④ 단골들이 특히 칭찬하는 포인트 (리뷰 인용)
⑤ 이런 분께는 추천 / 이런 분께는 비추`,
    },
    {
      label: "가족 & 단체 방문 완전 가이드",
      titleFormat: `제목 형식: "가족끼리 가기 좋은 [음식종류]집" 또는 "아이 데리고 가도 될까? [가게명] 직접 가봄" — 가족/아이 키워드 포함`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 단체석 & 유아시설 (아이 의자, 수유실, 키즈존)
② 어르신·아이 함께 먹기 좋은 메뉴 구성
③ 주차 & 접근성 (대중교통 + 자차 방문 기준)
④ 가족 모임으로 이 가게를 선택한 이유
⑤ 방문 전 전화 예약 필수 여부 & 대기 팁`,
    },
    {
      label: "SNS 핫플 & 현실 비교",
      titleFormat: `제목 형식: "웨이팅 [N]분 기다려서 먹어봤는데" 또는 "SNS에서 난리난 [음식종류]집 실제로 가봤다" — 웨이팅/SNS/현실 키워드 포함`,
      h2Structure: `H2 소제목 5개 (이 순서 그대로):
① 왜 지금 이 가게가 핫한가 (인기 배경)
② 인스타 사진 vs 실물 비교 (솔직하게)
③ 대기 줄 & 웨이팅 실제 소요 시간 (시간대별)
④ 포토스팟 & 감성 사진 잘 나오는 각도 팁
⑤ 덜 기다리고 방문하는 꿀타임 & 예약 방법`,
    },
  ];

  const thisRestaurantAngleConfig = isRestaurant
    ? restaurantAngleConfigs[articleVariation % restaurantAngleConfigs.length]
    : null;
  const thisProductAngleConfig = productAngleConfigs[articleVariation % productAngleConfigs.length];

  const variationHint =
    articleVariation > 0
      ? `\n⚠️ 같은 페르소나의 ${articleVariation + 1}번째 글입니다. 이전 글과 제목 형식·H2 구조·도입부가 절대 겹치지 않아야 합니다.`
      : "";

  // ── 맛집/장소 전용 프롬프트 ────────────────────────────────────
  if (isRestaurant) {
    const reviewsSection = buildPlaceReviewPromptSection(product.reviews, articleVariation);
    const placeHasReviewImages = product.reviews.some((review) => (review.images?.length || 0) > 0);

    const placeInfo = [
      product.specs["주소"] && `주소: ${product.specs["주소"]}`,
      product.specs["전화"] && `전화: ${product.specs["전화"]}`,
      product.specs["영업시간"] && `영업시간: ${product.specs["영업시간"]}`,
      product.specs["편의시설"] && `편의시설: ${product.specs["편의시설"]}`,
      product.specs["찾아가는길"] && `찾아가는길: ${product.specs["찾아가는길"]}`,
      product.specs["키워드"] && `특징키워드: ${product.specs["키워드"]}`,
    ].filter(Boolean).join("\n");

    const restaurantPrompt = `당신은 "${persona.name}"입니다. ${persona.bio || ""}
나이: ${persona.age}세 | 글쓰기 톤: ${persona.tone}
${variationHint}

당신이 직접 방문한 맛집 리뷰 블로그 글을 작성하세요.
아래 장소 정보와 실방문자 리뷰를 바탕으로 생생하고 신뢰도 높은 맛집 리뷰 글을 작성하세요.

## 장소 정보:
- 가게명: ${product.title}
- 카테고리: ${product.category || product.brand}
- 설명: ${product.description || ""}
${placeInfo}${reviewsSection}

## 메인 타겟 질문 (이 글의 핵심 주제):
"${primaryQuestion.question}" (의도: ${primaryQuestion.intent})

## 이번 글의 구조 콘셉트:
- 글쓰기 각도: ${thisRestaurantAngleConfig!.label}
- ${thisRestaurantAngleConfig!.titleFormat}
- ${thisRestaurantAngleConfig!.h2Structure}
- 전개 원칙: 이번 리뷰 묶음에서 자주 나온 메뉴/분위기/주의점을 중심으로 내용을 채우고, 이전 글과 표현을 겹치지 말 것

${otherQuestionsList ? `## 보조 질문 (본문에서 자연스럽게 언급):\n${otherQuestionsList}\n` : ""}
## 작성 규칙:
1. 글 최상단에 <div class="summary-box"> 요약 박스 필수: 가게명/위치/분위기/추천 메뉴/가격대를 한눈에 파악할 수 있도록
2. 첫 문단에서 메인 질문에 대한 한 문장 명확한 결론 먼저 (Bottom Line Up Front)
3. 위 구조 콘셉트의 제목 형식과 H2 순서를 반드시 지킬 것
4. 실방문자 리뷰에서 반복되는 키워드/의견을 인용하여 "많은 방문자들이 공통적으로..." 형식으로 서술
5. 대표 리뷰 근거 섹션의 포인트를 서로 다른 H2에 분산 배치하여 같은 문단 톤이 반복되지 않게 할 것
6. 주소, 영업시간, 전화번호, 편의시설을 별도 인포박스(<div class="place-info">)에 정리
7. 장단점을 균형있게 서술 (단점 없으면 광고로 보임 → 신뢰도 하락)
8. FAQ: "예약 필수인가요?", "주차 가능한가요?", "가격대는?" 등 실용적 질문 4개
9. 구체적 수치: 대기시간, 가격대, 좌석 수, 영업시간 등 최대한 포함
10. 2000~3000자 분량
11. HTML 형식 (h2, h3, p, ul, li, strong, em, table 태그)
12. 마지막에 방문 정보 총정리 <table> 필수 (항목: 위치, 영업시간, 전화, 주차, 예약여부, 가격대)
13. 리뷰에 없는 웨이팅 시간, 메뉴 가격, 좌석 수는 임의로 확정하지 말고 "리뷰상", "현장 기준"처럼 범위/맥락형으로 적을 것
${placeHasReviewImages ? '14. 사진이 있는 리뷰는 본문 내 적절한 위치에 <!-- REVIEW_IMG:리뷰인덱스:이미지인덱스 --> 형식으로 삽입하고, 메뉴/분위기 설명이 나오는 문단 가까이에 배치할 것' : ""}

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

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: restaurantPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.95, maxOutputTokens: 8192 },
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

    return {
      id: `${site.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      siteSlug: site.slug,
      siteDomain: site.domain,
      personaName: persona.name,
      sourceTitle,
      targetQuestion: primaryQuestion.question,
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
      status: "generated",
      reviewImages: restaurantReviewImages,
      usedReviewImageIndices: finalRestaurantReviewImageIndices,
    };
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

## 메인 타겟 질문 (이 글의 핵심 주제):
${primaryLine}

## 이번 글의 구조 콘셉트:
- 글쓰기 각도: ${thisProductAngleConfig.label}
- ${thisProductAngleConfig.titleFormat}
- ${thisProductAngleConfig.h2Structure}
- 강조 포인트: ${thisProductAngleConfig.emphasis}

	${otherQuestionsList ? `## 보조 타겟 질문 (본문에서 자연스럽게 언급):\n${otherQuestionsList}\n` : ""}
	## 작성 규칙:
	1. ${reviewRule1}
	2. ${reviewRule2}
	3. 메인 타겟 질문을 글의 제목/도입부/결론의 핵심으로 활용
	4. 글 최상단에 <div class="summary-box"> 요약 박스 필수: 메인 질문에 대한 2~3문장 직접 답변 + 핵심 포인트 3개 bullet (AI 검색·AI 개요 직접 인용 대상)
	5. 첫 번째 문단에서 메인 질문에 대한 한 문장 명확한 결론 먼저 제시 (Bottom Line Up Front)
	6. 위 구조 콘셉트의 제목 형식과 H2 흐름을 반드시 지킬 것
	7. ${reviewRule7}
	8. 본문 내 구체적 수치 필수: ${numericRule}
	9. FAQ 섹션 포함 (타겟 질문 기반 + 추가 질문 3개)
	10. 2000~3000자 분량 (AI 인용 가능성은 길이와 비례)
	11. 제품의 장단점을 균형있게 서술 (E-E-A-T 신뢰도 확보 — 단점 없으면 광고로 인식)
	12. HTML 형식으로 작성 (h2, h3, p, ul, li, strong, em, table 태그 사용)
	13. <h2> 사용법 섹션에는 <ol> 단계별 리스트 필수 (HowTo 구조)
		${hasAnyReviewImages ? '14. 리뷰 전문에 표기된 "[리뷰#숫자]"는 전역 인덱스이므로, 이미지 placeholder를 쓸 때 반드시 그 숫자를 그대로 사용할 것' : ""}
		${hasAnyReviewImages ? '15. 리뷰 사진이 있는 경우 글 본문 내 적절한 위치에 <!-- REVIEW_IMG:리뷰인덱스:이미지인덱스 --> 형식으로 삽입 (최대 5개, 설명이 필요한 부분에만)' : ""}
	16. 리뷰에 없는 효능, 사용 기간, 개선 수치를 임의로 만들지 말고 "리뷰상", "대체로", "많이 언급된"처럼 근거 기반 표현만 사용할 것

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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.9,
          maxOutputTokens: 8192,
        },
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

  return {
    id: `${site.slug}-${Date.now()}-${articleVariation}`,
    siteSlug: site.slug,
    siteDomain: site.domain,
    personaName: persona.name,
    sourceTitle,
    targetQuestion: primaryQuestion.question,
    title: parsed.title,
    metaTitle: parsed.metaTitle || parsed.title,
    metaDescription: parsed.metaDescription || parsed.excerpt || "",
    slug: parsed.slug || site.slug + "-" + Date.now(),
    htmlContent: fullHtml,
    excerpt: parsed.excerpt || "",
    category: parsed.category || "일반",
    tags: parsed.tags || [],
    faqSchema: faqItems,
    wordCount,
    status: "generated",
    reviewImages,
    usedReviewImageIndices: finalUsedReviewImageIndices,
  };
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function generateArticlesRoutes(app: FastifyInstance) {
  app.post("/generate-articles", async (req, reply) => {
    const {
      product,
      targetQuestions,
      siteConfigs,
      reviewCollection,
      offset = 0,
      limit,
      globalTotal,
    } = req.body as {
      product: ScrapedProduct;
      targetQuestions: TargetQuestion[];
      siteConfigs: { site: SiteCredential; count: number }[];
      reviewCollection?: ReviewCollection;
      offset?: number;
      limit?: number;
      globalTotal?: number;
    };

    if (!product || !targetQuestions?.length || !siteConfigs?.length) {
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
        allTasks.push({ site, questionIndex: i % targetQuestions.length, articleVariation: i });
      }
    }

    const batchTasks = limit != null ? allTasks.slice(offset, offset + limit) : allTasks.slice(offset);
    const total = globalTotal ?? allTasks.length;
    const PARALLEL = 3;

    const { send, close } = setupSSE(reply);

    const allArticles: GeneratedArticle[] = [];

    try {
      for (let i = 0; i < batchTasks.length; i += PARALLEL) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1000));

        const parallelSlice = batchTasks.slice(i, i + PARALLEL);

        const results = await Promise.allSettled(
          parallelSlice.map(async ({ site, questionIndex, articleVariation }, sliceIdx) => {
            const globalNum = offset + i + sliceIdx + 1;
            const primaryQuestion = targetQuestions[questionIndex];
            const otherQuestions = targetQuestions.filter((_, idx) => idx !== questionIndex);

            send({
              type: "progress",
              current: globalNum,
              total,
              message: `[${globalNum}/${total}] ${normalizePersona(site).name} — "${primaryQuestion.question}" 생성 중...`,
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
                return await generateForSite(apiKey, product, primaryQuestion, otherQuestions, site, reviewCollection, articleVariation);
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
