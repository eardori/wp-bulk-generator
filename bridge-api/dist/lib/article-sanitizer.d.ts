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
export declare function sanitizeInternalReviewRefs(text: string): string;
export declare function sanitizeInternalReviewRefsInHtml(html: string): string;
export declare function sanitizeGeneratedArticle<T extends GeneratedArticleLike>(article: T): T;
export {};
//# sourceMappingURL=article-sanitizer.d.ts.map