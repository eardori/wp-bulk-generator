import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright";
import type { ScrapedProduct, ProductReview, ReviewApiParams } from "../types.js";
import { getBrowser } from "../utils/browser.js";

const NAVER_PLACE_NAV_TIMEOUT_MS = 18000;
const NAVER_PLACE_SETTLE_MS = 1200;
const NAVER_PLACE_TARGET_REVIEW_COUNT = 50;
const NAVER_PLACE_REVIEW_LOAD_TIMEOUT_MS = 5000;
const NAVER_PLACE_REVIEW_LOAD_MORE_MAX_CLICKS = 10;

type NaverPlaceReviewItem = {
  text: string;
  images: string[];
  reviewerName: string;
  date: string;
};

type NaverPlaceMenuItem = {
  name: string;
  price: string;
};

/** Try restaurant URL first, then fallback to place URL */
async function gotoNaverPlacePage(
  page: Page,
  placeId: string,
  path: string,
  expectedLocators: string[]
): Promise<boolean> {
  const bases = [
    `https://pcmap.place.naver.com/restaurant/${placeId}/${path}`,
    `https://pcmap.place.naver.com/place/${placeId}/${path}`,
  ];

  for (const url of bases) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAVER_PLACE_NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(NAVER_PLACE_SETTLE_MS);

      if (await pageHasAnyLocator(page, expectedLocators)) {
        return true;
      }
    } catch {
      // try next URL
    }
  }

  return false;
}

/** Check if any of the given locators exist on the page */
async function pageHasAnyLocator(
  page: Page,
  locators: string[]
): Promise<boolean> {
  for (const selector of locators) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) return true;
    } catch {
      // skip
    }
  }
  return false;
}

async function loadMoreNaverPlaceReviews(
  page: Page,
  targetReviews: number
): Promise<void> {
  let currentCount = await page.locator(".pui__vn15t2").count();
  let clickCount = 0;

  while (
    currentCount < targetReviews &&
    clickCount < NAVER_PLACE_REVIEW_LOAD_MORE_MAX_CLICKS
  ) {
    const loadMoreButton = page
      .locator('a:has-text("펼쳐서 더보기"), button:has-text("펼쳐서 더보기")')
      .first();

    if (
      (await loadMoreButton.count()) === 0 ||
      !(await loadMoreButton.isVisible().catch(() => false))
    ) {
      break;
    }

    await loadMoreButton.scrollIntoViewIfNeeded().catch(() => {});

    await loadMoreButton.click({ timeout: NAVER_PLACE_REVIEW_LOAD_TIMEOUT_MS }).catch(async () => {
      await loadMoreButton.evaluate((el) => {
        (el as HTMLElement).click();
      });
    });

    try {
      await page.waitForFunction(
        (previousCount) =>
          document.querySelectorAll(".pui__vn15t2").length > previousCount,
        currentCount,
        { timeout: NAVER_PLACE_REVIEW_LOAD_TIMEOUT_MS }
      );
    } catch {
      await page.waitForTimeout(NAVER_PLACE_SETTLE_MS);
    }

    const nextCount = await page.locator(".pui__vn15t2").count();
    if (nextCount <= currentCount) {
      break;
    }

    currentCount = nextCount;
    clickCount++;
  }
}

async function expandNaverPlaceReviewTexts(page: Page): Promise<void> {
  const expandButtons = page.locator(".place_apply_pui .pui__wFzIYl");
  const expandCount = await expandButtons.count();

  for (let i = 0; i < expandCount; i++) {
    const button = expandButtons.nth(i);

    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    await button.click({ timeout: 2000 }).catch(async () => {
      await button.evaluate((el) => {
        (el as HTMLElement).click();
      });
    });

    await page.waitForTimeout(80);
  }
}

async function collectNaverPlaceReviewItems(
  page: Page
): Promise<NaverPlaceReviewItem[]> {
  return page.evaluate(() => {
    const reviewItems: NaverPlaceReviewItem[] = [];
    const reviewEls = document.querySelectorAll(".pui__vn15t2");

    reviewEls.forEach((el) => {
      const rawText = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const text = rawText.replace(/\s*접기$/, "").trim();

      if (!text) return;

      const container = el.closest(".place_apply_pui, .pui__X35jYm, li");

      const imgs: string[] = [];
      container?.querySelectorAll("img").forEach((img) => {
        const src = (img as HTMLImageElement).src || "";
        if (src.includes("pup-review-phinf") && !imgs.includes(src)) {
          imgs.push(src);
        }
      });

      const reviewerName =
        container
          ?.querySelector(".pui__NMi-Dp, .pui__J0Dkx, .pui__uslU0d")
          ?.textContent?.trim() ?? "";

      const date =
        container
          ?.querySelector(".pui__gfuUIT, .pui__QKE5B, time, [data-date]")
          ?.textContent?.replace(/^방문일/, "")
          .replace(/\s+/g, " ")
          .trim() ?? "";

      reviewItems.push({ text, images: imgs, reviewerName, date });
    });

    return reviewItems;
  });
}

function normalizeNaverPlaceReviewDate(dateText: string): string {
  const normalized = dateText.replace(/\s+/g, " ").trim();
  const fullDateMatch = normalized.match(
    /\d{4}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*[가-힣]+)?/
  );

  if (fullDateMatch) {
    return fullDateMatch[0].replace(/\s+/g, " ").trim();
  }

  return normalized.replace(/^방문일/, "").trim();
}

function normalizeMenuPrice(priceText: string): string {
  const match = priceText.replace(/\s+/g, " ").match(/((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\s*~\s*(?:\d{1,3}(?:,\d{3})+|\d{4,}))?)\s*원/);
  return match ? `${match[1].replace(/\s+/g, "")}원` : "";
}

function summarizeMenuItems(items: NaverPlaceMenuItem[]): string {
  return items
    .slice(0, 6)
    .map((item) => `${item.name} ${item.price}`)
    .join(", ");
}

function summarizeMenuPriceRange(items: NaverPlaceMenuItem[]): string {
  const prices = items
    .flatMap((item) =>
      item.price
        .replace(/원/g, "")
        .split("~")
        .map((value) => Number(value.replace(/,/g, "").trim()))
    )
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) {
    return "";
  }

  const min = prices[0];
  const max = prices[prices.length - 1];
  if (min === max) {
    return `${min.toLocaleString()}원`;
  }

  return `${min.toLocaleString()}~${max.toLocaleString()}원`;
}

async function collectNaverPlaceMenuItems(
  page: Page,
  placeId: string
): Promise<NaverPlaceMenuItem[]> {
  const navigated = await gotoNaverPlacePage(page, placeId, "menu", [
    ".place_section_content",
    ".place_section",
    "li",
  ]);

  if (!navigated) {
    return [];
  }

  await page.waitForTimeout(NAVER_PLACE_SETTLE_MS);

  return page.evaluate(() => {
    const items: NaverPlaceMenuItem[] = [];
    const seen = new Set<string>();
    const candidates = Array.from(
      document.querySelectorAll("li, div")
    ) as HTMLElement[];

    for (const node of candidates) {
      const raw = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!raw || raw.length < 4 || raw.length > 120) {
        continue;
      }

      const priceMatch = raw.match(/((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\s*~\s*(?:\d{1,3}(?:,\d{3})+|\d{4,}))?)\s*원/);
      if (!priceMatch) {
        continue;
      }

      const price = `${priceMatch[1].replace(/\s+/g, "")}원`;
      const beforePrice = raw.slice(0, priceMatch.index).trim();
      const name = beforePrice
        .replace(/^(대표|추천|인기|시그니처|BEST)\s*/i, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (!name || name.length > 40 || /원$/.test(name)) {
        continue;
      }

      const key = `${name}|${price}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      items.push({ name, price });

      if (items.length >= 8) {
        break;
      }
    }

    return items;
  });
}

export async function scrapeRoutes(app: FastifyInstance) {
  // ─── POST /scrape/oliveyoung ───────────────────────────────
  app.post("/scrape/oliveyoung", async (req) => {
    const { url } = req.body as { url: string };

    if (!url) {
      return { error: "URL is required" };
    }

    // Extract goodsNo from URL query param
    const urlObj = new URL(url);
    const goodsNo = urlObj.searchParams.get("goodsNo");
    if (!goodsNo) {
      return { error: "goodsNo query parameter not found in URL" };
    }

    const browser: Browser = await getBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
    });

    try {
      // Anti-webdriver detection
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
      });

      const page = await context.newPage();

      const mobileUrl = `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${goodsNo}`;
      await page.goto(mobileUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Handle Cloudflare challenge — wait for title to change from challenge page
      const startTitle = await page.title();
      if (
        startTitle.includes("Just a moment") ||
        startTitle.includes("Checking")
      ) {
        await page.waitForFunction(
          (origTitle: string) => document.title !== origTitle,
          startTitle,
          { timeout: 15000 }
        );
        await page.waitForTimeout(2000);
      }

      // Fetch review stats via same-origin API
      let rating: number | null = null;
      let reviewCount = 0;
      let ratingDistribution: Record<string, number> = {};

      try {
        const statsData = await page.evaluate(async (gNo: string) => {
          const res = await fetch(
            `/review/api/v2/reviews/${gNo}/stats`,
            { credentials: "include" }
          );
          if (!res.ok) return null;
          return res.json();
        }, goodsNo);

        if (statsData) {
          rating = statsData.averageScore ?? statsData.avgScore ?? null;
          reviewCount = statsData.totalCount ?? statsData.reviewCount ?? 0;
          if (statsData.ratingDistribution) {
            ratingDistribution = statsData.ratingDistribution;
          }
        }
      } catch {
        // stats fetch failed, continue with defaults
      }

      // Extract product data from DOM
      const productData = await page.evaluate(() => {
        const titleEl = document.querySelector(
          ".prd_name, .goods_name, h2.tit"
        );
        const title = titleEl?.textContent?.trim() ?? "";

        const images: string[] = [];
        document
          .querySelectorAll(
            ".swiper-slide img, .goods_img img, .prd_detail_img img"
          )
          .forEach((img) => {
            const src =
              (img as HTMLImageElement).src ||
              img.getAttribute("data-src") ||
              "";
            if (src && !images.includes(src)) {
              images.push(src);
            }
          });

        const descEl = document.querySelector(
          ".prd_detail_box, .goods_detail, .detail_info"
        );
        const description = descEl?.textContent?.trim() ?? "";

        const priceEl = document.querySelector(
          ".price-2 span, .prd_price .tx_num, .price_area .sale_price"
        );
        const price = priceEl?.textContent?.trim() ?? "";

        return { title, images, description, price };
      });

      const result: ScrapedProduct = {
        url,
        title: productData.title,
        description: productData.description,
        price: productData.price,
        images: productData.images,
        specs: {},
        reviews: [],
        rating,
        reviewCount,
        brand: "",
        category: "",
        source: "oliveyoung",
        reviewApiParams: {
          source: "oliveyoung",
          goodsNo,
          goodsUrl: url,
        },
      };

      return result;
    } catch (err) {
      return {
        error: "Olive Young scrape failed",
        detail: err instanceof Error ? err.message : "Unknown error",
      };
    } finally {
      await context.close();
    }
  });

  // ─── POST /scrape/naver-place ──────────────────────────────
  app.post("/scrape/naver-place", async (req) => {
    const { url } = req.body as { url: string };

    if (!url) {
      return { error: "URL is required" };
    }

    // Extract placeId from URL patterns: /place/\d+, /restaurant/\d+, etc.
    const placeIdMatch = url.match(
      /\/(?:place|restaurant|cafe|hospital|beauty|accommodation)\/(\d+)/
    );
    if (!placeIdMatch) {
      return { error: "Could not extract placeId from URL" };
    }
    const placeId = placeIdMatch[1];

    const browser: Browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    try {
      const page = await context.newPage();

      // Navigate to place home page
      const navigated = await gotoNaverPlacePage(page, placeId, "home", [
        ".place_section",
        ".place_detail",
        "#_title",
      ]);

      if (!navigated) {
        return { error: "Failed to navigate to Naver Place page" };
      }

      // Extract place data from DOM
      const placeData = await page.evaluate(() => {
        const nameEl = document.querySelector(
          "#_title .GHAhO, .place_section .Fc1rA, .GHAhO"
        );
        const name = nameEl?.textContent?.trim() ?? "";

        const categoryEl = document.querySelector(
          "#_title .DJJvD, .place_section .lnJFt, .DJJvD"
        );
        const category = categoryEl?.textContent?.trim() ?? "";

        // Images from ldb-phinf CDN
        const images: string[] = [];
        document.querySelectorAll("img").forEach((img) => {
          const src = img.src || img.getAttribute("data-src") || "";
          if (src.includes("ldb-phinf") && !images.includes(src)) {
            images.push(src);
          }
        });

        const addressEl = document.querySelector(
          ".LDgIH, .place_section_content .IH7VR"
        );
        const address = addressEl?.textContent?.trim() ?? "";

        const phoneEl = document.querySelector(".xlx7Q, .place_section_content .dry01");
        const phone = phoneEl?.textContent?.trim() ?? "";

        // Business hours
        const hoursEls = document.querySelectorAll(
          ".place_section_content .A_cdD, .O8qbU"
        );
        const hours: string[] = [];
        hoursEls.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) hours.push(text);
        });

        // Facilities
        const facilityEls = document.querySelectorAll(".xPvEL, .JcLKu");
        const facilities: string[] = [];
        facilityEls.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) facilities.push(text);
        });

        // Directions
        const directionsEl = document.querySelector(".place_section_content .PMoxW");
        const directions = directionsEl?.textContent?.trim() ?? "";

        // AI briefing
        const aiBriefingEl = document.querySelector(".VoELC, .sc_new");
        const aiBriefing = aiBriefingEl?.textContent?.trim() ?? "";

        // Tags
        const tagEls = document.querySelectorAll(".xPvEL .chip_keyword, .PXMot a");
        const tags: string[] = [];
        tagEls.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) tags.push(text);
        });

        return {
          name,
          category,
          images,
          address,
          phone,
          hours,
          facilities,
          directions,
          aiBriefing,
          tags,
        };
      });

      const menuItems = await collectNaverPlaceMenuItems(page, placeId).catch(() => []);
      const menuSummary = summarizeMenuItems(menuItems);
      const priceRange = summarizeMenuPriceRange(menuItems);

      // Navigate to review page
      const reviewNavigated = await gotoNaverPlacePage(
        page,
        placeId,
        "review/visitor",
        [".pui__vn15t2", ".place_section_content"]
      );

      const reviews: ProductReview[] = [];

      if (reviewNavigated) {
        await loadMoreNaverPlaceReviews(page, NAVER_PLACE_TARGET_REVIEW_COUNT);
        await expandNaverPlaceReviewTexts(page);

        const reviewData = await collectNaverPlaceReviewItems(page);
        const seenReviews = new Set<string>();

        for (const item of reviewData) {
          const reviewKey = [
            item.reviewerName.trim(),
            item.date.trim(),
            item.text.trim(),
          ].join("|");

          if (seenReviews.has(reviewKey)) {
            continue;
          }

          seenReviews.add(reviewKey);
          reviews.push({
            text: item.text.trim(),
            rating: 0,
            images: item.images.map((imgUrl) => ({
              originalUrl: imgUrl,
              thumbnailUrl: imgUrl,
            })),
            reviewerName: item.reviewerName.trim(),
            date: normalizeNaverPlaceReviewDate(item.date),
          });

          if (reviews.length >= NAVER_PLACE_TARGET_REVIEW_COUNT) {
            break;
          }
        }
      }

      const result: ScrapedProduct = {
        url,
        title: placeData.name,
        description: placeData.aiBriefing || placeData.directions || "",
        price: priceRange,
        images: placeData.images,
        specs: {
          address: placeData.address,
          phone: placeData.phone,
          hours: placeData.hours.join(" | "),
          facilities: placeData.facilities.join(", "),
          directions: placeData.directions,
          aiBriefing: placeData.aiBriefing,
          tags: placeData.tags.join(", "),
          menuSummary,
          priceRange,
        },
        reviews,
        rating: null,
        reviewCount: reviews.length,
        brand: "",
        category: placeData.category,
        source: "naver-place",
      };

      return result;
    } catch (err) {
      return {
        error: "Naver Place scrape failed",
        detail: err instanceof Error ? err.message : "Unknown error",
      };
    } finally {
      await context.close();
    }
  });
}
