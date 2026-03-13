import jwt from "jsonwebtoken";

const BRIDGE_URL = process.env.BRIDGE_API_URL || "";
const BRIDGE_KEY = process.env.BRIDGE_API_KEY || "";
const JWT_SECRET = process.env.BRIDGE_JWT_SECRET || "";

/**
 * 서버사이드: Vercel API route → Bridge API 호출
 */
export async function bridgeFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${BRIDGE_URL}${path}`, {
    ...options,
    headers: {
      "X-Bridge-API-Key": BRIDGE_KEY,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

export async function parseBridgeJsonResponse(
  res: Response
): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    const summary = summarizeBridgeBody(body);
    const responseLabel = res.status
      ? `${res.status} ${res.statusText || "응답"}`
      : "비정상 응답";

    throw new Error(
      summary
        ? `Bridge API가 JSON 대신 ${responseLabel} HTML을 반환했습니다 (${summary})`
        : `Bridge API가 JSON 대신 ${responseLabel} HTML을 반환했습니다`
    );
  }

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error(
      `Bridge API JSON 파싱에 실패했습니다 (${res.status} ${res.statusText || "응답"})`
    );
  }
}

function summarizeBridgeBody(body: string): string {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, 80);
}

/**
 * JWT 토큰 생성 (클라이언트→Bridge 직접 SSE 연결용)
 */
export function createBridgeToken(
  payload: Record<string, unknown>,
  expiresIn = "15m"
): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

/**
 * Bridge API URL (클라이언트에서 사용)
 */
export function getBridgeUrl(): string {
  return process.env.NEXT_PUBLIC_BRIDGE_URL || BRIDGE_URL;
}
