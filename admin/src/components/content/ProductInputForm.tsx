"use client";

import { useState } from "react";

type Props = {
  onScrape: (url: string, contentPrompt: string) => void;
  isLoading: boolean;
};

const PROMPT_PRESETS = [
  {
    label: "AEO형",
    prompt:
      "핵심 질문에 직접 답하는 구조로 작성하고, 첫 문단에서 결론을 먼저 제시해줘. 제목과 H2는 검색 의도를 명확하게 드러내고, 브랜드명은 일관되게 사용해줘.",
  },
  {
    label: "후기형",
    prompt:
      "실구매 리뷰를 근거로 장점과 단점을 균형 있게 정리해줘. 과장 없이 신뢰감 있는 톤으로 쓰고, 실제 사용자에게 맞는 경우와 안 맞는 경우를 분리해서 설명해줘.",
  },
  {
    label: "비교형",
    prompt:
      "비슷한 대안과 비교해 선택 포인트가 드러나게 써줘. 가격, 사용감, 추천 대상 차이를 표와 요약 박스로 정리해줘.",
  },
];

export default function ProductInputForm({ onScrape, isLoading }: Props) {
  const [url, setUrl] = useState("");
  const [contentPrompt, setContentPrompt] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!url.trim()) {
      setError("제품 URL을 입력해주세요.");
      return;
    }
    if (!contentPrompt.trim()) {
      setError("콘텐츠 작성 프롬프트를 입력해주세요.");
      return;
    }
    setError("");
    onScrape(url.trim(), contentPrompt.trim());
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-8">
      {/* Product URL */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-300">제품 링크</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.coupang.com/vp/products/... 또는 제품 페이지 URL"
          className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
        />
        <p className="text-xs text-gray-500">네이버 스마트스토어/브랜드스토어: 실구매자 리뷰 자동 수집 · 쿠팡, 올리브영, 11번가 등 지원</p>
      </div>

      {/* Content Prompt */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-300">
            콘텐츠 작성 프롬프트
          </label>
          <span className="text-xs text-gray-500">길게 적어도 됩니다</span>
        </div>

        <textarea
          value={contentPrompt}
          onChange={(e) => setContentPrompt(e.target.value)}
          rows={10}
          placeholder={`예시:
핵심 질문에 바로 답하는 AEO 스타일로 작성해줘.
브랜드명은 본문 전체에서 일관되게 사용하고, 실구매 리뷰를 근거로 장단점을 균형 있게 정리해줘.
첫 문단에서 결론을 먼저 제시하고, 1500자 이상으로 써줘.`}
          className="w-full px-4 py-4 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm leading-6 resize-y min-h-[240px]"
        />
        <p className="text-xs text-gray-500">
          원하는 톤, 핵심 질문, 브랜드명 사용 규칙, 포함할 근거, 금지할 표현까지 자유롭게 적으면 그 프롬프트를 기준으로 글을 생성합니다.
        </p>

        <div className="flex flex-wrap gap-2 pt-2">
          {PROMPT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() =>
                setContentPrompt((prev) =>
                  prev.trim() ? `${prev.trim()}\n\n${preset.prompt}` : preset.prompt
                )
              }
              className="px-3 py-1 text-xs rounded-full border border-gray-700 text-gray-400 hover:border-emerald-500 hover:text-emerald-400 transition-all"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={isLoading}
        className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
          isLoading
            ? "bg-gray-800 text-gray-500 cursor-wait"
            : "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
        }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-3">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            상품 정보 스크랩 중...
          </span>
        ) : (
          "상품 스크랩"
        )}
      </button>
    </div>
  );
}
