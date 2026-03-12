import { bridgeFetch } from "@/lib/bridge";

export async function GET() {
  try {
    const res = await bridgeFetch("/health");
    if (!res.ok) {
      return Response.json(
        { connected: false, error: "Bridge API 연결 실패" },
        { status: 503 }
      );
    }
    return Response.json(await res.json());
  } catch {
    return Response.json(
      { connected: false, error: "서버 연결 실패" },
      { status: 503 }
    );
  }
}
