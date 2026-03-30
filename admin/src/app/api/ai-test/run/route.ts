import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST() {
  const token = createBridgeToken({ route: "ai-test-run" });
  const bridgeUrl = `${getBridgeUrl()}/ai-test/run`;
  return Response.json({ token, bridgeUrl });
}
