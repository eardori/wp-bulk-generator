import { bridgeFetch } from "@/lib/bridge";

export async function POST() {
  const res = await bridgeFetch("/deploy/proxy-sync", { method: "POST" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "text/plain" },
  });
}
