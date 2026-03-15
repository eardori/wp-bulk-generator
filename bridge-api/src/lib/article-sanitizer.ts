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

export function sanitizeInternalReviewRefsInHtml(html: string): string {
  let sanitized = sanitizeInternalReviewRefs(html || "");
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
    title: sanitizeInternalReviewRefs(article.title),
    metaTitle: sanitizeInternalReviewRefs(article.metaTitle),
    metaDescription: sanitizeInternalReviewRefs(article.metaDescription),
    htmlContent: sanitizeInternalReviewRefsInHtml(article.htmlContent),
    excerpt: sanitizeInternalReviewRefs(article.excerpt),
    tags: Array.isArray(article.tags)
      ? article.tags
          .map((tag) => sanitizeInternalReviewRefs(tag))
          .filter((tag) => tag && !isReviewKeywordTag(tag))
      : [],
    faqSchema: Array.isArray(article.faqSchema)
      ? article.faqSchema.map((faq) => ({
          question: sanitizeInternalReviewRefs(faq.question),
          answer: sanitizeInternalReviewRefs(faq.answer),
        }))
      : [],
  };
}
