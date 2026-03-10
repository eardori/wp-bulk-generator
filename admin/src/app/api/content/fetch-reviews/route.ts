import { NextRequest } from "next/server";
import { execSync } from "child_process";
import type {
  ReviewApiParams,
  ReviewCollection,
  ProductReview,
  ReviewImage,
  ReviewTheme,
} from "@/app/content/types";

export const maxDuration = 300;

const REVIEW_KEYWORDS: Array<{ keyword: string; sentiment: "positive" | "negative" | "neutral" }> =
  [
    { keyword: "보습", sentiment: "positive" },
    { keyword: "촉촉", sentiment: "positive" },
    { keyword: "흡수", sentiment: "positive" },
    { keyword: "향기", sentiment: "positive" },
    { keyword: "향", sentiment: "neutral" },
    { keyword: "가격", sentiment: "neutral" },
    { keyword: "자극", sentiment: "negative" },
    { keyword: "트러블", sentiment: "negative" },
    { keyword: "재구매", sentiment: "positive" },
    { keyword: "효과", sentiment: "positive" },
    { keyword: "발림", sentiment: "positive" },
    { keyword: "끈적", sentiment: "negative" },
    { keyword: "산뜻", sentiment: "positive" },
    { keyword: "맑아", sentiment: "positive" },
    { keyword: "밝아", sentiment: "positive" },
    { keyword: "피부", sentiment: "neutral" },
    { keyword: "성분", sentiment: "neutral" },
    { keyword: "용량", sentiment: "neutral" },
    { keyword: "포장", sentiment: "neutral" },
    { keyword: "배송", sentiment: "neutral" },
    { keyword: "추천", sentiment: "positive" },
    { keyword: "만족", sentiment: "positive" },
    { keyword: "실망", sentiment: "negative" },
    { keyword: "별로", sentiment: "negative" },
  ];

export async function POST(req: NextRequest) {
  const { reviewApiParams } = (await req.json()) as {
    reviewApiParams: ReviewApiParams;
  };

  if (!reviewApiParams?.source) {
    return Response.json({ error: "리뷰 API 파라미터가 필요합니다." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "progress", page: 0, total: 5, message: "리뷰 수집 시작..." });

      let allReviews: ProductReview[] = [];

      try {
        if (reviewApiParams.source === "oliveyoung") {
          allReviews = await fetchOliveYoungReviews(reviewApiParams, send);
        } else if (reviewApiParams.source === "naver") {
          allReviews = await fetchNaverReviews(reviewApiParams, send);
        }
      } catch (err) {
        send({ type: "error", message: `수집 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}` });
      }

      const collection = buildReviewCollection(allReviews);
      send({ type: "done", collection, message: `총 ${allReviews.length}개 리뷰 수집 완료` });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Naver (curl JSON API) ────────────────────────────────────────────────────

function fetchNaverReviewsCurl(url: string): string {
  const escapedUrl = url.replace(/'/g, "'\\''");
  const cmd = [
    "curl", "-s", "-L", "--max-time", "15",
    "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "-H", "Referer: https://smartstore.naver.com/",
    "-H", "Accept: application/json",
    "-H", "Accept-Language: ko-KR,ko;q=0.9",
    `'${escapedUrl}'`,
  ].join(" ");
  const result = execSync(cmd, { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }).toString();
  if (!result || result.length < 10) throw new Error("Empty response from curl");
  return result;
}

async function fetchNaverReviews(
  params: ReviewApiParams,
  send: (data: Record<string, unknown>) => void
): Promise<ProductReview[]> {
  const allReviews: ProductReview[] = [];
  const maxPages = 5;
  const pageSize = 20;

  for (let page = 1; page <= maxPages; page++) {
    try {
      send({ type: "progress", page, total: maxPages, message: `네이버 리뷰 ${page}/${maxPages} 페이지 수집 중...` });

      const url =
        `https://smartstore.naver.com/i/v1/reviews/paged-reviews` +
        `?merchantNo=${encodeURIComponent(params.merchantNo!)}` +
        `&originProductNo=${encodeURIComponent(params.originProductNo!)}` +
        `&page=${page}&pageSize=${pageSize}&sortType=REVIEW_RANKING`;

      const raw = fetchNaverReviewsCurl(url);
      const data = JSON.parse(raw) as Record<string, unknown>;

      const contents: unknown[] =
        (data.contents as unknown[]) ||
        (data.reviews as unknown[]) ||
        ((data.result as Record<string, unknown>)?.contents as unknown[]) ||
        [];

      if (contents.length === 0) break;

      const reviews = parseNaverReviewItems(contents);
      allReviews.push(...reviews);
      send({ type: "reviews", reviews, collected: allReviews.length });

      if (page < maxPages) await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      send({ type: "error", message: `${page}페이지 수집 실패: ${err instanceof Error ? err.message : "오류"}` });
      break;
    }
  }

  return allReviews;
}

function parseNaverReviewItems(contents: unknown[]): ProductReview[] {
  const reviews: ProductReview[] = [];
  for (const item of contents) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const text = (r.reviewContent as string) || (r.content as string) || (r.body as string) || "";
    if (!text) continue;

    const images: ReviewImage[] = [];
    const rawImages = (r.reviewImages as unknown[]) || (r.images as unknown[]) || [];
    for (const img of rawImages) {
      if (!img || typeof img !== "object") continue;
      const imgObj = img as Record<string, unknown>;
      const originalUrl = (imgObj.originalImageUrl as string) || (imgObj.url as string) || "";
      const thumbnailUrl = (imgObj.thumbnailImageUrl as string) || (imgObj.thumbnailUrl as string) || originalUrl;
      if (originalUrl) images.push({ originalUrl, thumbnailUrl });
    }

    reviews.push({
      id: String(r.reviewId ?? r.id ?? Date.now() + Math.random()),
      text: text.slice(0, 500),
      rating: Number(r.reviewScore ?? r.score ?? r.rating ?? 5),
      images,
      reviewerName: (r.reviewerNickname as string) || (r.nickname as string) || "",
      purchaseOption: (r.productOption as string) || (r.optionContent as string) || "",
      date: (r.createDate as string) || (r.reviewCreatedDate as string) || "",
    });
  }
  return reviews;
}

// ─── Olive Young (Playwright → m.oliveyoung.co.kr REST API) ──────────────────
// Node.js fetch는 Cloudflare TLS 핑거프린트(JA3/JA4) 검사에 걸려 403 반환.
// page.evaluate() 안에서 fetch를 실행하면 브라우저 컨텍스트 그대로 → Cloudflare 통과.
// 메모리 절약: 이미지/폰트 차단 + 수집 직후 브라우저 즉시 종료.

const OY_MIN_TEXT_LENGTH = 30;
const OY_PAGE_SIZE = 20;
const OY_MAX_PAGES = 25;   // 최대 25페이지 × 20 = 500건
const OY_MAX_REVIEWS = 500; // 30자 이상 필터 후 이 수에 도달하면 조기 종료

const OY_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function fetchOliveYoungReviews(
  params: ReviewApiParams,
  send: (data: Record<string, unknown>) => void
): Promise<ProductReview[]> {
  const { chromium } = await import("playwright");

  const goodsNo = params.goodsNo!;
  const allReviews: ProductReview[] = [];

  send({ type: "progress", page: 0, total: OY_MAX_PAGES, message: "올리브영 리뷰 수집 시작..." });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",   // /dev/shm → /tmp (메모리 절약)
      "--disable-gpu",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--disable-blink-features=AutomationControlled",
      "--renderer-process-limit=1",  // 렌더러 프로세스 1개로 제한
      "--disk-cache-size=1",
      "--media-cache-size=1",
      "--window-size=390,844",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent: OY_UA,
      locale: "ko-KR",
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9" },
    });

    // 이미지/폰트 차단 → 렌더러 메모리 절약 (JS/CSS는 CF 챌린지에 필요하므로 허용)
    await context.route(
      /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|mp3|wav)(\?.*)?$/i,
      (route) => route.abort()
    );

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, "languages", { get: () => ["ko-KR", "ko"] });
    });

    const page = await context.newPage();

    // Cloudflare JS 챌린지 통과
    await page.goto(
      `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${goodsNo}`,
      { waitUntil: "domcontentloaded", timeout: 45000 }
    );

    const pageTitle = await page.title();
    if (pageTitle.includes("moment") || pageTitle.includes("Cloudflare")) {
      send({ type: "progress", page: 0, total: OY_MAX_PAGES, message: "Cloudflare 챌린지 통과 대기 중..." });
      try {
        await page.waitForFunction(
          () => !document.title.includes("moment") && !document.title.includes("Cloudflare"),
          { timeout: 20000 }
        );
      } catch { /* proceed anyway */ }
    }

    // 총 리뷰 수 확인 (브라우저 컨텍스트 fetch → Cloudflare 통과)
    const totalReviews: number = await page.evaluate(async (gNo: string) => {
      try {
        const r = await fetch(`/review/api/v2/reviews/${gNo}/stats`, {
          headers: { Accept: "application/json" },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = await r.json() as any;
        return (d?.data?.reviewCount ?? d?.reviewCount ?? 0) as number;
      } catch { return 0; }
    }, goodsNo);

    send({
      type: "progress",
      page: 0,
      total: OY_MAX_PAGES,
      message: `총 ${totalReviews}개 리뷰 확인 (30자 이상 최대 ${OY_MAX_REVIEWS}건 수집)...`,
    });

    // 페이지별 순차 수집 — page.evaluate() 내부 fetch = 브라우저 컨텍스트 실행
    // → 올바른 TLS 핑거프린트 + 자동 쿠키 첨부 → Cloudflare 통과
    for (let p = 0; p < OY_MAX_PAGES; p++) {
      try {
        send({
          type: "progress",
          page: p,
          total: OY_MAX_PAGES,
          message: `${p + 1}/${OY_MAX_PAGES} 페이지 수집 중...`,
        });

        const result = await page.evaluate(
          async ({ gNo, pageNum, pageSize }: { gNo: string; pageNum: number; pageSize: number }) => {
            try {
              const res = await fetch("/review/api/v2/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                  goodsNumber: gNo,
                  page: pageNum,
                  size: pageSize,
                  sortType: "USEFUL_SCORE_DESC",
                  reviewType: "ALL",
                }),
              });

              if (!res.ok) {
                return { ok: false, status: res.status, items: [] as unknown[], topKeys: "", firstItemKeys: "" };
              }

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data: any = await res.json();

              // 앱 레벨 오류 체크 (HTTP 200이지만 code:400 등)
              if (data?.code && data.code >= 400) {
                return { ok: false, status: data.code, items: [] as unknown[], topKeys: "", firstItemKeys: "", error: data.message || data.status };
              }

              const topKeys: string = Object.keys(data ?? {}).join(",");

              // pageData / data 내부 구조 진단
              const pageDataKeys: string = data?.pageData && typeof data.pageData === "object" && !Array.isArray(data.pageData)
                ? Object.keys(data.pageData).join(",") : (Array.isArray(data?.pageData) ? "[array]" : "none");
              const dataKeys: string = data?.data && typeof data.data === "object" && !Array.isArray(data.data)
                ? Object.keys(data.data).join(",") : (Array.isArray(data?.data) ? "[array]" : "none");

              const items: unknown[] =
                Array.isArray(data?.pageData)                     ? data.pageData :
                Array.isArray(data?.pageData?.list)               ? data.pageData.list :
                Array.isArray(data?.pageData?.content)            ? data.pageData.content :
                Array.isArray(data?.pageData?.reviews)            ? data.pageData.reviews :
                Array.isArray(data?.pageData?.reviewList)         ? data.pageData.reviewList :
                Array.isArray(data?.pageData?.data)               ? data.pageData.data :
                Array.isArray(data?.data)                         ? data.data :
                Array.isArray(data?.data?.content)                ? data.data.content :
                Array.isArray(data?.data?.list)                   ? data.data.list :
                Array.isArray(data?.data?.pageData)               ? data.data.pageData :
                Array.isArray(data?.data?.reviews)                ? data.data.reviews :
                Array.isArray(data?.list)                         ? data.list :
                Array.isArray(data?.result)                       ? data.result :
                Array.isArray(data?.content)                      ? data.content :
                Array.isArray(data?.reviews)                      ? data.reviews :
                [];

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const firstItemKeys: string = items.length > 0 ? Object.keys(items[0] as any).slice(0, 8).join(",") : "";

              return { ok: true, status: 200, items, topKeys, firstItemKeys, pageDataKeys, dataKeys };
            } catch (e) {
              return { ok: false, status: 0, items: [] as unknown[], topKeys: "", firstItemKeys: "", error: String(e).slice(0, 100) };
            }
          },
          { gNo: goodsNo, pageNum: p, pageSize: OY_PAGE_SIZE }
        );

        if (!result.ok) {
          send({ type: "error", message: `p${p}: HTTP ${result.status}${(result as { error?: string }).error ? ` (${(result as { error?: string }).error})` : ""}` });
          break;
        }

        // 첫 페이지: 응답 구조 진단 로그
        if (p === 0) {
          const r2 = result as typeof result & { pageDataKeys?: string; dataKeys?: string };
          const diag = result.items.length > 0
            ? `items=${result.items.length} topKeys=${result.topKeys} itemKeys=${result.firstItemKeys}`
            : `empty — topKeys=${result.topKeys} | pageData내부=${r2.pageDataKeys} | data내부=${r2.dataKeys}`;
          send({ type: "error", message: `[구조진단] p0 ${diag}` });
        }

        const filtered = (result.items as Record<string, unknown>[]).filter(
          (r) => (((r.content as string) ?? (r.reviewContent as string)) || "").length >= OY_MIN_TEXT_LENGTH
        );

        const reviews = parseOliveYoungReviewApi(filtered);
        if (reviews.length > 0) {
          allReviews.push(...reviews);
          send({ type: "reviews", reviews, collected: allReviews.length });
        }

        // 500개 도달 시 조기 종료
        if (allReviews.length >= OY_MAX_REVIEWS) {
          send({ type: "progress", page: p + 1, total: OY_MAX_PAGES, message: `최대 ${OY_MAX_REVIEWS}개 도달, 수집 완료` });
          break;
        }

        if (p < OY_MAX_PAGES - 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err) {
        send({ type: "error", message: `p${p}: ${String(err).slice(0, 100)}` });
        break;
      }
    }
  } finally {
    // 수집 완료 즉시 브라우저 종료 → 메모리 반환
    await browser.close();
  }

  return allReviews;
}

const OY_REVIEW_IMG_CDN = "https://image.oliveyoung.co.kr/uploads/images/gdasEditor/";

function parseOliveYoungReviewApi(data: unknown[]): ProductReview[] {
  const reviews: ProductReview[] = [];

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const text = (r.content as string) || (r.reviewContent as string) || "";
    if (!text) continue;

    // Extract review images from photoReviewList
    const images: ReviewImage[] = [];
    const photoList = (r.photoReviewList as unknown[]) || [];
    for (const photo of photoList) {
      if (!photo || typeof photo !== "object") continue;
      const p = photo as Record<string, unknown>;
      const imagePath = (p.imagePath as string) || "";
      if (imagePath) {
        const originalUrl = `${OY_REVIEW_IMG_CDN}${imagePath}`;
        const thumbnailUrl = `${OY_REVIEW_IMG_CDN}${imagePath}?RS=200x0&QT=80`;
        images.push({ originalUrl, thumbnailUrl });
      }
    }

    // Profile info
    const profile = r.profileDto as Record<string, unknown> | undefined;
    const goodsDto = r.goodsDto as Record<string, unknown> | undefined;

    reviews.push({
      id: String(r.reviewId ?? `oy-${Date.now()}-${Math.random()}`),
      text: text.slice(0, 500),
      rating: Math.min(5, Math.max(1, Number(r.reviewScore ?? 5))),
      images,
      reviewerName: (profile?.memberNickname as string) || (r.memberNickname as string) || "",
      purchaseOption: (goodsDto?.optionName as string) || "",
      date: (r.createdDateTime as string) || "",
    });
  }

  return reviews;
}

// ─── Collection builder ───────────────────────────────────────────────────────

function buildReviewCollection(reviews: ProductReview[]): ReviewCollection {
  if (reviews.length === 0) {
    return {
      reviews: [],
      totalCount: 0,
      averageRating: 0,
      ratingDistribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      themes: [],
    };
  }

  const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let totalRating = 0;
  for (const r of reviews) {
    const star = Math.min(5, Math.max(1, Math.round(r.rating)));
    dist[String(star)] = (dist[String(star)] || 0) + 1;
    totalRating += r.rating;
  }
  const averageRating = Math.round((totalRating / reviews.length) * 10) / 10;

  const themeMap = new Map<
    string,
    { sentiment: "positive" | "negative" | "neutral"; count: number; samples: string[] }
  >();
  for (const kw of REVIEW_KEYWORDS) {
    themeMap.set(kw.keyword, { sentiment: kw.sentiment, count: 0, samples: [] });
  }

  for (const review of reviews) {
    for (const kw of REVIEW_KEYWORDS) {
      if (review.text.includes(kw.keyword)) {
        const entry = themeMap.get(kw.keyword)!;
        entry.count++;
        if (entry.samples.length < 3) entry.samples.push(review.text.slice(0, 100));
      }
    }
  }

  const themes: ReviewTheme[] = Array.from(themeMap.entries())
    .filter(([, v]) => v.count > 0)
    .map(([keyword, v]) => ({
      keyword,
      sentiment: v.sentiment,
      count: v.count,
      sampleTexts: v.samples,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return { reviews, totalCount: reviews.length, averageRating, ratingDistribution: dist, themes };
}
