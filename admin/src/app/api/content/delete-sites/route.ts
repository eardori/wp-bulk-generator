import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await bridgeFetch("/credentials/delete-sites", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const data = await parseBridgeJsonResponse(res);

    if (!res.ok) {
      return Response.json(data, { status: res.status });
    }

    return Response.json(data);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "사이트 삭제 요청에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
