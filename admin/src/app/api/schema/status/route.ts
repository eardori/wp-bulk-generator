import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function GET() {
  const token = createBridgeToken({ route: "schema-status" });
  const bridgeUrl = `${getBridgeUrl()}/schema/status`;
  return Response.json({ token, bridgeUrl });
}

export async function POST() {
  const token = createBridgeToken({ route: "schema-status" });
  const bridgeUrl = `${getBridgeUrl()}/schema/status`;
  return Response.json({ token, bridgeUrl });
}
