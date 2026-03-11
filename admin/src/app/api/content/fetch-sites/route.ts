import { bridgeFetch } from "@/lib/bridge";

export async function GET() {
  try {
    const res = await bridgeFetch("/credentials");
    if (!res.ok) {
      const err = await res.text();
      return Response.json(
        { error: err || "Bridge API 호출 실패", sites: [] },
        { status: res.status }
      );
    }
    const data = await res.json();
    return Response.json({ sites: data.sites ?? data });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "사이트 목록을 가져올 수 없습니다.",
        sites: [],
      },
      { status: 500 }
    );
  }
}
