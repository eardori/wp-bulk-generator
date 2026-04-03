export type BingSyncResult = {
    siteUrl: string;
    feedUrl: string;
    added: boolean;
    feedSubmitted: boolean;
    notes: string[];
    errors: string[];
};
export type BingUrlSubmissionResult = {
    siteUrl: string;
    submitted: number;
    batches: number;
    errors: string[];
};
export declare function isBingWebmasterSyncEnabled(): boolean;
export declare function submitBingUrls(urls: string[], siteUrl?: string): Promise<BingUrlSubmissionResult>;
export declare function syncBingSite(siteUrl: string): Promise<BingSyncResult>;
//# sourceMappingURL=bing-webmaster.d.ts.map