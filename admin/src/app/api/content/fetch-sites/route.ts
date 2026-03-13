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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string;
      slugs?: string[];
      domains?: string[];
    };

    if (body.action !== "delete-sites") {
      return Response.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }

    const res = await bridgeFetch("/credentials/delete-sites", {
      method: "POST",
      body: JSON.stringify({
        slugs: Array.isArray(body.slugs) ? body.slugs : [],
        domains: Array.isArray(body.domains) ? body.domains : [],
      }),
    });

    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: text || "사이트 삭제 실패" };
    }

    return Response.json(parsed, { status: res.status });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "사이트 삭제 요청 실패",
      },
      { status: 500 }
    );
  }
}
