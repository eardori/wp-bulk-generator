export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type ContentJobInput = {
    productUrl: string;
    contentPrompt: string;
    product: unknown;
    reviewCollection: unknown | null;
    siteConfigs: {
        slug: string;
        count: number;
    }[];
    aeoConfig?: unknown;
    contentStrategy?: unknown;
    autoPublish: boolean;
};
export type ContentJob = {
    id: string;
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
    input: ContentJobInput;
    totalArticles: number;
    generatedCount: number;
    publishedCount: number;
    failedCount: number;
    currentTask: string;
    log: string[];
    articles: unknown[];
    errors: {
        siteSlug: string;
        message: string;
    }[];
};
export declare function generateJobId(): string;
export declare function createJob(input: ContentJobInput): ContentJob;
export declare function getJob(id: string): ContentJob | null;
export declare function listJobs(limit?: number): ContentJob[];
export declare function updateJob(id: string, updates: Partial<ContentJob>): ContentJob | null;
export declare function appendJobLog(id: string, message: string): void;
export declare function cancelJob(id: string): boolean;
export declare function deleteJob(id: string): boolean;
//# sourceMappingURL=job-store.d.ts.map