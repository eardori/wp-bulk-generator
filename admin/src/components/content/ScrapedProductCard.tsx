"use client";

import type { ScrapedProduct } from "@/app/content/types";

type Props = {
  product: ScrapedProduct;
  onRescrape: () => void;
};

export default function ScrapedProductCard({ product, onRescrape }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">
      <div className="flex items-start justify-between">
        <h3 className="text-xl font-semibold text-white">스크랩 결과</h3>
        <button
          onClick={onRescrape}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          다시 입력
        </button>
      </div>

      <div className="flex gap-6">
        {/* Images */}
        {product.images.length > 0 && (
          <div className="flex-shrink-0">
            <img
              src={product.images[0]}
              alt={product.title}
              className="w-32 h-32 object-cover rounded-xl bg-gray-800"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            {product.images.length > 1 && (
              <div className="flex gap-1 mt-2">
                {product.images.slice(1, 4).map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt=""
                    className="w-10 h-10 object-cover rounded bg-gray-800"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 space-y-3">
          <h4 className="text-lg font-medium text-white">{product.title}</h4>

          <div className="flex flex-wrap gap-3 text-sm">
            {product.price && (
              <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {product.price}
              </span>
            )}
            {product.brand && (
              <span className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {product.brand}
              </span>
            )}
            {product.rating !== null && (
              <span className="px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                ★ {product.rating} ({product.reviewCount}개 리뷰)
              </span>
            )}
            <span className="px-2 py-1 rounded-lg bg-gray-700/50 text-gray-400 border border-gray-700">
              {product.source}
            </span>
            {product.reviewApiParams ? (
              <span className="px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs">
                리뷰 API 연동 가능
              </span>
            ) : (
              <span className="px-2 py-1 rounded-lg bg-gray-700/30 text-gray-500 border border-gray-700/50 text-xs">
                리뷰 API 없음
              </span>
            )}
          </div>

          {product.description && (
            <p className="text-gray-400 text-sm leading-relaxed line-clamp-3">
              {product.description}
            </p>
          )}
        </div>
      </div>

      {/* Specs */}
      {Object.keys(product.specs).length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium text-gray-300">제품 스펙</h5>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(product.specs)
              .slice(0, 8)
              .map(([key, val]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-gray-500">{key}:</span>
                  <span className="text-gray-300">{val}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {product.reviews.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium text-gray-300">
            리뷰 ({product.reviews.length}개)
          </h5>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {product.reviews.slice(0, 5).map((review, i) => (
              <div key={i} className="text-sm bg-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-yellow-400 text-xs">
                    {"★".repeat(review.rating)}
                  </span>
                </div>
                <p className="text-gray-400 line-clamp-2">{review.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
