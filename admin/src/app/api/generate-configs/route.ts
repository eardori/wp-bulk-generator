import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { niche } = body;

    if (!niche) {
      return Response.json({ error: "niche is required" }, { status: 400 });
    }

    const token = createBridgeToken({ route: "generate-configs" });
    const bridgeUrl = `${getBridgeUrl()}/generate-configs`;

    return Response.json({ token, bridgeUrl, body });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
