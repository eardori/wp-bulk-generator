import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright";
import type { ScrapedProduct, ProductReview, ReviewApiParams } from "../types.js";
import { getBrowser } from "../utils/browser.js";

const NAVER_PLACE_NAV_TIMEOUT_MS = 18000;
const NAVER_PLACE_SETTLE_MS = 1200;

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

      // Navigate to review page
      const reviewNavigated = await gotoNaverPlacePage(
        page,
        placeId,
        "review/visitor",
        [".pui__vn15t2", ".place_section_content"]
      );

      const reviews: ProductReview[] = [];

      if (reviewNavigated) {
        // Click "펼쳐서 더보기" buttons to load more reviews
        const targetReviews = 50;
        const maxClicks = 15;
        let clickCount = 0;

        while (clickCount < maxClicks) {
          try {
            const moreButton = page.locator(
              'a:has-text("펼쳐서 더보기"), button:has-text("더보기")'
            );
            const buttonCount = await moreButton.count();
            if (buttonCount === 0) break;

            await moreButton.first().click();
            await page.waitForTimeout(800);
            clickCount++;

            // Check if we have enough reviews
            const reviewEls = await page.locator(".pui__vn15t2").count();
            if (reviewEls >= targetReviews) break;
          } catch {
            break;
          }
        }

        // Expand truncated reviews by clicking expand elements
        try {
          const expandButtons = page.locator(".pui__wFzIYl");
          const expandCount = await expandButtons.count();
          for (let i = 0; i < expandCount; i++) {
            try {
              await expandButtons.nth(i).click();
              await page.waitForTimeout(100);
            } catch {
              // skip individual expand failures
            }
          }
        } catch {
          // expand step failed
        }

        // Collect reviews
        const reviewData = await page.evaluate(() => {
          const reviewItems: Array<{
            text: string;
            images: string[];
            reviewerName: string;
            date: string;
          }> = [];

          const reviewEls = document.querySelectorAll(".pui__vn15t2");
          reviewEls.forEach((el) => {
            const text = el.textContent?.trim() ?? "";
            if (!text) return;

            // Find parent review container
            const container = el.closest(".pui__X35jYm, .place_section_content > div");

            const imgs: string[] = [];
            container
              ?.querySelectorAll("img")
              .forEach((img) => {
                const src = img.src || "";
                if (src.includes("pup-review-phinf") && !imgs.includes(src)) {
                  imgs.push(src);
                }
              });

            const nameEl = container?.querySelector(
              ".pui__NMi-Dp, .pui__J0Dkx"
            );
            const reviewerName = nameEl?.textContent?.trim() ?? "";

            const dateEl = container?.querySelector(
              ".pui__gfuUIT, .pui__QKE5B, time"
            );
            const date = dateEl?.textContent?.trim() ?? "";

            reviewItems.push({ text, images: imgs, reviewerName, date });
          });

          return reviewItems;
        });

        for (const item of reviewData) {
          reviews.push({
            text: item.text,
            rating: 0,
            images: item.images.map((imgUrl) => ({
              originalUrl: imgUrl,
              thumbnailUrl: imgUrl,
            })),
            reviewerName: item.reviewerName,
            date: item.date,
          });
        }
      }

      const result: ScrapedProduct = {
        url,
        title: placeData.name,
        description: placeData.aiBriefing || placeData.directions || "",
        price: "",
        images: placeData.images,
        specs: {
          address: placeData.address,
          phone: placeData.phone,
          hours: placeData.hours.join(" | "),
          facilities: placeData.facilities.join(", "),
          directions: placeData.directions,
          aiBriefing: placeData.aiBriefing,
          tags: placeData.tags.join(", "),
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
