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

export function sanitizeGeneratedArticle<T extends GeneratedArticleLike>(article: T): T {
  return {
    ...article,
    title: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.title)),
    metaTitle: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.metaTitle)),
    metaDescription: sanitizeMetaReviewPhrases(sanitizeInternalReviewRefs(article.metaDescription)),
    htmlContent: sanitizeInternalReviewRefsInHtml(article.htmlContent),
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
