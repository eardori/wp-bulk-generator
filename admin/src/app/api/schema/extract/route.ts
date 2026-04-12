import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

export async function POST(req: Request) {
  const body = await req.json();
  const { url } = body as { url: string };

  if (!url) {
    return Response.json({ error: "URL이 필요합니다." }, { status: 400 });
  }

  // Forward to Bridge API (non-SSE, standard JSON response)
  try {
    const res = await bridgeFetch("/schema/extract", {
      method: "POST",
      body: JSON.stringify({ url }),
    });

    const data = await parseBridgeJsonResponse(res);
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "추출 실패" },
      { status: 500 }
    );
  }
}
