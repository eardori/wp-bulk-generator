import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "";
  const limit = request.nextUrl.searchParams.get("limit") || "50";

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("limit", limit);

  const res = await bridgeFetch(`/jobs?${qs.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  const data = await parseBridgeJsonResponse(res);
  return Response.json(data);
}
