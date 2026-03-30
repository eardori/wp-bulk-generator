/**
 * Schema API 클라이언트 유틸리티
 * Admin Frontend → Vercel API → Bridge API 통신
 */

import { bridgeSSE, readSSEStream } from "./bridge-sse";

// ── Types ────────────────────────────────────────────────────────────────────

export type ExtractedBusinessInfo = {
  businessName: string;
  businessType: string;
  address: string;
  phone: string;
  website: string;
  description: string;
  openingHours: Array<{ days: string; hours: string }>;
  menuItems: Array<{ name: string; price: string }>;
  services: string[];
  faq: Array<{ question: string; answer: string }>;
  priceRange: string;
  images: string[];
};

export type ExtractResult = {
  success: boolean;
  data?: ExtractedBusinessInfo;
  source?: "ai" | "fallback";
  error?: string;
};

export type SiteSchemaStatus = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  hasSchema: boolean;
  schemaTypes: string[];
  hasLocalBusiness: boolean;
  error?: string;
};

// ── Extract business info from URL ───────────────────────────────────────────

export async function extractSchemaFromUrl(
  url: string
): Promise<ExtractResult> {
  const res = await fetch("/api/schema/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `추출 실패 (${res.status})`
    );
  }

  return res.json();
}

// ── Check schema status for all sites (SSE) ──────────────────────────────────

export async function checkSchemaStatus(
  onEvent: (data: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  const { reader } = await bridgeSSE({
    vercelEndpoint: "/api/schema/status",
    body: {},
    method: "GET",
    signal,
  });

  await readSSEStream(reader, onEvent);
}

// ── Install schema to WP sites (SSE) ────────────────────────────────────────

export async function installSchema(
  sites: string[],
  schemaJson: string,
  onEvent: (data: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  const { reader } = await bridgeSSE({
    vercelEndpoint: "/api/schema/install",
    body: { sites, schemaJson },
    signal,
  });

  await readSSEStream(reader, onEvent);
}
