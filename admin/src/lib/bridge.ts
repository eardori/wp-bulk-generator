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
