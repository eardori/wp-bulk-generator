/**
 * 클라이언트 → Bridge 직접 SSE 연결 유틸리티
 *
 * 패턴:
 *   1. Vercel API에 POST → { token, bridgeUrl, body } 반환
 *   2. bridgeUrl에 POST (Bearer token) → SSE 스트리밍 응답
 */

type BridgeSSEInit = {
  /** Vercel API endpoint (e.g. "/api/content/generate-articles") */
  vercelEndpoint: string;
  /** 원본 요청 body */
  body: Record<string, unknown>;
  /** HTTP method for bridge (default: "POST") */
  method?: "GET" | "POST";
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
};

type BridgeSSEResult = {
  /** ReadableStream reader for SSE data */
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Response object */
  response: Response;
};

/**
 * Vercel API에서 JWT 토큰을 발급받고, Bridge API에 직접 SSE 연결
 */
export async function bridgeSSE({
  vercelEndpoint,
  body,
  method = "POST",
  signal,
}: BridgeSSEInit): Promise<BridgeSSEResult> {
  // Step 1: Vercel API에서 token + bridgeUrl 발급
  const tokenRes = await fetch(vercelEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Token 발급 실패 (${tokenRes.status})`);
  }

  const { token, bridgeUrl, body: bridgeBody } = await tokenRes.json();

  if (!token || !bridgeUrl) {
    throw new Error("Bridge 연결 정보가 없습니다.");
  }

  // Step 2: Bridge API에 직접 SSE 연결
  const bridgeOptions: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal,
  };

  if (method === "POST") {
    bridgeOptions.body = JSON.stringify(bridgeBody ?? body);
  }

  const response = await fetch(bridgeUrl, bridgeOptions);

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Bridge API 오류 (${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE 스트림을 사용할 수 없습니다.");
  }

  return { reader, response };
}

/**
 * SSE 스트림을 읽고 각 이벤트마다 콜백 호출
 */
export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (data: Record<string, unknown>) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "heartbeat") continue;
        onEvent(data);
      } catch {
        /* skip malformed chunk */
      }
    }
  }
}
