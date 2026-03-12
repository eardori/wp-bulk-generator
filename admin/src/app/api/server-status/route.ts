import { bridgeFetch } from "@/lib/bridge";

export async function GET() {
  try {
    const res = await bridgeFetch("/health");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return Response.json(
        {
          connected: false,
          error: "Bridge API 연결 실패",
          status: res.status,
          body,
          url: process.env.BRIDGE_API_URL ? "set" : "empty",
          key: process.env.BRIDGE_API_KEY ? "set" : "empty",
        },
        { status: 503 }
      );
    }
    return Response.json(await res.json());
  } catch (err) {
    return Response.json(
      {
        connected: false,
        error: err instanceof Error ? err.message : "서버 연결 실패",
        url: process.env.BRIDGE_API_URL ? "set" : "empty",
        key: process.env.BRIDGE_API_KEY ? "set" : "empty",
      },
      { status: 503 }
    );
  }
}
