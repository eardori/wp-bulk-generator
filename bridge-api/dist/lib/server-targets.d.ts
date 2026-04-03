export type SiteServerFields = {
    slug: string;
    site_dir?: string;
    server_id?: string;
    server_host?: string;
    server_user?: string;
    server_key_path?: string;
    server_site_root?: string;
    server_repo_root?: string;
    server_credentials_path?: string;
    server_config_path?: string;
};
export type ServerTarget = {
    id: string;
    mode: "local" | "ssh";
    host?: string;
    user?: string;
    keyPath?: string;
    siteRoot: string;
    repoRoot: string;
    credentialsPath: string;
    configPath: string;
};
export declare function getPrimaryServerTarget(): ServerTarget;
export declare function getSecondaryServerTarget(): ServerTarget | null;
export declare function getDefaultDeployTarget(): ServerTarget;
export declare function resolveSiteTarget(site: SiteServerFields): ServerTarget;
export declare function isRemoteTarget(target: ServerTarget): boolean;
export declare function getSiteDirForTarget(site: Pick<SiteServerFields, "slug" | "site_dir" | "server_site_root">, target: ServerTarget): string;
//# sourceMappingURL=server-targets.d.ts.map