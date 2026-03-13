import { bridgeFetch } from "@/lib/bridge";

function normalizeGroups(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as { groups?: unknown[] }).groups)
  ) {
    return (input as { groups: unknown[] }).groups;
  }
  return [];
}

export async function GET() {
  try {
    const res = await bridgeFetch("/groups");
    if (!res.ok) {
      return Response.json(
        { error: "Bridge API 호출 실패", groups: [] },
        { status: res.status }
      );
    }
    const data = await res.json();
    return Response.json({ groups: normalizeGroups((data as { groups?: unknown }).groups ?? data) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "그룹 목록 조회 실패", groups: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body?.action === "delete-sites") {
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
    }

    const res = await bridgeFetch("/groups", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return Response.json(
        { error: (err as { error?: string }).error || "그룹 저장 실패" },
        { status: res.status }
      );
    }
    return Response.json(await res.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "그룹 저장 실패" },
      { status: 500 }
    );
  }
}
