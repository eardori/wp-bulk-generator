import { NextRequest } from "next/server";
import { execSync } from "child_process";
import * as cheerio from "cheerio";
import type { ScrapedProduct, ProductReview, ReviewApiParams } from "@/app/content/types";
import type { Browser, Page } from "playwright";

const CURL_FETCH_TIMEOUT_MS = 10000;
const PAGE_FETCH_TIMEOUT_MS = 12000;
const BROWSER_SCRAPE_TIMEOUT_MS = 25000;
const NAVER_PLACE_SCRAPE_TIMEOUT_MS = 45000;
const NAVER_PLACE_NAV_TIMEOUT_MS = 18000;
const NAVER_PLACE_SETTLE_MS = 1200;

const INVALID_TITLE_PATTERNS = [
  /\[에러\]/i,
  /시스템오류/i,
  /error page/i,
  /^access denied$/i,
];

let sharedBrowserPromise: Promise<Browser> | null = null;

export async function POST(req: NextRequest) {
  try {
    let { url } = await req.json();
    if (!url) {
      return Response.json({ error: "URL이 필요합니다." }, { status: 400 });
    }

    // Olive Young: use Playwright (Cloudflare blocks curl/fetch)
    if (url.includes("oliveyoung.co.kr")) {
      try {
        const product = await withTimeout(
          scrapeOliveYoungProduct(url),
          BROWSER_SCRAPE_TIMEOUT_MS,
          "올리브영 스크랩 시간이 초과되었습니다."
        );
        return Response.json({ product });
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

    // Naver Place / Map (맛집, 카페 etc)
    if (url.includes("map.naver.com") || url.includes("pcmap.place.naver.com")) {
      try {
        const product = await withTimeout(
          scrapeNaverPlace(url),
          NAVER_PLACE_SCRAPE_TIMEOUT_MS,
          "네이버 플레이스 스크랩 시간이 초과되었습니다."
        );
        return Response.json({ product });
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

    // Clean tracking params from Naver URLs
    const isNaver = url.includes("naver.com");
    if (isNaver) {
      try {
        const u = new URL(url);
        // Naver brand store doesn't need query params for product pages
        url = u.origin + u.pathname;
      } catch { /* keep original url */ }
    }

    let html: string;
    try {
      if (isNaver) {
        // Use curl for Naver - Node.js fetch gets 429 but curl works
        html = fetchWithCurl(url);
      } else {
        html = await fetchPage(url);
      }
    } catch (fetchErr) {
      // If fetch fails, fall back quickly instead of retrying the same strategy.
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

    // Fallback: fill gaps with OG/JSON-LD
    fillFromOpenGraph($, product);
    fillFromJsonLd($, product);

    if (!product.title) {
      product.title = $("title").text().trim() || "";
    }

    // If title is still empty or generic, suggest manual input
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

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function launchSharedBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchSharedBrowser().catch((error) => {
      sharedBrowserPromise = null;
      throw error;
    });
  }
  return sharedBrowserPromise;
}

async function warmupBrowser() {
  await getSharedBrowser();
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

  // Naver needs additional headers to not get 429
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
  // Extract __PRELOADED_STATE__ JSON from script tag
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

      // simpleProductForDetailPage has key product info
      const simple = state?.simpleProductForDetailPage?.A || {};
      // product.A has deeper product info with content
      const productA = state?.product?.A || {};
      // channel info
      const channelA = state?.channel?.A || {};
      // review summary
      const reviewSummary = state?.productReviewSummary?.A || {};

      // Extract review API params
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
        // Fallback: extract productNo from URL
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

      // Title: prefer simple, then product.A
      if (simple.name) title = simple.name;
      else if (productA.name) title = productA.name;

      // Price
      const salePrice = simple.salePrice || productA.salePrice;
      const discounted = simple.discountedSalePrice || productA.discountedSalePrice;
      if (discounted && discounted > 0) {
        price = `${discounted.toLocaleString()}원`;
      } else if (salePrice && salePrice > 0) {
        price = `${salePrice.toLocaleString()}원`;
      }

      // Brand from channel
      if (channelA.channelName) brand = channelA.channelName;
      if (!brand && simple.channel?.channelName) brand = simple.channel.channelName;

      // Seller tags = key selling points set by the seller
      const sellerTags: string[] = (simple.seoInfo?.sellerTags || [])
        .map((t: { text: string }) => t.text)
        .filter(Boolean);

      // Category path
      const categoryPath = simple.category?.wholeCategoryName || "";
      const categoryName = simple.category?.categoryName || "";

      // Build rich description from seller tags + category
      const descParts: string[] = [];
      if (categoryPath) descParts.push(`[카테고리] ${categoryPath}`);
      if (sellerTags.length > 0) descParts.push(`[핵심 키워드] ${sellerTags.join(", ")}`);

      // Description from product content (if loaded)
      if (productA.content) {
        const contentText = productA.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (contentText.length > 10) descParts.push(`[상세 설명] ${contentText.slice(0, 800)}`);
      }
      if (simple.seoInfo?.metaDescription && simple.seoInfo.metaDescription.length > 5) {
        descParts.push(`[SEO] ${simple.seoInfo.metaDescription}`);
      }

      description = descParts.join("\n");

      // Store seller tags as specs for AI to use
      if (sellerTags.length > 0) {
        specs["핵심키워드"] = sellerTags.join(", ");
      }
      if (categoryName) {
        specs["카테고리"] = categoryName;
      }
      if (categoryPath) {
        specs["카테고리경로"] = categoryPath;
      }

      // Images from product.A
      const prodImages = productA.productImages || [];
      for (const img of prodImages) {
        const imgUrl = img?.url || (typeof img === "string" ? img : "");
        if (imgUrl) images.push(imgUrl.startsWith("//") ? `https:${imgUrl}` : imgUrl);
      }

      // Review info
      const reviewInfo = reviewSummary?.productReviewInfo || {};
      if (reviewInfo.totalReviewCount) reviewCount = reviewInfo.totalReviewCount;
      if (reviewInfo.averageReviewScore) rating = parseFloat(reviewInfo.averageReviewScore);

      // Top reviews
      const bestReviews = reviewSummary?.bestReviews || [];
      for (const r of bestReviews.slice(0, 5)) {
        if (r.reviewContent) {
          reviews.push({ text: r.reviewContent.slice(0, 300), rating: r.reviewScore || 5 });
        }
      }

      // Product options as specs
      const selectedOpts = state?.selectedOptions?.A || {};
      const combOpts = selectedOpts.combinationOptions || [];
      if (combOpts.length > 0) {
        specs["옵션"] = combOpts.map((o: { optionName: string }) => o.optionName).filter(Boolean).join(", ");
      }
    } catch {
      /* JSON parse failed, fall through to OG tags */
    }
  }

  // Fallback from OG tags
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
    // Mobile selectors
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

async function scrapeOliveYoungProduct(url: string): Promise<ScrapedProduct> {
  // Extract goodsNo from URL
  let goodsNo = "";
  try {
    goodsNo = new URL(url).searchParams.get("goodsNo") || "";
  } catch { /* ignore */ }

  const reviewApiParams: ReviewApiParams | undefined = goodsNo
    ? { source: "oliveyoung", goodsNo, goodsUrl: url }
    : undefined;

  const browser = await getSharedBrowser();

  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  try {
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "ko-KR",
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9" },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await context.newPage();
    const mobileUrl = goodsNo
      ? `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${goodsNo}`
      : url.replace("www.oliveyoung.co.kr", "m.oliveyoung.co.kr").replace("/store/", "/m/");

    await page.goto(mobileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Wait for Cloudflare
    const title = await page.title();
    if (title.includes("moment") || title.includes("Cloudflare")) {
      try {
        await page.waitForFunction(
          () => !document.title.includes("moment") && !document.title.includes("Cloudflare"),
          { timeout: 20000 }
        );
      } catch { /* proceed anyway */ }
    }

    // Get product info from stats API (same-origin, no CORS issue)
    type StatsResult = { goodsName?: string; goodsImg?: string; reviewCount?: number; averageRating?: number } | null;
    const statsResult: StatsResult = goodsNo ? await page.evaluate(async (goodsNo: string) => {
      try {
        const res = await fetch(`/review/api/v2/reviews/${goodsNo}/stats`, {
          headers: { Accept: "application/json" },
        });
        const data = await res.json() as Record<string, unknown>;
        if (data.status !== "SUCCESS" || !data.data) return null;
        const d = data.data as Record<string, unknown>;
        const rating = d.ratingDistribution as Record<string, unknown> | undefined;
        return {
          goodsName: d.goodsName as string,
          goodsImg: d.goodsImg as string,
          reviewCount: d.reviewCount as number,
          averageRating: rating?.averageRating as number,
        };
      } catch { return null; }
    }, goodsNo) : null;

    // Extract product info from DOM as fallback
    const domTitle = await page.evaluate(() => {
      const el = document.querySelector(".prd_name, h1.prd_name, .goods_name, h2");
      return el?.textContent?.trim() || document.title.replace(" | 올리브영", "").trim();
    });

    const domImages = await page.evaluate(() => {
      const imgs: string[] = [];
      document.querySelectorAll(".swiper-slide img, .prd_thumbnail img, .thumb_area img").forEach(img => {
        const src = (img as HTMLImageElement).src || img.getAttribute("data-src") || "";
        if (src && !src.includes("data:") && src.startsWith("http")) imgs.push(src);
      });
      return imgs.slice(0, 5);
    });

    const domDesc = await page.evaluate(() => {
      const el = document.querySelector("meta[name='description'], meta[property='og:description']");
      return el?.getAttribute("content") || "";
    });

    const domPrice = await page.evaluate(() => {
      const el = document.querySelector(".price-2 strong, .price strong, .goods_price strong");
      return el?.textContent?.trim() || "";
    });

    const productName = statsResult?.goodsName || domTitle || "";
    const images: string[] = [];
    if (statsResult?.goodsImg) images.push(statsResult.goodsImg);
    domImages.forEach(img => { if (!images.includes(img)) images.push(img); });

    return {
      url,
      title: productName,
      description: domDesc,
      price: domPrice,
      images: images.slice(0, 5),
      specs: {},
      reviews: [],
      rating: statsResult?.averageRating ?? null,
      reviewCount: statsResult?.reviewCount ?? 0,
      brand: "올리브영",
      category: "",
      source: "oliveyoung",
      reviewApiParams,
    };
  } finally {
    await context?.close();
  }
}

async function scrapeNaverPlace(url: string): Promise<ScrapedProduct> {
  // Extract place ID from various Naver Map URL formats
  const placeIdMatch =
    url.match(/\/place\/(\d+)/) ||
    url.match(/\/restaurant\/(\d+)/) ||
    url.match(/\/cafe\/(\d+)/) ||
    url.match(/entry\/place\/(\d+)/);
  const placeId = placeIdMatch ? placeIdMatch[1] : "";
  if (!placeId) throw new Error("네이버 플레이스 ID를 찾을 수 없습니다.");

  const browser = await getSharedBrowser();

  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  try {
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "ko-KR",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9" },
    });
    const page = await context.newPage();

    await gotoNaverPlacePage(page, placeId, "home", [
      "h1",
      ".GHAhO",
      "text=주소",
      "text=영업시간",
    ]);

    // ── Extract place info from DOM ──────────────────────────────
    const placeData = await page.evaluate(() => {
      const getText = (selector: string) =>
        (document.querySelector(selector) as HTMLElement)?.innerText?.trim() || "";

      // Name
      const name = getText("h1") ||
        (document.querySelector(".GHAhO, .place_name_area h2") as HTMLElement)?.innerText?.trim() || "";

      // Category
      const category = getText(".lnJFt, span.lnJFt");

      // Images from pstatic CDN
      const images: string[] = [];
      document.querySelectorAll("img").forEach((el) => {
        const img = el as HTMLImageElement;
        const src = img.src || img.getAttribute("data-src") || "";
        if (src.includes("ldb-phinf") && images.length < 8) images.push(src);
      });

      // All text blocks from the briefing sections
      const briefingTexts: string[] = [];
      document.querySelectorAll(".GHAhO, .O8qbU, .zPfVt span, .RaQO4, .vV_z_, .place_section_content").forEach((el) => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt && txt.length > 5 && txt.length < 500 && briefingTexts.length < 20) {
          briefingTexts.push(txt);
        }
      });

      // Extract specific fields from briefing texts
      let address = "";
      let phone = "";
      let hours = "";
      let facilities = "";
      let directions = "";

      const fullText = document.body.innerText || "";

      // Address
      const addrMatch = fullText.match(
        /(서울|경기|부산|인천|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[^\n]+\d+/
      );
      if (addrMatch) address = addrMatch[0].trim().slice(0, 100);

      // Phone (0507- or 02- or 0\d{1,2}-)
      const phoneMatch = fullText.match(/(0507-\d{4}-\d{4}|0\d{1,2}-\d{3,4}-\d{4})/);
      if (phoneMatch) phone = phoneMatch[1];

      // Hours
      const hoursEl = document.querySelector(".A_cdD, [class*='bizHour'], [data-nclicks*='hour']") as HTMLElement;
      if (hoursEl) hours = hoursEl.innerText?.trim().slice(0, 200) || "";

      // Facilities (편의)
      const facilityEl = document.querySelector("[class*='편의'], .place_section_content .PN5R8") as HTMLElement;
      if (facilityEl) facilities = facilityEl.innerText?.trim().slice(0, 200) || "";

      // Directions from "찾아가는길"
      const dirMatch = fullText.match(/찾아가는길([^\n]+(?:\n[^\n]+){0,3})/);
      if (dirMatch) directions = dirMatch[1].trim().slice(0, 300);

      // AI Briefing sentences
      const aiBriefing: string[] = [];
      document.querySelectorAll(".zPfVt, .YH3Gk, .pui__vn15t2, .AiBriefing span").forEach((el) => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt && txt.length > 20 && aiBriefing.length < 10) aiBriefing.push(txt);
      });

      // Tags/keywords
      const tags: string[] = [];
      document.querySelectorAll(".Bd1dx button, .keyword_list button, [class*='keyword'] button").forEach((el) => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt && txt.length < 30 && tags.length < 15) tags.push(txt);
      });

      return { name, category, images, address, phone, hours, facilities, directions, aiBriefing, tags, briefingTexts };
    });

    let reviewItems: Array<{
      text: string;
      images: string[];
      reviewerName: string;
      date: string;
    }> = [];

    try {
      await gotoNaverPlacePage(page, placeId, "review/visitor", [
        ".pui__vn15t2",
        "text=방문자 리뷰",
        "text=펼쳐서 더보기",
      ]);

      // Click per-review "더보기" buttons to expand truncated individual reviews.
      const expandTruncated = async () => {
        try {
          await page.evaluate(() => {
            document.querySelectorAll(".pui__wFzIYl").forEach((el) => {
              (el as HTMLElement).click();
            });
          });
          await page.waitForTimeout(700);
        } catch {
          /* ignore */
        }
      };

      const getReviewCount = () =>
        page.evaluate(() => document.querySelectorAll(".pui__vn15t2").length);

      await expandTruncated();
      let lastReviewCount = await getReviewCount();

      const TARGET = 50;
      const MAX_CLICKS = 15;

      for (let i = 0; i < MAX_CLICKS; i++) {
        if (lastReviewCount >= TARGET) break;

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);

        const foldMoreBtn = page.locator("text=펼쳐서 더보기");
        const btnVisible = await foldMoreBtn.count().then((n) => n > 0).catch(() => false);
        if (!btnVisible) break;

        try {
          await foldMoreBtn.last().scrollIntoViewIfNeeded();
          await foldMoreBtn.last().click({ timeout: 3000 });
        } catch {
          break;
        }

        await page.waitForTimeout(1200);
        await expandTruncated();

        const newCount = await getReviewCount();
        if (newCount === lastReviewCount) break;
        lastReviewCount = newCount;
      }

      await expandTruncated();

      // Collect reviews with optional photo thumbnails.
      reviewItems = await page.evaluate(() => {
        const textSelectors = [".pui__vn15t2", ".YH3Gk", ".w2jxe", ".review_text"].join(", ");
        const results: Array<{
          text: string;
          images: string[];
          reviewerName: string;
          date: string;
        }> = [];
        const seenTexts = new Set<string>();

        const normalizeImageUrl = (src: string) => (src.startsWith("//") ? `https:${src}` : src);
        const unwrapSearchImage = (src: string) => {
          try {
            const parsed = new URL(src);
            const inner = parsed.searchParams.get("src");
            return inner ? decodeURIComponent(inner) : src;
          } catch {
            return src;
          }
        };
        const isReviewImage = (src: string) => {
          const lower = src.toLowerCase();
          const unwrapped = unwrapSearchImage(src).toLowerCase();
          const candidate = `${lower} ${unwrapped}`;

          if (!lower.startsWith("http")) return false;
          if (!/(pup-review-phinf|myplace-phinf|video_thumbnail|pup-review-vod)/i.test(candidate)) {
            return false;
          }
          if (/(emoji|contact\/|profile|icon|marker|phinf\.pstatic\.net\/contact)/i.test(candidate)) {
            return false;
          }
          return true;
        };

        const textNodes = Array.from(document.querySelectorAll(textSelectors));
        for (const node of textNodes) {
          const text = (node as HTMLElement).innerText?.trim() || "";
          if (text.length <= 15) continue;

          const dedupeKey = text.slice(0, 120);
          if (seenTexts.has(dedupeKey)) continue;
          seenTexts.add(dedupeKey);

          const card =
            node.closest("li") ||
            node.closest("[class*='review']") ||
            node.parentElement;

          const images: string[] = [];
          card?.querySelectorAll("img").forEach((imgEl) => {
            const img = imgEl as HTMLImageElement;
            const rawSrc = img.currentSrc || img.src || img.getAttribute("data-src") || "";
            const src = normalizeImageUrl(rawSrc);
            if (!isReviewImage(src)) return;
            if (images.includes(src)) return;
            if (images.length >= 4) return;
            images.push(src);
          });

          const reviewerName =
            (card?.querySelector("[class*='nick'], [class*='name'], strong, b") as HTMLElement)?.innerText?.trim() || "";
          const date =
            (card?.querySelector("time, [class*='date'], [class*='time']") as HTMLElement)?.innerText?.trim() || "";

          results.push({
            text: text.slice(0, 500),
            images,
            reviewerName,
            date,
          });

          if (results.length >= 50) break;
        }

        return results;
      });
    } catch (error) {
      console.warn(
        `[Naver Place] review scrape fallback for ${placeId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // ── Build ScrapedProduct ─────────────────────────────────────
    const reviews: ProductReview[] = reviewItems.map((item) => ({
      text: item.text,
      rating: 5,
      images: item.images.map((src) => ({ originalUrl: src, thumbnailUrl: src })),
      reviewerName: item.reviewerName,
      date: item.date,
    }));

    const specsObj: Record<string, string> = {};
    if (placeData.address) specsObj["주소"] = placeData.address;
    if (placeData.phone) specsObj["전화"] = placeData.phone;
    if (placeData.hours) specsObj["영업시간"] = placeData.hours;
    if (placeData.facilities) specsObj["편의시설"] = placeData.facilities;
    if (placeData.directions) specsObj["찾아가는길"] = placeData.directions;
    if (placeData.tags.length > 0) specsObj["키워드"] = placeData.tags.join(", ");
    if (placeData.category) specsObj["카테고리"] = placeData.category;

    const description = [
      placeData.aiBriefing.slice(0, 5).join(" "),
      ...placeData.briefingTexts.slice(0, 5),
    ].filter(Boolean).join("\n").slice(0, 1000);

    return {
      url,
      title: placeData.name || "맛집",
      description,
      price: "",
      images: placeData.images.slice(0, 6),
      specs: specsObj,
      reviews,
      rating: null,
      reviewCount: reviews.length,
      brand: placeData.category || "음식점",
      category: placeData.category || "맛집",
      source: "naver-place",
    };
  } finally {
    await context?.close();
  }
}

async function gotoNaverPlacePage(
  page: Page,
  placeId: string,
  path: "home" | "review/visitor",
  expectedLocators: string[]
): Promise<void> {
  const candidates = [
    `https://pcmap.place.naver.com/restaurant/${placeId}/${path}`,
    `https://pcmap.place.naver.com/place/${placeId}/${path}`,
  ];

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      await page.goto(candidate, {
        waitUntil: "domcontentloaded",
        timeout: NAVER_PLACE_NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(NAVER_PLACE_SETTLE_MS);

      if (await pageHasAnyLocator(page, expectedLocators)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`네이버 플레이스 ${path} 페이지를 불러오지 못했습니다.`);
}

async function pageHasAnyLocator(page: Page, locators: string[]): Promise<boolean> {
  for (const locator of locators) {
    try {
      if ((await page.locator(locator).count()) > 0) {
        return true;
      }
    } catch {
      /* ignore invalid selector states */
    }
  }

  try {
    const bodyLength = await page.evaluate(() => (document.body.innerText || "").length);
    return bodyLength > 300;
  } catch {
    return false;
  }
}

// Legacy fallback parser kept for future non-Playwright regression fallback.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseOliveYoung(
  $: cheerio.CheerioAPI,
  url: string
): ScrapedProduct {
  const title = $(".prd_name").text().trim() || $("h2.prd_name").text().trim();
  const price = $(".price-2 strong").text().trim() || $(".price strong").text().trim();
  const description = $(".prd_detail_box").text().trim().slice(0, 1000);
  const brand = $(".prd_brand_name a").text().trim() || $(".prd_brand").text().trim();

  const images: string[] = [];
  $(".prd_thumbnail img, .swiper-slide img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (src) images.push(src.startsWith("//") ? `https:${src}` : src);
  });

  const specs: Record<string, string> = {};
  $(".prd_detail_info li, .detail_info_list li").each((_, el) => {
    const text = $(el).text().trim();
    const [key, ...vals] = text.split(":");
    if (key && vals.length) specs[key.trim()] = vals.join(":").trim();
  });

  const reviews: ProductReview[] = [];
  $(".review_list_wrap .inner_review, .review_cont").each((_, el) => {
    if (reviews.length >= 10) return;
    const text = $(el).find(".review_cont, .txt_inner").text().trim();
    if (text) reviews.push({ text: text.slice(0, 300), rating: 5 });
  });

  // Extract goodsNo for review API
  let reviewApiParams: import("@/app/content/types").ReviewApiParams | undefined;
  try {
    const parsed = new URL(url);
    const goodsNo = parsed.searchParams.get("goodsNo");
    if (goodsNo) {
      reviewApiParams = { source: "oliveyoung", goodsNo, goodsUrl: url };
    }
  } catch { /* ignore */ }

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
    source: "oliveyoung",
    reviewApiParams,
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
