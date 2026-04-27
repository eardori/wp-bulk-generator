import { bridgeFetch } from "@/lib/bridge";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.text();
  const res = await bridgeFetch("/deploy/fix-robots-https", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body || "{}",
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
