export type PersonaInput = {
    name: string;
    bio?: string;
    slug?: string;
};
export type SiteForSync = {
    slug: string;
    persona?: PersonaInput;
};
export type AuthorSyncResult = {
    userId?: number;
    updated: boolean;
    newName?: string;
    newSlug?: string;
    newDescription?: string;
    error?: string;
};
export declare function syncWpAuthorFromPersona(site: SiteForSync, baseUrl: string, wpHeaders: Record<string, string>, timeoutMs?: number): Promise<AuthorSyncResult>;
//# sourceMappingURL=author-sync.d.ts.map