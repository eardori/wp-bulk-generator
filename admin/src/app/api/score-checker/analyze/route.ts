import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST() {
  const token = createBridgeToken({ route: "score-checker-analyze" });
  const bridgeUrl = `${getBridgeUrl()}/score-checker/analyze`;
  return Response.json({ token, bridgeUrl });
}
