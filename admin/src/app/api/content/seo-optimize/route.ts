import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sites } = body;

    if (!sites) {
      return Response.json({ error: "sites is required" }, { status: 400 });
    }

    const token = createBridgeToken({ route: "seo-optimize" });
    const bridgeUrl = `${getBridgeUrl()}/seo-optimize`;

    return Response.json({ token, bridgeUrl, body });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
