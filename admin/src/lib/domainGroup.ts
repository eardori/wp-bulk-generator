export type DomainGroup = "myground.website" | "allmyreview.site" | "기타";

type SiteLike = { url?: string | null; domain?: string | null };

export function getDomainGroup(site: SiteLike): DomainGroup {
  const url = site.url || site.domain || "";
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (host.endsWith(".myground.website") || host === "myground.website") return "myground.website";
  if (host.endsWith(".allmyreview.site") || host === "allmyreview.site") return "allmyreview.site";
  return "기타";
}

export function getDomainGroupLabel(group: DomainGroup | string): string {
  return group;
}

type DomainGroupColor = {
  text: string;
  bg: string;
  border: string;
  activeBg: string;
  activeText: string;
  activeBorder: string;
};

export function getDomainGroupColor(group: DomainGroup): DomainGroupColor {
  if (group === "myground.website") {
    return {
      text: "text-purple-400",
      bg: "bg-purple-500/15",
      border: "border-purple-500/50",
      activeBg: "bg-purple-500",
      activeText: "text-white",
      activeBorder: "border-purple-500",
    };
  }
  if (group === "allmyreview.site") {
    return {
      text: "text-cyan-400",
      bg: "bg-cyan-500/15",
      border: "border-cyan-500/50",
      activeBg: "bg-cyan-500",
      activeText: "text-white",
      activeBorder: "border-cyan-500",
    };
  }
  return {
    text: "text-gray-300",
    bg: "bg-gray-500/15",
    border: "border-gray-500/50",
    activeBg: "bg-gray-500",
    activeText: "text-white",
    activeBorder: "border-gray-500",
  };
}
