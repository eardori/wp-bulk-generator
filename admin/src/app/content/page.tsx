"use client";

import { useState } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";
import type {
  ContentStep,
  ContentArticleConfig,
  ScrapedProduct,
  SiteCredential,
  GeneratedArticle,
  ReviewCollection,
  ProductReview,
} from "./types";
import ProductInputForm from "@/components/content/ProductInputForm";
import ScrapedProductCard from "@/components/content/ScrapedProductCard";
import ArticlePreviewList from "@/components/content/ArticlePreviewList";
import PublishProgress from "@/components/content/PublishProgress";
import ManualProductForm from "@/components/content/ManualProductForm";
import ReviewCollectionPanel from "@/components/content/ReviewCollectionPanel";
import ContentConfigPanel from "@/components/content/ContentConfigPanel";

export default function ContentPage() {
  const [step, setStep] = useState<ContentStep>("input");
  const [productUrl, setProductUrl] = useState("");
  const [contentPrompt, setContentPrompt] = useState("");
  const [product, setProduct] = useState<ScrapedProduct | null>(null);
  const [sites, setSites] = useState<SiteCredential[]>([]);
  const [selectedSites, setSelectedSites] = useState<SiteCredential[]>([]);
  const [articles, setArticles] = useState<GeneratedArticle[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });
  const [pubProgress, setPubProgress] = useState({ current: 0, total: 0 });
  const [reviewCollection, setReviewCollection] = useState<ReviewCollection | null>(null);
  const [reviewProgress, setReviewProgress] = useState({ page: 0, total: 5, message: "" });
  const [reviewDebugLog, setReviewDebugLog] = useState<string[]>([]); // 리뷰 수집 진단 로그

  // 이어서 생성을 위한 저장 상태
  const [savedSiteConfigs, setSavedSiteConfigs] = useState<{ site: SiteCredential; count: number }[]>([]);
  const [savedTotalArticles, setSavedTotalArticles] = useState(0);

  // Step 1 → 2: Scrape product
  const handleScrape = async (url: string, prompt: string) => {
    setProductUrl(url);
    setContentPrompt(prompt);
    setStep("scraping");
    setLog(["상품 페이지 스크랩 중..."]);

    try {
      const res = await fetch("/api/content/scrape-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();

      if (data.needManual && !data.product) {
        setLog((prev) => [...prev, data.error || "스크랩 실패, 수동 입력으로 전환"]);
        setStep("manual");
        fetchSites();
        return;
      }

      if (data.product) {
        setProduct(data.product);
      } else if (data.partialProduct) {
        setProduct(data.partialProduct);
      }

      await fetchSites();
      setStep("scraped");
    } catch (err) {
      const message =
        err instanceof Error && err.name === "TimeoutError"
          ? "스크랩 시간이 초과되었습니다. 수동 입력으로 전환합니다."
          : `오류: ${err}`;
      setLog((prev) => [...prev, message]);
      setStep("manual");
      fetchSites();
    }
  };

  const fetchSites = async () => {
    try {
      const sitesRes = await fetch("/api/content/fetch-sites");
      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        let allSites: SiteCredential[] = sitesData.sites || [];

        // Check for group preselection from /groups page
        const groupFilter = sessionStorage.getItem("preselectedGroupSlugs");
        const groupName = sessionStorage.getItem("preselectedGroupName");
        if (groupFilter) {
          const slugs: string[] = JSON.parse(groupFilter);
          if (slugs.length > 0) {
            allSites = allSites.filter((s) => slugs.includes(s.slug));
          }
          sessionStorage.removeItem("preselectedGroupSlugs");
          sessionStorage.removeItem("preselectedGroupName");
          if (groupName) {
            setLog((prev) => [...prev, `그룹 '${groupName}' 사이트 ${allSites.length}개 적용됨`]);
          }
        }

        setSites(allSites);
      }
    } catch { /* ignore */ }
  };

  // Manual product input
  const handleManualProduct = (manualProduct: ScrapedProduct) => {
    setProduct(manualProduct);
    setStep("scraped");
  };

  // Step 2 → 3: Fetch reviews
  const handleFetchReviews = async () => {
    if (!product?.reviewApiParams) {
      // Non-Naver/OliveYoung: skip directly to content config
      setStep("content-config");
      return;
    }

    setStep("fetching-reviews");
    setReviewProgress({ page: 0, total: 5, message: "리뷰 수집 준비 중..." });
    setReviewCollection(null);
    setReviewDebugLog([]);

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/content/fetch-reviews",
        body: { reviewApiParams: product.reviewApiParams },
      });

      const allReviews: ProductReview[] = [];

      await readSSEStream(reader, (data) => {
        if (data.type === "progress") {
          setReviewProgress({ page: (data.page as number) || 0, total: (data.total as number) || 5, message: data.message as string });
        } else if (data.type === "reviews") {
          allReviews.push(...((data.reviews as ProductReview[]) || []));
        } else if (data.type === "done") {
          setReviewCollection(data.collection as ReviewCollection);
          setStep("reviews-ready");
        } else if (data.type === "error") {
          setReviewDebugLog((prev) => [...prev, data.message as string]);
          setLog((prev) => [...prev, `리뷰 수집 오류: ${data.message}`]);
        }
      });

      if (allReviews.length > 0) {
        setStep("reviews-ready");
      }
    } catch (err) {
      setLog((prev) => [...prev, `리뷰 수집 실패: ${err}. 계속 진행합니다.`]);
      setStep("reviews-ready");
    }
  };

  const handleAddManualReview = (review: ProductReview) => {
    setReviewCollection((prev) => {
      if (!prev) {
        return {
          reviews: [review],
          totalCount: 1,
          averageRating: review.rating,
          ratingDistribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, [String(review.rating)]: 1 },
          themes: [],
        };
      }
      return { ...prev, reviews: [...prev.reviews, review], totalCount: prev.totalCount + 1 };
    });
  };

  // SSE 스트림 읽기 헬퍼 (bridge 직접 연결용)
  const readArticleStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    totalArticles: number,
    onArticle: (a: GeneratedArticle) => void,
  ) => {
    await readSSEStream(reader, (data) => {
      if (data.type === "progress") {
        setGenProgress({ current: (data.current as number) ?? 0, total: (data.total as number) ?? totalArticles });
        setLog((prev) => [...prev, data.message as string]);
      } else if (data.type === "article") {
        onArticle(data.article as GeneratedArticle);
      } else if (data.type === "error") {
        setLog((prev) => [...prev, `⚠ ${data.message}`]);
      }
    });
  };

  // 핵심 생성 로직 — startOffset으로 이어서 생성 지원
  const runGeneration = async (
    siteConfigs: { site: SiteCredential; count: number }[],
    totalArticles: number,
    startOffset: number,
    existingArticles: GeneratedArticle[],
  ) => {
    const BATCH_SIZE = 12;
    const collectedArticles: GeneratedArticle[] = [...existingArticles];

    setStep("generating");
    setGenProgress({ current: startOffset, total: totalArticles });
    if (startOffset === 0) {
      setLog([`AI 콘텐츠 생성 시작 — 총 ${totalArticles}개 (3개 병렬, 12개 배치)...`]);
    } else {
      setLog((prev) => [...prev, `▶ ${startOffset}개 이어서 — 나머지 ${totalArticles - startOffset}개 생성 시작...`]);
    }

    try {
      for (let offset = startOffset; offset < totalArticles; offset += BATCH_SIZE) {
        const batchLimit = Math.min(BATCH_SIZE, totalArticles - offset);
        setLog((prev) => [
          ...prev,
          `── 배치 ${offset + 1}~${offset + batchLimit} / ${totalArticles} 처리 중...`,
        ]);

        let reader: ReadableStreamDefaultReader<Uint8Array>;
        try {
          const result = await bridgeSSE({
            vercelEndpoint: "/api/content/generate-articles",
            body: {
              product,
              contentPrompt,
              siteConfigs,
              reviewCollection,
              offset,
              limit: batchLimit,
              globalTotal: totalArticles,
            },
          });
          reader = result.reader;
        } catch (fetchErr) {
          setLog((prev) => [...prev, `⚠ 네트워크 오류 (배치 ${offset + 1}): ${fetchErr} — 재시도 중...`]);
          await new Promise((r) => setTimeout(r, 5000));
          offset -= BATCH_SIZE; // 같은 offset 재시도
          continue;
        }

        await readArticleStream(reader, totalArticles, (article) => {
          collectedArticles.push(article);
          setArticles([...collectedArticles]);
        });
      }

      if (collectedArticles.length === 0) {
        setLog((prev) => [
          ...prev,
          "생성된 글이 없습니다. 사이트 설정 또는 페르소나 데이터를 확인한 뒤 다시 시도해주세요.",
        ]);
        setStep("error");
        return;
      }

      setArticles(collectedArticles);
      setStep("preview");

      if (collectedArticles.length < totalArticles) {
        setLog((prev) => [
          ...prev,
          `⚠ ${collectedArticles.length}/${totalArticles}개 완료. 아래 '이어서 생성' 버튼으로 나머지를 생성할 수 있습니다.`,
        ]);
      } else {
        setLog((prev) => [...prev, `✅ 전체 ${collectedArticles.length}개 생성 완료!`]);
      }
    } catch (err) {
      setLog((prev) => [...prev, `오류: ${err}`]);
      if (collectedArticles.length > 0) {
        setArticles(collectedArticles);
        setStep("preview");
      } else {
        setStep("error");
      }
    }
  };

  // Step 3 → 4: Content config → Generate articles
  const handleGenerate = async (configs: ContentArticleConfig[]) => {
    const siteConfigs = configs
      .filter((c) => c.enabled)
      .map((c) => ({ site: sites.find((s) => s.slug === c.siteSlug)!, count: c.count }))
      .filter((sc) => sc.site);

    const totalArticles = siteConfigs.reduce((sum, sc) => sum + sc.count, 0);

    if (siteConfigs.length === 0 || totalArticles === 0) {
      setLog((prev) => [
        ...prev,
        "생성할 사이트를 찾지 못했습니다. 사이트 목록을 다시 불러온 뒤 재시도해주세요.",
      ]);
      setStep("error");
      return;
    }

    setSelectedSites(siteConfigs.map((sc) => sc.site));
    setSavedSiteConfigs(siteConfigs);
    setSavedTotalArticles(totalArticles);
    setArticles([]);

    await runGeneration(siteConfigs, totalArticles, 0, []);
  };

  // 이어서 생성 — 이미 생성된 articles.length 이후부터 재개
  const handleResumeGeneration = async () => {
    const startOffset = articles.length;
    if (startOffset >= savedTotalArticles || savedSiteConfigs.length === 0) return;
    await runGeneration(savedSiteConfigs, savedTotalArticles, startOffset, articles);
  };

  // Step 5: Publish
  const handlePublish = async (toPublish: GeneratedArticle[]) => {
    setStep("publishing");
    setPubProgress({ current: 0, total: toPublish.length });
    setLog((prev) => [...prev, "WordPress 발행 시작..."]);

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/content/publish-articles",
        body: { articles: toPublish, sites: selectedSites },
      });

      await readSSEStream(reader, (data) => {
        if (data.type === "progress") {
          setPubProgress((prev) => ({
            current: (data.current as number) ?? prev.current,
            total: (data.total as number) ?? prev.total,
          }));
          setLog((prev) => [...prev, data.message as string]);
          if (data.articleId) {
            setArticles((prev) =>
              prev.map((a) =>
                a.id === data.articleId
                  ? { ...a, status: "publishing" as const, error: undefined }
                  : a
              )
            );
          }
        } else if (data.type === "published") {
          setArticles((prev) =>
            prev.map((a) =>
              a.id === data.articleId
                ? {
                    ...a,
                    status: "published" as const,
                    publishedUrl: data.postUrl as string,
                    publishedPostId: data.postId as number,
                    error: undefined,
                  }
                : a
            )
          );
        } else if (data.type === "done") {
          setStep("done");
        } else if (data.type === "error") {
          setLog((prev) => [...prev, `오류 [${data.siteSlug || "publish"}]: ${data.message}`]);
          if (data.articleId) {
            setArticles((prev) =>
              prev.map((a) =>
                a.id === data.articleId
                  ? { ...a, status: "error" as const, error: data.message as string }
                  : a
              )
            );
          }
        }
      });

      if (step !== "done") setStep("done");
    } catch (err) {
      setLog((prev) => [...prev, `오류: ${err}`]);
      setStep("error");
    }
  };

  const handleReset = () => {
    setStep("input");
    setProductUrl("");
    setContentPrompt("");
    setProduct(null);
    setArticles([]);
    setLog([]);
    setGenProgress({ current: 0, total: 0 });
    setPubProgress({ current: 0, total: 0 });
    setReviewCollection(null);
    setReviewProgress({ page: 0, total: 5, message: "" });
    setSavedSiteConfigs([]);
    setSavedTotalArticles(0);
  };

  // Step indicator
  const STEPS: { label: string; keys: ContentStep[] }[] = [
    { label: "입력", keys: ["input", "scraping"] },
    { label: "스크랩", keys: ["scraped"] },
    { label: "리뷰수집", keys: ["fetching-reviews", "reviews-ready"] },
    { label: "컨텐츠 설정", keys: ["content-config"] },
    { label: "글 생성", keys: ["generating", "preview"] },
    { label: "발행", keys: ["publishing", "done"] },
  ];

  const currentStepIdx = STEPS.findIndex((s) => s.keys.includes(step));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">콘텐츠 제작</h2>
        <p className="text-gray-400 mt-1">
          제품 링크와 작성 프롬프트를 입력하면, 실구매자 리뷰 분석 기반으로 페르소나별 SEO 글을 자동 생성합니다.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {STEPS.map(({ label }, i) => {
          const isActive = i <= Math.max(currentStepIdx, 0);
          const isCurrent = i === currentStepIdx;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className={`w-8 h-px ${isActive ? "bg-emerald-500" : "bg-gray-700"}`} />}
              <span
                className={`px-2.5 py-1 rounded-full ${
                  isCurrent
                    ? "bg-emerald-500 text-white font-semibold"
                    : isActive
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-gray-800 text-gray-500"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Input */}
      {(step === "input" || step === "scraping") && (
        <ProductInputForm onScrape={handleScrape} isLoading={step === "scraping"} />
      )}

      {/* Step Manual: Manual product input */}
      {step === "manual" && (
        <ManualProductForm
          productUrl={productUrl}
          errorMessage={log[log.length - 1]}
          onSubmit={handleManualProduct}
          onBack={() => setStep("input")}
        />
      )}

      {/* Step 2: Scraped */}
      {step === "scraped" && product && (
        <div className="space-y-6 animate-slide-in">
          <ScrapedProductCard product={product} onRescrape={() => setStep("input")} />
          <div className="flex gap-4">
            <button
              onClick={() => setStep("input")}
              className="px-4 py-2.5 text-sm rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              ← 다시 입력
            </button>
            <button
              onClick={handleFetchReviews}
              className="flex-1 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 transition-all shadow-lg shadow-emerald-500/20"
            >
              {product.reviewApiParams ? "리뷰 수집 시작 →" : "컨텐츠 설정으로 →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review collection */}
      {(step === "fetching-reviews" || step === "reviews-ready") && (
        <div className="space-y-6 animate-slide-in">
          {product && <ScrapedProductCard product={product} onRescrape={() => setStep("scraped")} />}
          <ReviewCollectionPanel
            collection={reviewCollection}
            isLoading={step === "fetching-reviews"}
            progress={reviewProgress}
            debugLog={reviewDebugLog}
            onProceed={() => setStep("reviews-ready")}
            onAddManualReview={handleAddManualReview}
          />
          {step === "reviews-ready" && (
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep("scraped")}
                className="px-4 py-2.5 text-sm rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                ← 이전
              </button>
              <button
                onClick={() => setStep("content-config")}
                className="px-8 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 transition-all shadow-lg shadow-emerald-500/20"
              >
                컨텐츠 설정으로 →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Content config (페르소나별 갯수 선택) */}
      {step === "content-config" && (
        <ContentConfigPanel
          sites={sites}
          contentPrompt={contentPrompt}
          onGenerate={handleGenerate}
          onBack={() => (reviewCollection ? setStep("reviews-ready") : setStep("scraped"))}
        />
      )}

      {/* Step 5: Generating */}
      {step === "generating" && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 animate-slide-in">
          <div className="flex items-center gap-3 mb-4">
            <svg className="animate-spin h-5 w-5 text-emerald-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <h3 className="text-xl font-semibold text-white">
              AI 콘텐츠 생성 중... ({genProgress.current}/{genProgress.total})
            </h3>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 mb-4">
            <div
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${genProgress.total > 0 ? (genProgress.current / genProgress.total) * 100 : 0}%` }}
            />
          </div>
          {log.length > 0 && (
            <p className="text-gray-400 text-sm">{log[log.length - 1]}</p>
          )}
          {articles.length > 0 && (
            <p className="text-emerald-400 text-sm mt-1">{articles.length}개 글 생성 완료, 계속 생성 중...</p>
          )}
        </div>
      )}

      {/* Step 6: Preview */}
      {step === "preview" && articles.length === 0 && (
        <div className="bg-gray-900 border border-yellow-500/30 rounded-2xl p-8 text-center space-y-4 animate-slide-in">
          <p className="text-yellow-300 text-lg font-semibold">생성된 글이 없습니다</p>
          <p className="text-gray-400 text-sm">
            {log[log.length - 1] || "생성 중 오류가 발생했습니다. 사이트 설정을 다시 확인해주세요."}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => setStep("content-config")}
              className="px-6 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              설정으로 돌아가기
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold hover:from-emerald-600 hover:to-cyan-600 transition-all"
            >
              처음으로
            </button>
          </div>
        </div>
      )}

      {step === "preview" && articles.length > 0 && (
        <div className="space-y-4">
          {/* 이어서 생성 배너 */}
          {articles.length < savedTotalArticles && savedSiteConfigs.length > 0 && (
            <div className="flex items-center justify-between px-5 py-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20">
              <div>
                <p className="text-yellow-300 font-semibold text-sm">
                  ⚠ {articles.length}/{savedTotalArticles}개 생성됨
                </p>
                <p className="text-yellow-400/70 text-xs mt-0.5">
                  나머지 {savedTotalArticles - articles.length}개가 생성되지 않았습니다.
                </p>
              </div>
              <button
                onClick={handleResumeGeneration}
                className="px-5 py-2.5 rounded-xl bg-yellow-500 text-black font-semibold text-sm hover:bg-yellow-400 transition-all whitespace-nowrap"
              >
                이어서 {savedTotalArticles - articles.length}개 생성
              </button>
            </div>
          )}
          <ArticlePreviewList
            articles={articles}
            reviewCollection={reviewCollection}
            onArticlesChange={setArticles}
            onPublish={handlePublish}
            onBack={() => setStep("content-config")}
          />
        </div>
      )}

      {/* Step 7: Publishing / Done */}
      {(step === "publishing" || step === "done") && (
        <PublishProgress
          articles={articles}
          progress={pubProgress}
          log={log}
          isDone={step === "done"}
          onReset={handleReset}
        />
      )}

      {/* Error */}
      {step === "error" && (
        <div className="bg-gray-900 border border-red-500/30 rounded-2xl p-8 text-center space-y-4 animate-slide-in">
          <p className="text-red-400 text-lg font-semibold">오류가 발생했습니다</p>
          <p className="text-gray-400 text-sm">{log[log.length - 1]}</p>
          <button
            onClick={handleReset}
            className="px-6 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            처음으로
          </button>
        </div>
      )}
    </div>
  );
}
