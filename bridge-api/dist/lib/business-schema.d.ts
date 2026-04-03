type BusinessSchemaInput = {
    title: string;
    excerpt?: string;
    contentHtml: string;
    url?: string;
    sourceName?: string;
};
export declare function stripReviewReferenceMarkers(html: string): string;
export declare function buildBusinessSchemaFromHtml(input: BusinessSchemaInput): Record<string, unknown> | null;
export {};
//# sourceMappingURL=business-schema.d.ts.map