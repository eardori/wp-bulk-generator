import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function GET() {
  const token = createBridgeToken({ route: "dashboard" });
  const bridgeUrl = `${getBridgeUrl()}/dashboard`;

  return Response.json({ token, bridgeUrl });
}
