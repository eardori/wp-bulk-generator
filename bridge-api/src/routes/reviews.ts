import { execSync } from "child_process";
import type { FastifyInstance } from "fastify";
import type {
  ProductReview,
  ReviewImage,
  ReviewCollection,
  ReviewTheme,
} from "../types.js";
import { setupSSE } from "../utils/sse.js";

// --- 상수 ---
const OY_MAX_PAGES = 25;
const OY_PAGE_SIZE = 20;
const OY_MIN_TEXT_LENGTH = 30;
const OY_MAX_REVIEWS = 500;
const OY_REVIEW_IMG_CDN =
  "https://image.oliveyoung.co.kr/uploads/images/gdasEditor/";

const NAVER_MAX_PAGES = 5;
const NAVER_PAGE_SIZE = 20;

// 키워드 분석용
const REVIEW_KEYWORDS: { keyword: string; sentiment: "positive" | "negative" | "neutral" }[] = [
  // positive
  { keyword: "좋아요", sentiment: "positive" },
  { keyword: "만족", sentiment: "positive" },
  { keyword: "추천", sentiment: "positive" },
  { keyword: "효과", sentiment: "positive" },
  { keyword: "맛있", sentiment: "positive" },
  { keyword: "친절", sentiment: "positive" },
  { keyword: "깔끔", sentiment: "positive" },
  { keyword: "최고", sentiment: "positive" },
  { keyword: "재구매", sentiment: "positive" },
  { keyword: "가성비", sentiment: "positive" },
  { keyword: "분위기", sentiment: "positive" },
  { keyword: "맛집", sentiment: "positive" },
  { keyword: "촉촉", sentiment: "positive" },
  { keyword: "부드러", sentiment: "positive" },
  { keyword: "향기", sentiment: "positive" },
  { keyword: "순하", sentiment: "positive" },
  { keyword: "자극", sentiment: "positive" },
  { keyword: "빠른배송", sentiment: "positive" },
  { keyword: "선물", sentiment: "positive" },
  { keyword: "고급", sentiment: "positive" },
  { keyword: "든든", sentiment: "positive" },
  { keyword: "신선", sentiment: "positive" },
  { keyword: "편리", sentiment: "positive" },
  { keyword: "간편", sentiment: "positive" },
  { keyword: "저렴", sentiment: "positive" },
  { keyword: "튼튼", sentiment: "positive" },
  // negative
  { keyword: "별로", sentiment: "negative" },
  { keyword: "실망", sentiment: "negative" },
  { keyword: "아쉬", sentiment: "negative" },
  { keyword: "비싸", sentiment: "negative" },
  { keyword: "불친절", sentiment: "negative" },
  { keyword: "느리", sentiment: "negative" },
  { keyword: "맛없", sentiment: "negative" },
  { keyword: "냄새", sentiment: "negative" },
  { keyword: "파손", sentiment: "negative" },
  // neutral
  { keyword: "보통", sentiment: "neutral" },
  { keyword: "그냥", sentiment: "neutral" },
  { keyword: "무난", sentiment: "neutral" },
  { keyword: "평범", sentiment: "neutral" },
];

// --- 헬퍼 함수 ---

function buildReviewCollection(reviews: ProductReview[]): ReviewCollection {
  // 평점 분포
  const ratingDistribution: Record<string, number> = {};
  let ratingSum = 0;

  for (const review of reviews) {
    const key = String(review.rating);
    ratingDistribution[key] = (ratingDistribution[key] || 0) + 1;
    ratingSum += review.rating;
  }

  const averageRating =
    reviews.length > 0
      ? Math.round((ratingSum / reviews.length) * 10) / 10
      : 0;

  // 키워드 분석
  const themeMap = new Map<
    string,
    { keyword: string; sentiment: "positive" | "negative" | "neutral"; count: number; sampleTexts: string[] }
  >();

  for (const kw of REVIEW_KEYWORDS) {
    themeMap.set(kw.keyword, {
      keyword: kw.keyword,
      sentiment: kw.sentiment,
      count: 0,
      sampleTexts: [],
    });
  }

  for (const review of reviews) {
    const text = review.text;
    for (const kw of REVIEW_KEYWORDS) {
      if (text.includes(kw.keyword)) {
        const entry = themeMap.get(kw.keyword)!;
        entry.count += 1;
        if (entry.sampleTexts.length < 3) {
          entry.sampleTexts.push(
            text.length > 100 ? text.slice(0, 100) + "..." : text
          );
        }
      }
    }
  }

  // 상위 15개 테마
  const themes: ReviewTheme[] = Array.from(themeMap.values())
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    reviews,
    totalCount: reviews.length,
    averageRating,
    ratingDistribution,
    themes,
  };
}

// --- 라우트 ---

export async function reviewsRoutes(app: FastifyInstance) {
  // ==========================================
  // POST /reviews/oliveyoung - SSE 스트리밍
  // ==========================================
  app.post("/reviews/oliveyoung", async (req, reply) => {
    const { goodsNo, maxPages } = req.body as {
      goodsNo: string;
      maxPages?: number;
    };

    if (!goodsNo) {
      return reply.code(400).send({ error: "goodsNo is required" });
    }

    const { send, close } = setupSSE(reply);
    const effectiveMaxPages = Math.min(maxPages || OY_MAX_PAGES, OY_MAX_PAGES);
    const allReviews: ProductReview[] = [];

    let browser: import("playwright").Browser | null = null;

    try {
      // Playwright 동적 임포트
      const { chromium } = await import("playwright");

      send({ type: "status", message: "브라우저 실행 중..." });

      // 메모리 절약을 위한 fresh 브라우저 (수집 후 종료)
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
          "--renderer-process-limit=1",
          "--disk-cache-size=1",
          "--media-cache-size=1",
        ],
      });

      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        viewport: { width: 390, height: 844 },
        javaScriptEnabled: true,
      });

      // anti-webdriver
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
      });

      const page = await context.newPage();

      // 이미지, 폰트 차단
      await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot}", (route) =>
        route.abort()
      );

      send({ type: "status", message: "올리브영 페이지 접속 중..." });

      // Cloudflare 챌린지 통과를 위한 초기 페이지 방문
      await page.goto(
        `https://m.oliveyoung.co.kr/m/goods/GoodsDetail.do?goodsNo=${goodsNo}`,
        { waitUntil: "domcontentloaded", timeout: 30000 }
      );

      // Cloudflare 대기
      let cfRetries = 0;
      while (cfRetries < 10) {
        const title = await page.title();
        if (!title.toLowerCase().includes("just a moment")) break;
        await page.waitForTimeout(1000);
        cfRetries++;
      }

      send({ type: "status", message: "리뷰 데이터 수집 시작..." });

      // 총 리뷰 수 확인
      let totalReviewCount = 0;
      try {
        const statsData = await page.evaluate(async (gNo: string) => {
          const resp = await fetch(
            `/review/api/v2/reviews/${gNo}/stats`,
            { headers: { Accept: "application/json" } }
          );
          return resp.json();
        }, goodsNo);
        totalReviewCount =
          statsData?.data?.totalCount ||
          statsData?.totalCount ||
          statsData?.data?.reviewCount ||
          0;
        send({
          type: "progress",
          message: `총 리뷰 수: ${totalReviewCount}`,
          totalReviewCount,
        });
      } catch {
        send({ type: "progress", message: "총 리뷰 수 확인 실패, 수집 계속 진행" });
      }

      // 페이지별 리뷰 수집
      for (let pageNum = 1; pageNum <= effectiveMaxPages; pageNum++) {
        if (allReviews.length >= OY_MAX_REVIEWS) break;

        try {
          const responseData = await page.evaluate(
            async (params: { goodsNo: string; page: number; size: number }) => {
              const resp = await fetch("/review/api/v2/reviews", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  goodsNumber: params.goodsNo,
                  page: params.page,
                  size: params.size,
                  sortType: "USEFUL_SCORE_DESC",
                  reviewType: "ALL",
                }),
              });
              return resp.json();
            },
            { goodsNo, page: pageNum, size: OY_PAGE_SIZE }
          );

          // 다양한 응답 구조 파싱
          let reviewItems: unknown[] = [];
          const rd = responseData as Record<string, unknown>;
          const pageData = rd.pageData as Record<string, unknown> | undefined;
          const data = rd.data as unknown[] | undefined;

          if (pageData) {
            if (Array.isArray(pageData)) {
              reviewItems = pageData;
            } else if (Array.isArray((pageData as Record<string, unknown>).list)) {
              reviewItems = (pageData as Record<string, unknown>).list as unknown[];
            } else if (Array.isArray((pageData as Record<string, unknown>).content)) {
              reviewItems = (pageData as Record<string, unknown>).content as unknown[];
            }
          } else if (Array.isArray(data)) {
            reviewItems = data;
          }

          if (reviewItems.length === 0) {
            send({
              type: "progress",
              message: `페이지 ${pageNum}: 리뷰 없음, 수집 종료`,
            });
            break;
          }

          for (const item of reviewItems) {
            if (allReviews.length >= OY_MAX_REVIEWS) break;

            const r = item as Record<string, unknown>;
            const text =
              (r.content as string) || (r.reviewContent as string) || "";

            // 최소 글자 수 필터
            if (text.length < OY_MIN_TEXT_LENGTH) continue;

            const rating = (r.reviewScore as number) || 0;

            // 이미지 추출
            const images: ReviewImage[] = [];
            const photoList = r.photoReviewList as
              | Record<string, unknown>[]
              | undefined;
            if (Array.isArray(photoList)) {
              for (const photo of photoList) {
                const imagePath = photo.imagePath as string | undefined;
                if (imagePath) {
                  const fullUrl = imagePath.startsWith("http")
                    ? imagePath
                    : OY_REVIEW_IMG_CDN + imagePath;
                  images.push({
                    originalUrl: fullUrl,
                    thumbnailUrl: fullUrl,
                  });
                }
              }
            }

            // 리뷰어
            const profileDto = r.profileDto as
              | Record<string, unknown>
              | undefined;
            const reviewerName =
              (profileDto?.memberNickname as string) || undefined;

            allReviews.push({
              text,
              rating,
              images: images.length > 0 ? images : undefined,
              reviewerName,
            });
          }

          send({
            type: "progress",
            message: `페이지 ${pageNum} 완료`,
            page: pageNum,
            collected: allReviews.length,
          });

          // 페이지 간 딜레이
          await page.waitForTimeout(300);
        } catch (pageErr) {
          send({
            type: "error",
            message: `페이지 ${pageNum} 수집 실패: ${pageErr instanceof Error ? pageErr.message : "Unknown"}`,
          });
        }
      }
    } catch (err) {
      send({
        type: "error",
        message: `올리브영 리뷰 수집 오류: ${err instanceof Error ? err.message : "Unknown"}`,
      });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // 브라우저 종료 실패 무시
        }
      }
    }

    // 결과 빌드 & 전송
    const collection = buildReviewCollection(allReviews);
    send({ type: "result", data: collection });
    close();
  });

  // ==========================================
  // POST /reviews/naver - SSE 스트리밍
  // ==========================================
  app.post("/reviews/naver", async (req, reply) => {
    const { merchantNo, originProductNo, maxPages } = req.body as {
      merchantNo: string;
      originProductNo: string;
      maxPages?: number;
    };

    if (!merchantNo || !originProductNo) {
      return reply
        .code(400)
        .send({ error: "merchantNo and originProductNo are required" });
    }

    const { send, close } = setupSSE(reply);
    const effectiveMaxPages = Math.min(
      maxPages || NAVER_MAX_PAGES,
      NAVER_MAX_PAGES
    );
    const allReviews: ProductReview[] = [];

    try {
      send({ type: "status", message: "네이버 스마트스토어 리뷰 수집 시작..." });

      for (let pageNum = 1; pageNum <= effectiveMaxPages; pageNum++) {
        try {
          const url = `https://smartstore.naver.com/i/v1/reviews/paged-reviews?merchantNo=${merchantNo}&originProductNo=${originProductNo}&page=${pageNum}&pageSize=${NAVER_PAGE_SIZE}&sortType=REVIEW_RANKING`;

          const rawResponse = execSync(
            `curl -sL --max-time 15 \
              -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" \
              -H "Referer: https://smartstore.naver.com/" \
              -H "Accept: application/json" \
              "${url}"`,
            { maxBuffer: 10 * 1024 * 1024, timeout: 20000 }
          ).toString();

          const responseData = JSON.parse(rawResponse) as Record<
            string,
            unknown
          >;

          // 다양한 응답 구조 파싱
          let reviewItems: unknown[] = [];
          if (Array.isArray(responseData.contents)) {
            reviewItems = responseData.contents;
          } else if (Array.isArray(responseData.reviews)) {
            reviewItems = responseData.reviews;
          } else {
            const result = responseData.result as
              | Record<string, unknown>
              | undefined;
            if (result && Array.isArray(result.contents)) {
              reviewItems = result.contents;
            }
          }

          if (reviewItems.length === 0) {
            send({
              type: "progress",
              message: `페이지 ${pageNum}: 리뷰 없음, 수집 종료`,
            });
            break;
          }

          for (const item of reviewItems) {
            const r = item as Record<string, unknown>;

            const text =
              (r.reviewContent as string) ||
              (r.content as string) ||
              (r.body as string) ||
              "";

            if (!text) continue;

            const rating =
              (r.reviewScore as number) || (r.score as number) || 0;

            // 이미지 추출
            const images: ReviewImage[] = [];
            const reviewImages = r.reviewImages as
              | Record<string, unknown>[]
              | undefined;
            if (Array.isArray(reviewImages)) {
              for (const img of reviewImages) {
                const originalUrl =
                  (img.originalImageUrl as string) ||
                  (img.thumbnailImageUrl as string) ||
                  "";
                const thumbnailUrl =
                  (img.thumbnailImageUrl as string) ||
                  (img.originalImageUrl as string) ||
                  "";
                if (originalUrl) {
                  images.push({ originalUrl, thumbnailUrl });
                }
              }
            }

            const reviewerName =
              (r.reviewerNickname as string) || undefined;
            const purchaseOption =
              (r.productOption as string) ||
              (r.optionContent as string) ||
              undefined;
            const date =
              (r.createDate as string) ||
              (r.reviewCreatedDate as string) ||
              undefined;

            allReviews.push({
              text,
              rating,
              images: images.length > 0 ? images : undefined,
              reviewerName,
              purchaseOption,
              date,
            });
          }

          send({
            type: "progress",
            message: `페이지 ${pageNum} 완료`,
            page: pageNum,
            collected: allReviews.length,
          });

          // 페이지 간 딜레이
          if (pageNum < effectiveMaxPages) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (pageErr) {
          send({
            type: "error",
            message: `페이지 ${pageNum} 수집 실패: ${pageErr instanceof Error ? pageErr.message : "Unknown"}`,
          });
        }
      }
    } catch (err) {
      send({
        type: "error",
        message: `네이버 리뷰 수집 오류: ${err instanceof Error ? err.message : "Unknown"}`,
      });
    }

    // 결과 빌드 & 전송
    const collection = buildReviewCollection(allReviews);
    send({ type: "result", data: collection });
    close();
  });
}
