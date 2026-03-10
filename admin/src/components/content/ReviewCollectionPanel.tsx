"use client";

import { useState } from "react";
import type { ReviewCollection, ProductReview } from "@/app/content/types";

type Props = {
  collection: ReviewCollection | null;
  isLoading: boolean;
  progress: { page: number; total: number; message: string };
  debugLog?: string[];  // 수집 중 발생한 진단/오류 메시지 누적
  onProceed: () => void;
  onAddManualReview?: (review: ProductReview) => void;
};

export default function ReviewCollectionPanel({
  collection,
  isLoading,
  progress,
  debugLog = [],
  onProceed,
  onAddManualReview,
}: Props) {
  const [showManual, setShowManual] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualRating, setManualRating] = useState(5);

  const handleAddManual = () => {
    if (!manualText.trim() || !onAddManualReview) return;
    onAddManualReview({
      text: manualText.trim(),
      rating: manualRating,
    });
    setManualText("");
    setManualRating(5);
    setShowManual(false);
  };

  const ratingColors: Record<string, string> = {
    "5": "bg-emerald-500",
    "4": "bg-cyan-500",
    "3": "bg-yellow-500",
    "2": "bg-orange-500",
    "1": "bg-red-500",
  };

  const sentimentColors: Record<string, string> = {
    positive: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    negative: "bg-red-500/10 text-red-400 border-red-500/20",
    neutral: "bg-gray-700/50 text-gray-400 border-gray-700",
  };

  const maxDist = collection
    ? Math.max(...Object.values(collection.ratingDistribution))
    : 1;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">리뷰 수집</h3>
          <p className="text-gray-400 text-sm mt-1">
            네이버 실구매자 리뷰를 분석해 콘텐츠 소스로 활용합니다.
          </p>
        </div>
        {collection && !isLoading && (
          <button
            onClick={onProceed}
            className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 transition-all shadow-lg shadow-emerald-500/20"
          >
            사이트 선택으로 →
          </button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-emerald-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-gray-300">{progress.message}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress.total > 0 ? (progress.page / progress.total) * 100 : 10}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {collection && collection.totalCount > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{collection.totalCount}</p>
              <p className="text-gray-400 text-xs mt-1">수집된 리뷰</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">★ {collection.averageRating}</p>
              <p className="text-gray-400 text-xs mt-1">평균 평점</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-cyan-400">
                {collection.reviews.reduce((sum, r) => sum + (r.images?.length || 0), 0)}
              </p>
              <p className="text-gray-400 text-xs mt-1">수집된 사진</p>
            </div>
          </div>

          {/* Rating distribution */}
          <div className="space-y-2">
            <h5 className="text-sm font-medium text-gray-300">평점 분포</h5>
            {["5", "4", "3", "2", "1"].map((star) => {
              const count = collection.ratingDistribution[star] || 0;
              const pct = maxDist > 0 ? (count / maxDist) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-3 text-xs">
                  <span className="text-yellow-400 w-6">{"★".repeat(Number(star))}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div
                      className={`${ratingColors[star]} h-full rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-gray-400 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>

          {/* Theme keywords */}
          {collection.themes.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium text-gray-300">주요 키워드 테마</h5>
              <div className="flex flex-wrap gap-2">
                {collection.themes.map((theme) => (
                  <span
                    key={theme.keyword}
                    className={`px-3 py-1 text-xs rounded-full border ${sentimentColors[theme.sentiment]}`}
                    title={theme.sampleTexts[0] || ""}
                  >
                    {theme.keyword} ×{theme.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Review list */}
          <div className="space-y-2">
            <h5 className="text-sm font-medium text-gray-300">
              리뷰 목록 ({collection.reviews.length}개)
            </h5>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {collection.reviews.slice(0, 20).map((review, i) => (
                <div key={review.id || i} className="bg-gray-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-yellow-400">{"★".repeat(Math.round(review.rating))}</span>
                    {review.reviewerName && (
                      <span className="text-gray-500">{review.reviewerName}</span>
                    )}
                    {review.purchaseOption && (
                      <span className="text-gray-600">[{review.purchaseOption}]</span>
                    )}
                    {review.date && (
                      <span className="text-gray-600 ml-auto">{review.date.slice(0, 10)}</span>
                    )}
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed line-clamp-3">{review.text}</p>
                  {review.images && review.images.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {review.images.map((img, j) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={j}
                          src={img.thumbnailUrl || img.originalUrl}
                          alt="리뷰 사진"
                          className="w-16 h-16 object-cover rounded-lg bg-gray-700"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* No reviews found */}
      {collection && collection.totalCount === 0 && !isLoading && (
        <div className="space-y-4">
          <div className="text-center py-6 text-gray-400">
            <p>수집된 리뷰가 없습니다.</p>
            <p className="text-sm mt-1">수동으로 리뷰를 추가하거나 컨텐츠 설정으로 진행하세요.</p>
          </div>
          {/* 진단 로그 표시 (개발/디버깅용) */}
          {debugLog.length > 0 && (
            <details className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-xs">
              <summary className="text-yellow-400 cursor-pointer font-medium mb-2">
                ⚠️ 수집 진단 로그 ({debugLog.length}건) — 클릭하여 펼치기
              </summary>
              <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
                {debugLog.map((msg, i) => (
                  <p key={i} className="text-gray-300 font-mono break-all leading-relaxed">
                    {i + 1}. {msg}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Manual review add */}
      {collection && onAddManualReview && (
        <div className="border-t border-gray-800 pt-4">
          {showManual ? (
            <div className="space-y-3">
              <h5 className="text-sm font-medium text-gray-300">리뷰 수동 추가</h5>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={4}
                placeholder="리뷰 내용을 입력하세요..."
                className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400">평점:</label>
                  <select
                    value={manualRating}
                    onChange={(e) => setManualRating(Number(e.target.value))}
                    className="px-3 py-1 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm"
                  >
                    {[5, 4, 3, 2, 1].map((v) => (
                      <option key={v} value={v}>
                        {"★".repeat(v)} ({v}점)
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleAddManual}
                  className="px-4 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                >
                  추가
                </button>
                <button
                  onClick={() => setShowManual(false)}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowManual(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              + 리뷰 수동 추가
            </button>
          )}
        </div>
      )}
    </div>
  );
}
