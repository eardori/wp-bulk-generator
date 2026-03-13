import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

export async function GET() {
  try {
    const res = await bridgeFetch("/health");
    if (!res.ok) {
      const error =
        res.headers.get("content-type")?.toLowerCase().includes("application/json")
          ? ((await parseBridgeJsonResponse(res).catch(() => ({}))) as { error?: string })
              .error
          : "Bridge API 연결 실패";

      return Response.json(
        { connected: false, error: error || "Bridge API 연결 실패" },
        { status: 503 }
      );
    }
    return Response.json(await parseBridgeJsonResponse(res));
  } catch {
    return Response.json(
      { connected: false, error: "서버 연결 실패" },
      { status: 503 }
    );
  }
}
