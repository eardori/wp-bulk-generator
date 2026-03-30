import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

export async function GET() {
  try {
    const res = await bridgeFetch("/ai-test/platforms", { method: "GET" });
    const data = await parseBridgeJsonResponse(res);
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "플랫폼 조회 실패" },
      { status: 500 }
    );
  }
}
