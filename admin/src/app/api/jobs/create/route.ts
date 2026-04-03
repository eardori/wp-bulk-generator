import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

export async function POST(request: Request) {
  const body = await request.json();

  const res = await bridgeFetch("/jobs/content", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = await parseBridgeJsonResponse(res);
  return Response.json(data, { status: res.status });
}
