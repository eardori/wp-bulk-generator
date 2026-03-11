import { NextRequest } from "next/server";
import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reviewApiParams } = body;

    if (!reviewApiParams) {
      return Response.json({ error: "reviewApiParams is required" }, { status: 400 });
    }

    const source = reviewApiParams.source || "oliveyoung";
    const token = createBridgeToken({ route: "reviews" });
    const bridgeUrl = `${getBridgeUrl()}/reviews/${source}`;

    return Response.json({ token, bridgeUrl, body });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
