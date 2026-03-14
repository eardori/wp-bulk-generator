import * as cheerio from "cheerio";

type BusinessSchemaInput = {
  title: string;
  excerpt?: string;
  contentHtml: string;
  url?: string;
  sourceName?: string;
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function collectTextLines(contentHtml: string): string[] {
  const $ = cheerio.load(contentHtml, null, false);
  const lines = new Set<string>();

  [".summary-box li", ".summary-box p", "li", "p", "dt", "dd", "figcaption"].forEach((selector) => {
    $(selector).each((_, element) => {
      const text = $(element).text().replace(/\s+/g, " ").trim();
      if (text) {
        lines.add(text);
      }
    });
  });

  return [...lines];
}

function extractLabeledValue(lines: string[], labels: string[]): string | undefined {
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`(?:^|\\s)${label}\\s*[:：-]?\\s*(.+)$`, "i");
      const match = line.match(pattern);
      if (!match?.[1]) continue;

      const value = match[1]
        .replace(/\s+/g, " ")
        .replace(/^[|/-]\s*/, "")
        .trim();

      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

function extractAddress(contentText: string, lines: string[]): string | undefined {
  const labeled = extractLabeledValue(lines, ["주소", "위치", "지번주소", "도로명주소"]);
  if (labeled) {
    return labeled;
  }

  const match = contentText.match(
    /((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{6,120})/
  );
  return match?.[1]?.trim();
}

function extractTelephone(contentText: string, lines: string[]): string | undefined {
  const labeled = extractLabeledValue(lines, ["전화", "전화번호", "문의"]);
  if (labeled) {
    const tel = labeled.match(/0\d{1,2}-\d{3,4}-\d{4}/);
    if (tel?.[0]) return tel[0];
  }

  return contentText.match(/0\d{1,2}-\d{3,4}-\d{4}/)?.[0];
}

function extractPriceRange(contentText: string): string | undefined {
  const priceMatches = Array.from(contentText.matchAll(/(\d{1,3}(?:,\d{3})*)\s*원/g))
    .map((match) => Number.parseInt(match[1].replace(/,/g, ""), 10))
    .filter((price) => Number.isFinite(price) && price > 0 && price < 10_000_000);

  if (priceMatches.length === 0) return undefined;

  const low = Math.min(...priceMatches);
  const high = Math.max(...priceMatches);
  return low === high ? `KRW ${low.toLocaleString("en-US")}` : `KRW ${low.toLocaleString("en-US")}-${high.toLocaleString("en-US")}`;
}

function extractAggregateRating(contentText: string): { ratingValue: string; reviewCount?: number } | undefined {
  const ratingMatch = contentText.match(/(\d(?:\.\d)?)\s*(?:점|\/\s*5)/);
  if (!ratingMatch?.[1]) return undefined;

  const reviewCountMatch = contentText.match(/(?:리뷰|후기)\s*(\d{1,4})\s*개/);
  const reviewCount = reviewCountMatch?.[1] ? Number.parseInt(reviewCountMatch[1], 10) : undefined;

  return {
    ratingValue: ratingMatch[1],
    ...(reviewCount ? { reviewCount } : {}),
  };
}

function inferCuisine(contentText: string): string | undefined {
  const lowered = contentText.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/(한식|갈비|국밥|삼겹살|불고기|백반)/i, "Korean"],
    [/(일식|스시|초밥|라멘|우동|오마카세)/i, "Japanese"],
    [/(중식|짜장|짬뽕|마라|딤섬)/i, "Chinese"],
    [/(양식|파스타|스테이크|리조또|브런치)/i, "Western"],
    [/(카페|커피|디저트|베이커리|케이크)/i, "Cafe"],
    [/(치킨|버거|피자|샌드위치)/i, "Fast Food"],
    [/(와인|바|주점|칵테일)/i, "Bar"],
  ];

  const found = map.find(([pattern]) => pattern.test(lowered));
  return found?.[1];
}

function inferBusinessName(title: string, sourceName?: string): string {
  if (sourceName?.trim()) {
    return sourceName.trim();
  }

  return title
    .replace(/\s*[-:|].*$/, "")
    .replace(/\s*(리뷰|후기|방문기|방문 후기|추천|가이드|총정리|솔직 후기|review).*$/i, "")
    .trim();
}

function looksLikeRestaurant(text: string): boolean {
  return /(맛집|식당|레스토랑|restaurant|카페|coffee|브런치|갈비|고기|한식|일식|중식|양식|베이커리|디저트|주점|와인|bar|펍|술집)/i.test(
    text
  );
}

export function stripReviewReferenceMarkers(html: string): string {
  return html
    .replace(/\[(?:리뷰|review)\s*#\s*\d+\]/gi, " ")
    .replace(/\((?:리뷰|review)\s*#\s*\d+\)/gi, " ")
    .replace(/[（(][^()（）]*#\s*\d+[^()（）]*[)）]/g, " ")
    .replace(/(?:^|\s)(?:리뷰|review)\s*#\s*\d+(?=[\s,.;:!?)\]])/gi, " ")
    .replace(/(?:,\s*)?#\s*\d+(?:\s*등)?/g, " ")
    .replace(/\s{2,}/g, " ");
}

export function buildBusinessSchemaFromHtml(
  input: BusinessSchemaInput
): Record<string, unknown> | null {
  const contentText = stripHtml(input.contentHtml);
  const lines = collectTextLines(input.contentHtml);
  const address = extractAddress(contentText, lines);
  const telephone = extractTelephone(contentText, lines);
  const hasPlaceSignals =
    !!address ||
    !!telephone ||
    /(주소|위치|전화|영업시간|찾아가는 길|편의시설|예약)/i.test(contentText);

  if (!hasPlaceSignals && !looksLikeRestaurant(`${input.title} ${contentText}`)) {
    return null;
  }

  const businessName = inferBusinessName(input.title, input.sourceName) || input.title;
  const imageUrl = cheerio.load(input.contentHtml, null, false)("img").first().attr("src");
  const aggregateRating = extractAggregateRating(contentText);
  const priceRange = extractPriceRange(contentText);
  const cuisine = inferCuisine(`${input.title} ${contentText}`);
  const isRestaurant = looksLikeRestaurant(`${businessName} ${contentText}`);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": isRestaurant ? "Restaurant" : "LocalBusiness",
    name: businessName,
    description: (input.excerpt || contentText).slice(0, 200),
    ...(input.url ? { url: input.url } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(telephone ? { telephone } : {}),
    ...(priceRange ? { priceRange } : {}),
  };

  if (address) {
    schema.address = {
      "@type": "PostalAddress",
      streetAddress: address,
      addressCountry: "KR",
    };
  }

  if (aggregateRating) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: aggregateRating.ratingValue,
      ...(aggregateRating.reviewCount ? { reviewCount: aggregateRating.reviewCount } : {}),
    };
  }

  if (isRestaurant && cuisine) {
    schema.servesCuisine = cuisine;
  }

  return schema;
}
