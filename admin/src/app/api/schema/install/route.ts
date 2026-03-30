import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

export async function POST(req: Request) {
  const body = await req.json();
  const token = createBridgeToken({ route: "schema-install" });
  const bridgeUrl = `${getBridgeUrl()}/schema/install`;
  return Response.json({ token, bridgeUrl, body });
}
