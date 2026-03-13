import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const slugs = Array.isArray(body?.slugs) ? body.slugs : [];

    const token = createBridgeToken({ route: "repair-sites" });
    const bridgeUrl = `${getBridgeUrl()}/repair-sites`;

    return Response.json({ token, bridgeUrl, body: { slugs } });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
