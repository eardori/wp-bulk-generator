import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { configs } = body;

    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return Response.json({ error: "configs array is required" }, { status: 400 });
    }

    const token = createBridgeToken({ route: "deploy" });
    const bridgeUrl = `${getBridgeUrl()}/deploy`;

    return Response.json({ token, bridgeUrl, body });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
