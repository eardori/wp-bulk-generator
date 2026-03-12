import { createBridgeToken, getBridgeUrl } from "@/lib/bridge";

function handleDashboard() {
  const token = createBridgeToken({ route: "dashboard" });
  const bridgeUrl = `${getBridgeUrl()}/dashboard`;

  return Response.json({ token, bridgeUrl });
}

export async function GET() {
  return handleDashboard();
}

export async function POST() {
  return handleDashboard();
}
