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

const REVIEW_REF_PATTERNS = [
  /\s*\[리뷰#\d+\]\s*/g,
  /\s*\(리뷰#\d+\)\s*/g,
  /(^|[\s>"'“‘(\[])(리뷰#\d+)(?=([\s<"'”’)\].,:;!?]|$))/g,
];

export function sanitizeInternalReviewRefs(text: string): string {
  let sanitized = text || "";

  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[0], " ");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[1], " ");
  sanitized = sanitized.replace(REVIEW_REF_PATTERNS[2], "$1");
  sanitized = sanitized.replace(/\s{2,}/g, " ");

  return sanitized.trim();
}

export function sanitizeInternalReviewRefsInHtml(html: string): string {
  let sanitized = sanitizeInternalReviewRefs(html || "");
  sanitized = sanitized.replace(/>\s+/g, ">");
  sanitized = sanitized.replace(/\s+</g, "<");
  return sanitized.trim();
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
      ? article.tags.map((tag) => sanitizeInternalReviewRefs(tag)).filter(Boolean)
      : [],
    faqSchema: Array.isArray(article.faqSchema)
      ? article.faqSchema.map((faq) => ({
          question: sanitizeInternalReviewRefs(faq.question),
          answer: sanitizeInternalReviewRefs(faq.answer),
        }))
      : [],
  };
}
