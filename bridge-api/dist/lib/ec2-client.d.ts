/**
 * EC2 Agent HTTP 클라이언트
 * Fly.io Bridge API → EC2 Agent 통신용
 */
export declare function ec2Fetch(path: string, options?: RequestInit): Promise<Response>;
/** EC2 Agent에서 credentials + config 병합 데이터 가져오기 */
export declare function fetchCredentials(): Promise<Record<string, unknown>[]>;
/** EC2 Agent에서 config 데이터만 가져오기 */
export declare function fetchConfigs(): Promise<Record<string, unknown>[]>;
/** EC2 Agent에서 site groups 가져오기 */
export declare function fetchGroups(): Promise<Record<string, unknown>[]>;
/** EC2 Agent에서 reserved slugs 가져오기 */
export declare function fetchReservedSlugs(): Promise<{
    slugs: string[];
    domains: string[];
}>;
//# sourceMappingURL=ec2-client.d.ts.map