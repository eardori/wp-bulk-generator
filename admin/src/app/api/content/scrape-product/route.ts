import { NextRequest } from "next/server";
import { execSync } from "child_process";
import * as cheerio from "cheerio";
import type { ScrapedProduct, ProductReview, ReviewApiParams } from "@/app/content/types";
import { bridgeFetch, parseBridgeJsonResponse } from "@/lib/bridge";

const CURL_FETCH_TIMEOUT_MS = 10000;
const PAGE_FETCH_TIMEOUT_MS = 12000;

const INVALID_TITLE_PATTERNS = [
  /\[에러\]/i,
  /시스템오류/i,
  /error page/i,
  /^access denied$/i,
];

export async function POST(req: NextRequest) {
  try {
    let { url } = await req.json();
    if (!url) {
      return Response.json({ error: "URL이 필요합니다." }, { status: 400 });
    }

    // Olive Young: delegate to bridge (Playwright required)
    if (url.includes("oliveyoung.co.kr")) {
      try {
        const res = await bridgeFetch("/scrape/oliveyoung", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        return Response.json(await parseBridgeJsonResponse(res), { status: res.status });
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : "올리브영 스크랩 실패",
            needManual: true,
          },
          { status: 200 }
        );
      }
    }

    // Naver Place / Map: delegate to bridge (Playwright required)
    if (url.includes("map.naver.com") || url.includes("pcmap.place.naver.com")) {
      try {
        const res = await bridgeFetch("/scrape/naver-place", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        return Response.json(await parseBridgeJsonResponse(res), { status: res.status });
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : "네이버 플레이스 스크랩 실패",
            needManual: true,
          },
          { status: 200 }
        );
      }
    }

    // ── Cheerio-based scraping (runs on Vercel) ──────────────────

    // Clean tracking params from Naver URLs
    const isNaver = url.includes("naver.com");
    if (isNaver) {
      try {
        const u = new URL(url);
        url = u.origin + u.pathname;
      } catch { /* keep original url */ }
    }

    let html: string;
    try {
      if (isNaver) {
        html = fetchWithCurl(url);
      } else {
        html = await fetchPage(url);
      }
    } catch (fetchErr) {
      try {
        html = isNaver ? await fetchPageMobile(url) : fetchWithCurl(url);
      } catch {
        try {
          html = isNaver ? await fetchPage(url) : await fetchPageMobile(url);
        } catch {
          return Response.json(
            {
              error: `페이지를 불러올 수 없습니다 (${fetchErr instanceof Error ? fetchErr.message : "차단됨"}). 수동 입력을 이용해주세요.`,
              needManual: true,
            },
            { status: 200 }
          );
        }
      }
    }

    const $ = cheerio.load(html);
    let product: ScrapedProduct;

    if (url.includes("brand.naver.com") || url.includes("smartstore.naver.com")) {
      product = parseNaverStore($, url, html);
    } else if (url.includes("coupang.com")) {
      product = parseCoupang($, url);
    } else if (url.includes("11st.co.kr")) {
      product = parse11st($, url);
    } else if (url.includes("iherb.com")) {
      product = parseIHerb($, url);
    } else {
      product = parseGeneric($, url);
    }

    fillFromOpenGraph($, product);
    fillFromJsonLd($, product);

    if (!product.title) {
      product.title = $("title").text().trim() || "";
    }

    if (!product.title || product.title.length < 3 || isInvalidScrapeTitle(product.title)) {
      return Response.json(
        {
          error: "상품 정보를 충분히 추출하지 못했습니다. 수동 입력을 이용해주세요.",
          needManual: true,
          partialProduct: product,
        },
        { status: 200 }
      );
    }

    return Response.json({ product });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "스크랩 실패",
        needManual: true,
      },
      { status: 200 }
    );
  }
}

function isInvalidScrapeTitle(title: string): boolean {
  return INVALID_TITLE_PATTERNS.some((pattern) => pattern.test(title.trim()));
}

function fetchWithCurl(url: string): string {
  const escapedUrl = url.replace(/'/g, "'\\''");
  const maxTimeSeconds = Math.ceil(CURL_FETCH_TIMEOUT_MS / 1000);
  const cmd = `curl -s -L --max-time ${maxTimeSeconds} -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" -H "Referer: https://search.naver.com/" -H "Accept-Language: ko-KR,ko;q=0.9" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" '${escapedUrl}'`;
  const result = execSync(cmd, {
    encoding: "utf8",
    timeout: CURL_FETCH_TIMEOUT_MS + 2000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (!result || result.length < 100) throw new Error("Empty response from curl");
  return result;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "max-age=0",
      Connection: "keep-alive",
      "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      Referer: new URL(url).origin + "/",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchPageMobile(url: string): Promise<string> {
  let mobileUrl = url;
  if (url.includes("coupang.com") && !url.includes("m.coupang.com")) {
    mobileUrl = url.replace("www.coupang.com", "m.coupang.com");
  }

  const isNaver = url.includes("naver.com");
  const referer = isNaver
    ? "https://search.naver.com/"
    : new URL(mobileUrl).origin + "/";

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    Referer: referer,
    Connection: "keep-alive",
  };

  if (isNaver) {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "cross-site";
    headers["Sec-Fetch-User"] = "?1";
    headers["Upgrade-Insecure-Requests"] = "1";
  }

  const res = await fetch(mobileUrl, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseNaverStore(
  $: cheerio.CheerioAPI,
  url: string,
  rawHtml: string
): ScrapedProduct {
  const stateMatch = rawHtml.match(/window\.__PRELOADED_STATE__\s*=\s*({[\s\S]+?})\s*<\/script>/);

  let title = $("title").text().trim();
  let price = "";
  let description = "";
  let brand = "";
  const images: string[] = [];
  const specs: Record<string, string> = {};
  const reviews: ProductReview[] = [];
  let rating: number | null = null;
  let reviewCount = 0;
  let reviewApiParams: ReviewApiParams | undefined;

  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const simple = state?.simpleProductForDetailPage?.A || {};
      const productA = state?.product?.A || {};
      const channelA = state?.channel?.A || {};
      const reviewSummary = state?.productReviewSummary?.A || {};

      const merchantNo = channelA.channelNo || simple.channel?.channelNo;
      const originProductNo = simple.id;
      const channelNo = channelA.channelNo;

      if (merchantNo && originProductNo) {
        reviewApiParams = {
          source: "naver",
          merchantNo: String(merchantNo),
          originProductNo: String(originProductNo),
          channelNo: channelNo ? String(channelNo) : undefined,
        };
      } else {
        const productNoMatch = url.match(/\/products\/(\d+)/);
        if (productNoMatch && merchantNo) {
          reviewApiParams = {
            source: "naver",
            merchantNo: String(merchantNo),
            originProductNo: productNoMatch[1],
            channelNo: channelNo ? String(channelNo) : undefined,
          };
        }
      }

      if (simple.name) title = simple.name;
      else if (productA.name) title = productA.name;

      const salePrice = simple.salePrice || productA.salePrice;
      const discounted = simple.discountedSalePrice || productA.discountedSalePrice;
      if (discounted && discounted > 0) {
        price = `${discounted.toLocaleString()}원`;
      } else if (salePrice && salePrice > 0) {
        price = `${salePrice.toLocaleString()}원`;
      }

      if (channelA.channelName) brand = channelA.channelName;
      if (!brand && simple.channel?.channelName) brand = simple.channel.channelName;

      const sellerTags: string[] = (simple.seoInfo?.sellerTags || [])
        .map((t: { text: string }) => t.text)
        .filter(Boolean);
      const categoryPath = simple.category?.wholeCategoryName || "";
      const categoryName = simple.category?.categoryName || "";

      const descParts: string[] = [];
      if (categoryPath) descParts.push(`[카테고리] ${categoryPath}`);
      if (sellerTags.length > 0) descParts.push(`[핵심 키워드] ${sellerTags.join(", ")}`);
      if (productA.content) {
        const contentText = productA.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (contentText.length > 10) descParts.push(`[상세 설명] ${contentText.slice(0, 800)}`);
      }
      if (simple.seoInfo?.metaDescription && simple.seoInfo.metaDescription.length > 5) {
        descParts.push(`[SEO] ${simple.seoInfo.metaDescription}`);
      }
      description = descParts.join("\n");

      if (sellerTags.length > 0) specs["핵심키워드"] = sellerTags.join(", ");
      if (categoryName) specs["카테고리"] = categoryName;
      if (categoryPath) specs["카테고리경로"] = categoryPath;

      const prodImages = productA.productImages || [];
      for (const img of prodImages) {
        const imgUrl = img?.url || (typeof img === "string" ? img : "");
        if (imgUrl) images.push(imgUrl.startsWith("//") ? `https:${imgUrl}` : imgUrl);
      }

      const reviewInfo = reviewSummary?.productReviewInfo || {};
      if (reviewInfo.totalReviewCount) reviewCount = reviewInfo.totalReviewCount;
      if (reviewInfo.averageReviewScore) rating = parseFloat(reviewInfo.averageReviewScore);

      const bestReviews = reviewSummary?.bestReviews || [];
      for (const r of bestReviews.slice(0, 5)) {
        if (r.reviewContent) {
          reviews.push({ text: r.reviewContent.slice(0, 300), rating: r.reviewScore || 5 });
        }
      }

      const selectedOpts = state?.selectedOptions?.A || {};
      const combOpts = selectedOpts.combinationOptions || [];
      if (combOpts.length > 0) {
        specs["옵션"] = combOpts.map((o: { optionName: string }) => o.optionName).filter(Boolean).join(", ");
      }
    } catch {
      /* JSON parse failed, fall through to OG tags */
    }
  }

  if (!title) title = $('meta[property="og:title"]').attr("content") || "";
  if (!description) description = $('meta[property="og:description"]').attr("content") || "";
  if (images.length === 0) {
    const ogImg = $('meta[property="og:image"]').attr("content");
    if (ogImg) images.push(ogImg);
  }

  return {
    url,
    title,
    description,
    price,
    images: images.slice(0, 5),
    specs,
    reviews,
    rating,
    reviewCount,
    brand,
    category: "",
    source: url.includes("brand.naver.com") ? "naver-brand" : "naver-smartstore",
    reviewApiParams,
  };
}

function parseCoupang(
  $: cheerio.CheerioAPI,
  url: string
): ScrapedProduct {
  const title =
    $(".prod-buy-header__title").text().trim() ||
    $("h1.prod-title").text().trim() ||
    $("h2.prod-title").text().trim() ||
    $(".prod-title-text").text().trim() ||
    $("[class*='ProductTitle']").text().trim();

  const price =
    $(".total-price strong").text().trim() ||
    $(".prod-sale-price .total-price").text().trim() ||
    $(".prod-price__price").text().trim() ||
    $("[class*='price'] strong").first().text().trim();

  const description =
    $(".prod-description").text().trim() ||
    $(".product-detail-content-inside").text().trim().slice(0, 1000) ||
    $("[class*='detail']").first().text().trim().slice(0, 1000);

  const images: string[] = [];
  $(".prod-image__item img, .prod-image img, .gallery__image img, [class*='ProductImage'] img").each(
    (_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-img-src") || $(el).attr("data-src");
      if (src) images.push(src.startsWith("//") ? `https:${src}` : src);
    }
  );

  const brand = $(".prod-brand-name a").text().trim() || $(".brand-name").text().trim();

  const specs: Record<string, string> = {};
  $(".prod-attr-item, .prod-description-attribute li").each((_, el) => {
    const key = $(el).find("dt, .title").text().trim();
    const val = $(el).find("dd, .desc").text().trim();
    if (key && val) specs[key] = val;
  });

  const reviews: ProductReview[] = [];
  $(".sdp-review__article__list__review").each((_, el) => {
    if (reviews.length >= 10) return;
    const text = $(el).find(".sdp-review__article__list__review__content").text().trim();
    const ratingText = $(el).find(".sdp-review__article__list__info__product-rating__count").text().trim();
    if (text) reviews.push({ text: text.slice(0, 300), rating: parseInt(ratingText) || 5 });
  });

  const ratingText = $(".rating-star-num, .prod-rating__number").text().trim();
  const rating = parseFloat(ratingText) || null;
  const reviewCountText = $(".count, .prod-rating__count").text().trim();
  const reviewCount = parseInt(reviewCountText.replace(/[^0-9]/g, "")) || 0;

  return {
    url,
    title,
    description,
    price,
    images: images.slice(0, 5),
    specs,
    reviews,
    rating,
    reviewCount,
    brand,
    category: "",
    source: "coupang",
  };
}

function parse11st(
  $: cheerio.CheerioAPI,
  url: string
): ScrapedProduct {
  const title = $(".heading_product h1, #productName").text().trim();
  const price = $(".price_detail .value, .sale_price .value").text().trim();
  const description = $(".product_info, .product_detail").text().trim().slice(0, 1000);
  const brand = $(".brand a, .brand_name").text().trim();

  const images: string[] = [];
  $(".img_full img, .product_image img, .thumb_list img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (src) images.push(src.startsWith("//") ? `https:${src}` : src);
  });

  return {
    url,
    title,
    description,
    price,
    images: images.slice(0, 5),
    specs: {},
    reviews: [],
    rating: null,
    reviewCount: 0,
    brand,
    category: "",
    source: "11st",
  };
}

function parseIHerb(
  $: cheerio.CheerioAPI,
  url: string
): ScrapedProduct {
  const title = $("h1[itemprop='name'], #name").text().trim();
  const price = $("[itemprop='price'], #price").text().trim();
  const description = $("[itemprop='description'], .product-overview").text().trim().slice(0, 1000);
  const brand = $("[itemprop='brand'] span, .brand-name").text().trim();

  const images: string[] = [];
  $("[itemprop='image'], .product-image img, #iherb-product-image img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("content");
    if (src) images.push(src.startsWith("//") ? `https:${src}` : src);
  });

  const specs: Record<string, string> = {};
  $(".supplement-facts tr, .product-detail-table tr").each((_, el) => {
    const cells = $(el).find("td");
    if (cells.length >= 2) {
      specs[$(cells[0]).text().trim()] = $(cells[1]).text().trim();
    }
  });

  const reviews: ProductReview[] = [];
  $(".review-text, [itemprop='reviewBody']").each((_, el) => {
    if (reviews.length >= 10) return;
    const text = $(el).text().trim();
    if (text) reviews.push({ text: text.slice(0, 300), rating: 5 });
  });

  return {
    url,
    title,
    description,
    price,
    images: images.slice(0, 5),
    specs,
    reviews,
    rating: null,
    reviewCount: reviews.length,
    brand,
    category: "",
    source: "iherb",
  };
}

function parseGeneric(
  $: cheerio.CheerioAPI,
  url: string
): ScrapedProduct {
  const title = $("h1").first().text().trim() || $("h2").first().text().trim();

  const priceSelectors = [
    "[class*='price']",
    "[class*='Price']",
    "[itemprop='price']",
    ".price",
  ];
  let price = "";
  for (const sel of priceSelectors) {
    price = $(sel).first().text().trim();
    if (price) break;
  }

  const description =
    $("[itemprop='description']").text().trim() ||
    $("meta[name='description']").attr("content") ||
    $("p").first().text().trim().slice(0, 500);

  const images: string[] = [];
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (
      src &&
      !src.includes("logo") &&
      !src.includes("icon") &&
      !src.includes("svg") &&
      (src.includes("product") ||
        src.includes("item") ||
        src.includes("img") ||
        $(el).closest("[class*='product'], [class*='gallery'], main, article").length > 0)
    ) {
      images.push(src.startsWith("//") ? `https:${src}` : src);
    }
  });

  const brand = $("[itemprop='brand']").text().trim() || $(".brand").text().trim();

  return {
    url,
    title,
    description,
    price,
    images: images.slice(0, 5),
    specs: {},
    reviews: [],
    rating: null,
    reviewCount: 0,
    brand,
    category: "",
    source: new URL(url).hostname,
  };
}

function fillFromOpenGraph($: cheerio.CheerioAPI, product: ScrapedProduct) {
  if (!product.title) {
    product.title = $('meta[property="og:title"]').attr("content") || "";
  }
  if (!product.description) {
    product.description = $('meta[property="og:description"]').attr("content") || "";
  }
  if (product.images.length === 0) {
    const ogImg = $('meta[property="og:image"]').attr("content");
    if (ogImg) product.images.push(ogImg);
  }
}

function fillFromJsonLd($: cheerio.CheerioAPI, product: ScrapedProduct) {
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Product" || item["@type"]?.includes("Product")) {
          if (!product.title && item.name) product.title = item.name;
          if (!product.description && item.description)
            product.description = item.description.slice(0, 1000);
          if (!product.brand && item.brand?.name) product.brand = item.brand.name;
          if (!product.price && item.offers?.price)
            product.price = `${item.offers.price}${item.offers.priceCurrency || ""}`;
          if (item.image) {
            const imgs = Array.isArray(item.image) ? item.image : [item.image];
            for (const img of imgs) {
              const imgUrl = typeof img === "string" ? img : img?.url;
              if (imgUrl && !product.images.includes(imgUrl)) {
                product.images.push(imgUrl);
              }
            }
          }
          if (item.aggregateRating) {
            product.rating = parseFloat(item.aggregateRating.ratingValue) || null;
            product.reviewCount = parseInt(item.aggregateRating.reviewCount) || 0;
          }
          if (item.review && Array.isArray(item.review)) {
            for (const r of item.review.slice(0, 10)) {
              product.reviews.push({
                text: (r.reviewBody || r.description || "").slice(0, 300),
                rating: parseInt(r.reviewRating?.ratingValue) || 5,
              });
            }
          }
        }
      }
    } catch {
      /* skip invalid JSON-LD */
    }
  });
}
