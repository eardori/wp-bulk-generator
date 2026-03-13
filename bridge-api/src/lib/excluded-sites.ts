const EXCLUDED_SITE_SLUGS = new Set([
  "nutri-daily",
  "vitacheck-kr",
  "momvita",
  "fitfuel-lab",
  "healwell-note",
  "taste-trail",
]);

const EXCLUDED_SITE_DOMAINS = new Set([
  "nutri-daily.site",
  "vitacheck-kr.site",
  "momvita.site",
  "fitfuel-lab.site",
  "healwell-note.site",
  "taste-trail.allmyreview.site",
]);

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isExcludedSiteSlug(value: unknown): boolean {
  return EXCLUDED_SITE_SLUGS.has(normalizeText(value));
}

export function isExcludedSiteDomain(value: unknown): boolean {
  return EXCLUDED_SITE_DOMAINS.has(normalizeText(value));
}

export function isExcludedSiteRecord(item: Record<string, unknown>): boolean {
  return (
    isExcludedSiteSlug(item.slug ?? item.site_slug) ||
    isExcludedSiteDomain(item.domain)
  );
}
