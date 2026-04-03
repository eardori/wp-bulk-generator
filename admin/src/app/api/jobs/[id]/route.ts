import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await bridgeFetch(`/jobs/${id}`, {
    method: "GET",
    cache: "no-store",
  });

  const data = await parseBridgeJsonResponse(res);
  return Response.json(data, { status: res.status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = (body as { action?: string }).action || "cancel";

  const path = action === "retry" ? `/jobs/${id}/retry` : `/jobs/${id}/cancel`;

  const res = await bridgeFetch(path, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const data = await parseBridgeJsonResponse(res);
  return Response.json(data, { status: res.status });
}
