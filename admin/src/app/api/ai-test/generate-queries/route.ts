import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

export async function POST(req: Request) {
  const body = await req.json();

  try {
    const res = await bridgeFetch("/ai-test/generate-queries", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const data = await parseBridgeJsonResponse(res);
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "쿼리 생성 실패" },
      { status: 500 }
    );
  }
}
