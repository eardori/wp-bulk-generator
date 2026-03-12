/**
 * EC2 Agent HTTP 클라이언트
 * Fly.io Bridge API → EC2 Agent 통신용
 */

const EC2_AGENT_URL = process.env.EC2_AGENT_URL || "";
const EC2_AGENT_KEY = process.env.EC2_AGENT_KEY || "";

export async function ec2Fetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  if (!EC2_AGENT_URL) {
    throw new Error("EC2_AGENT_URL이 설정되지 않았습니다.");
  }

  return fetch(`${EC2_AGENT_URL}${path}`, {
    ...options,
    headers: {
      "X-Bridge-API-Key": EC2_AGENT_KEY,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

/** EC2 Agent에서 credentials + config 병합 데이터 가져오기 */
export async function fetchCredentials(): Promise<Record<string, unknown>[]> {
  const res = await ec2Fetch("/credentials");
  if (!res.ok) throw new Error(`EC2 credentials fetch 실패: ${res.status}`);
  const data = await res.json();
  return (data as { sites: Record<string, unknown>[] }).sites || [];
}

/** EC2 Agent에서 config 데이터만 가져오기 */
export async function fetchConfigs(): Promise<Record<string, unknown>[]> {
  const res = await ec2Fetch("/credentials/config");
  if (!res.ok) throw new Error(`EC2 config fetch 실패: ${res.status}`);
  const data = await res.json();
  return (data as { configs: Record<string, unknown>[] }).configs || [];
}

/** EC2 Agent에서 site groups 가져오기 */
export async function fetchGroups(): Promise<Record<string, unknown>[]> {
  const res = await ec2Fetch("/groups");
  if (!res.ok) throw new Error(`EC2 groups fetch 실패: ${res.status}`);
  const data = await res.json();
  return (data as { groups: Record<string, unknown>[] }).groups || [];
}

/** EC2 Agent에서 reserved slugs 가져오기 */
export async function fetchReservedSlugs(): Promise<{
  slugs: string[];
  domains: string[];
}> {
  const res = await ec2Fetch("/reserved-slugs", { method: "POST" });
  if (!res.ok)
    throw new Error(`EC2 reserved-slugs fetch 실패: ${res.status}`);
  return res.json() as Promise<{ slugs: string[]; domains: string[] }>;
}
