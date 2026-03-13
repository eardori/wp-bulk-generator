import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { product, siteConfigs, contentPrompt } = body;

    if (!product) {
      return Response.json({ error: "product is required" }, { status: 400 });
    }
    if (!siteConfigs) {
      return Response.json({ error: "siteConfigs is required" }, { status: 400 });
    }
    if (!contentPrompt || typeof contentPrompt !== "string" || !contentPrompt.trim()) {
      return Response.json({ error: "contentPrompt is required" }, { status: 400 });
    }

    const token = createBridgeToken({ route: "generate-articles" });
    const bridgeUrl = `${getBridgeUrl()}/generate-articles`;

    return Response.json({ token, bridgeUrl, body });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
