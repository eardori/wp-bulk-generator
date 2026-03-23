import * as cheerio from "cheerio";

type FAQItem = {
  question: string;
  answer: string;
};

type GeneratedArticleLike = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  htmlContent: string;
  excerpt: string;
  tags: string[];
  faqSchema: FAQItem[];
};

const REVIEW_KEYWORD_TAG_PATTERNS = [
  /(?:맛있어요|좋아요|멋져요|친절해요|깔끔해요|깨끗해요|신선해요|넓어요|아늑해요|편해요|편리해요|특별해요|훌륭해요|세련됐어요|고급스러워요|만족스러워요)$/u,
  /(?:음식|고기\s*질|서비스|인테리어|매장|분위기|재료|양|가성비|주차|좌석|화장실|반찬|소스|직원|응대|룸|공간).*(?:맛있어요|좋아요|멋져요|친절해요|깔끔해요|깨끗해요|신선해요|넓어요|아늑해요|편해요|편리해요|특별해요|훌륭해요|세련됐어요|고급스러워요|만족스러워요)$/u,
];

const REVIEW_REF_PATTERNS = [
  /\s*\[리뷰#\d+\]\s*/g,
  /\s*\(리뷰#\d+\)\s*/g,
  /(^|[\s>"'“‘(\[])(리뷰#\d+)(?=([\s<"'”’)\].,:;!?]|$))/g,
  /\s*\[review#\d+\]\s*/gi,
  /\s*\(review#\d+\)\s*/gi,
  /(^|[\s>"'“‘(\[])(review#\d+)(?=([\s<"'”’)\].,:;!?]|$))/gi,
  /\s*리뷰\s*\d+\s*번\s*/g,
];

const REVIEW_META_REPLACEMENTS: Array<[RegExp, string]> = [
  [/총\s*\d+\s*개(?:의)?\s*리뷰(?:\s*데이터)?(?:를)?\s*기반(?:으로)?/gu, ""],
  [/리뷰\s*데이터(?:를)?\s*기반(?:으로)?/gu, ""],
  [/리뷰\s*기반(?:으로)?/gu, ""],
  [/리뷰를\s*(?:보면|종합하면|살펴보면)/gu, ""],
  [/많은\s*(?:방문자|방문객)들이\s*공통적으로/gu, "특히"],
  [/방문자들이\s*공통적으로/gu, "특히"],
  [/리뷰어(?:들)?(?:가)?\s*가장\s*많이\s*언급한/gu, "대표"],
  [/방문자(?:들)?(?:이)?\s*가장\s*많이\s*언급한/gu, "대표"],
  [/실제\s*(?:구매자|사용자)\s*리뷰\s*사진/gu, "참고 이미지"],
  [/실제\s*사용\s*사진/gu, "참고 이미지"],
];

const TITLE_COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/리뷰\s*\d+개\s*분석[!！]?\s*[:：!,-]?\s*/gu, ""],
  [/SNS(?:서)?\s*난리난\s*/gu, ""],
  [/웨이팅\s*\d+\s*분\??\s*/gu, ""],
  [/웨이팅\s*없이/gu, "방문 전 참고할"],
  [/맛잘알\s*픽/gu, "추천 포인트"],
  [/찐\s*맛집/gu, "추천할 만한 곳"],
  [/현지인(?:이|도)?\s*인정한/gu, ""],
  [/실패\s*없는\s*선택/gu, "무난한 선택"],
  [/후회\s*없는\s*선택/gu, "고려해볼 만한 선택"],
  [/완벽한\s*선택/gu, "가볼 만한 선택"],
  [/완벽\s*가이드/gu, "방문 가이드"],
  [/완벽\s*공략/gu, "방문 가이드"],
  [/완벽\s*분석/gu, "분석"],
  [/완벽\s*정리/gu, "정리"],
  [/완전\s*정복/gu, "정리"],
  [/전격\s*해부/gu, "정리"],
  [/극찬(?:하는|한|할까)?/gu, "호평"],
  [/난리난/gu, "주목받는"],
  [/요즘\s*(?:핫한|뜨는)/gu, "주목받는"],
  [/핫플/gu, "관심받는 곳"],
  [/SNS\s*핫플/gu, "SNS 관심을 받은 곳"],
  [/SNS\s*인기/gu, "SNS 관심"],
  [/SNS\s*사진(?:만큼)?/gu, "사진"],
  [/인기\s*폭발/gu, "주목받는"],
  [/성공\s*보장/gu, "방문 가이드"],
  [/놓치면\s*후회할/gu, "추천"],
  [/끝판왕/gu, "만족도 높은"],
  [/비교\s*불가/gu, "차별점이 돋보이는"],
  [/비교불가/gu, "차별점이 돋보이는"],
  [/인생\s*갈비/gu, "대표 갈비"],
  [/꿀팁\s*공개/gu, "방문 팁"],
  [/실화\?/gu, ""],
  [/가성비\s*갑/gu, "가성비가 좋은"],
  [/TOP\s*\d+/giu, "추천"],
  [/꼭\s*먹어야\s*할\s*메뉴/gu, "추천 메뉴"],
];

const EMPTY_INFO_TEXT_PATTERN =
  /^(?:전화|주소|지번주소|지역|영업시간|주차|예약(?:여부)?|가격대|대표메뉴|메뉴|가격|편의시설|찾아가는길)\s*[:：-]?\s*(?:정보 없음|문의 필요|확인 필요)\s*$/u;

export function sanitizeInternalReviewRefs(text: string): string {
  let sanitized = text || "";

  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[0], " ");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[1], " ");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[2], "$1");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[3], " ");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[4], " ");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[5], "$1");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[6], " ");
  sanitized = sanitized.replace(/\s{2,}/g, " ");

  return sanitized.trim();
}

function sanitizeMetaReviewPhrases(text: string): string {
  let sanitized = text || "";

  for (const [pattern, replacement] of REVIEW_META_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  sanitized = sanitized.replace(/(:\s*)(?:정보 없음|문의 필요|확인 필요)\b/gu, "$1");
  sanitized = sanitized.replace(/\s{2,}/g, " ");
  sanitized = sanitized.replace(/\s+([,.;:!?])/g, "$1");
  sanitized = sanitized.replace(/([:：-])\s*(?:<\/[^>]+>)?$/gu, "");

  return sanitized.trim();
}

function sanitizeTitleCopy(text: string): string {
  let sanitized = text || "";

  for (const [pattern, replacement] of TITLE_COPY_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  sanitized = sanitized.replace(/추천\s*추천/gu, "추천");
  sanitized = sanitized.replace(/추천\s*메뉴\s*추천/gu, "추천 메뉴");
  sanitized = sanitized.replace(/가이드\s*가이드/gu, "가이드");
  sanitized = sanitized.replace(/분석\s*분석/gu, "분석");
  sanitized = sanitized.replace(/정리\s*정리/gu, "정리");
  sanitized = sanitized.replace(/\s{2,}/g, " ");
  sanitized = sanitized.replace(/\s+([,.;:!?])/g, "$1");
  sanitized = sanitized.replace(/([:：-])\s*([,.;:!?])/gu, "$2");
  sanitized = sanitized.replace(/[!！]{2,}/gu, "!");
  sanitized = sanitized.replace(/\?\?+/gu, "?");
  sanitized = sanitized.replace(/\s*[:：-]\s*$/gu, "");
  sanitized = sanitized.replace(/^\s*[:：-]\s*/gu, "");

  return sanitized.trim();
}

export function sanitizeInternalReviewRefsInHtml(html: string): string {
  const $ = cheerio.load(sanitizeInternalReviewRefs(html || ""), null, false);

  $("tr, p, li, div.place-info div, div.place-info p, td, th, figcaption").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();

    if (EMPTY_INFO_TEXT_PATTERN.test(text)) {
      $(el).remove();
      return;
    }

    if ($(el).children().length === 0) {
      const cleaned = sanitizeMetaReviewPhrases(text);
      if (!cleaned) {
        $(el).remove();
        return;
      }
      $(el).text(cleaned);
    }
  });

  let sanitized = $.html();
  sanitized = sanitizeMetaReviewPhrases(sanitized);
  sanitized = sanitized.replace(/>\s+/g, ">");
  sanitized = sanitized.replace(/\s+</g, "<");
  return sanitized.trim();
}

function isReviewKeywordTag(tag: string): boolean {
  const value = (tag || "").trim();
  if (!value) return false;
  return REVIEW_KEYWORD_TAG_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeHealthFoodStructureInHtml(html: string): string {
  const $ = cheerio.load(html || "", null, false);

  $('link[rel="canonical"]').remove();

  $("h1").each((_, el) => {
    const $el = $(el);
    const attrs = { ...($el.attr() || {}) };
    const replacement = $("<h2></h2>");
    replacement.html($el.html() || "");
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === "string") {
        replacement.attr(key, value);
      }
    }
    $el.replaceWith(replacement);
  });

  $("script[type='application/ld+json']").each((_, el) => {
    const text = ($(el).html() || "").trim();
    if (!text) {
      $(el).remove();
    }
  });

  return $.html().trim();
}

export function sanitizeGeneratedArticle<T extends GeneratedArticleLike>(article: T): T {
  return {
    ...article,
    title: sanitizeTitleCopy(
      sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.title))
    ),
    metaTitle: sanitizeTitleCopy(
      sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.metaTitle))
    ),
    metaDescription: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.metaDescription)),
    htmlContent: normalizeHealthFoodStructureInHtml(
      sanitizeInternalReviewRefsInHtml(article.htmlContent)
    ),
    excerpt: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.excerpt)),
    tags: Array.isArray(article.tags)
      ? article.tags
          .map((tag) => sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(tag)))
          .filter((tag) => tag && !isReviewKeywordTag(tag))
      : [],
    faqSchema: Array.isArray(article.faqSchema)
      ? article.faqSchema.map((faq) => ({
          question: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(faq.question)),
          answer: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(faq.answer)),
        }))
      : [],
  };
}
