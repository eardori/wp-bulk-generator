import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { articles, sites } = body;

    if (!articles) {
      return Response.json({ error: "articles is required" }, { status: 400 });
    }
    if (!sites) {
      return Response.json({ error: "sites is required" }, { status: 400 });
    }

    const token = createBridgeToken({ route: "publish-articles" });
    const bridgeUrl = `${getBridgeUrl()}/publish-articles`;

    return Response.json({ token, bridgeUrl, body });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
