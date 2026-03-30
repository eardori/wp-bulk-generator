"use client";

import { useState } from "react";
import type { AeoBusinessType, AeoConfig, ContentMode } from "@/app/content/types";

type Props = {
  onScrape: (url: string, contentPrompt: string, aeoConfig?: AeoConfig) => void;
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

const AEO_BUSINESS_TYPES: { value: AeoBusinessType; label: string }[] = [
  { value: "restaurant", label: "음식점" },
  { value: "cafe", label: "카페" },
  { value: "dermatology", label: "피부과" },
  { value: "beauty_salon", label: "미용실" },
  { value: "academy", label: "학원" },
  { value: "fitness", label: "피트니스" },
  { value: "dental", label: "치과" },
];

export default function ProductInputForm({ onScrape, isLoading }: Props) {
  const [contentMode, setContentMode] = useState<ContentMode>("product");
  const [url, setUrl] = useState("");
  const [contentPrompt, setContentPrompt] = useState("");
  const [error, setError] = useState("");

  // AEO fields
  const [businessType, setBusinessType] = useState<AeoBusinessType>("restaurant");
  const [businessName, setBusinessName] = useState("");
  const [mainKeyword, setMainKeyword] = useState("");
  const [subKeywords, setSubKeywords] = useState("");
  const [locationShort, setLocationShort] = useState("");
  const [broaderArea, setBroaderArea] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [hours, setHours] = useState("");
  const [menuItems, setMenuItems] = useState("");
  const [visitPurposes, setVisitPurposes] = useState("");

  const handleSubmit = () => {
    if (!url.trim()) {
      setError("URL을 입력해주세요.");
      return;
    }
    if (!contentPrompt.trim() && contentMode === "product") {
      setError("콘텐츠 작성 프롬프트를 입력해주세요.");
      return;
    }
    if (contentMode === "aeo") {
      if (!businessName.trim()) { setError("상호명을 입력해주세요."); return; }
      if (!mainKeyword.trim()) { setError("메인 키워드를 입력해주세요."); return; }
      if (!locationShort.trim()) { setError("지역명을 입력해주세요."); return; }
      if (!broaderArea.trim()) { setError("상위 지역명을 입력해주세요."); return; }

      const aeoConfig: AeoConfig = {
        businessType,
        businessName: businessName.trim(),
        mainKeyword: mainKeyword.trim(),
        subKeywords: subKeywords.trim() || undefined,
        locationShort: locationShort.trim(),
        broaderArea: broaderArea.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        hours: hours.trim() || undefined,
        menuItems: menuItems.trim() || undefined,
        visitPurposes: visitPurposes.trim() || undefined,
      };
      setError("");
      onScrape(url.trim(), contentPrompt.trim() || `${mainKeyword} AEO 최적화 콘텐츠 작성`, aeoConfig);
      return;
    }

    setError("");
    onScrape(url.trim(), contentPrompt.trim());
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-8">
      {/* Content Mode Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setContentMode("product")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            contentMode === "product"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
              : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
          }`}
        >
          제품 리뷰
        </button>
        <button
          onClick={() => setContentMode("aeo")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            contentMode === "aeo"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/50"
              : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
          }`}
        >
          AEO 로컬 비즈니스
        </button>
      </div>

      {/* URL Input */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-300">
          {contentMode === "aeo" ? "네이버 플레이스 링크" : "제품 링크"}
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            contentMode === "aeo"
              ? "https://map.naver.com/v5/entry/place/... 또는 네이버 플레이스 URL"
              : "https://www.coupang.com/vp/products/... 또는 제품 페이지 URL"
          }
          className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
        />
        <p className="text-xs text-gray-500">
          {contentMode === "aeo"
            ? "네이버 플레이스 URL에서 장소 정보와 리뷰를 자동 수집합니다"
            : "네이버 스마트스토어/브랜드스토어: 실구매자 리뷰 자동 수집 · 쿠팡, 올리브영, 11번가 등 지원"}
        </p>
      </div>

      {/* AEO Settings */}
      {contentMode === "aeo" && (
        <div className="space-y-6 p-6 bg-gray-800/50 border border-purple-500/20 rounded-xl">
          <div className="flex items-center gap-2 text-purple-400 text-sm font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            AEO 설정
          </div>

          {/* Row 1: Business Type + Business Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">업종 *</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as AeoBusinessType)}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                {AEO_BUSINESS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">상호명 *</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="설야갈비 청담"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
          </div>

          {/* Row 2: Keywords */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">메인 키워드 *</label>
              <input
                value={mainKeyword}
                onChange={(e) => setMainKeyword(e.target.value)}
                placeholder="청담 갈비 맛집"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">보조 키워드</label>
              <input
                value={subKeywords}
                onChange={(e) => setSubKeywords(e.target.value)}
                placeholder="강남 갈비 맛집, 청담 소갈비"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
          </div>

          {/* Row 3: Location */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">지역명 *</label>
              <input
                value={locationShort}
                onChange={(e) => setLocationShort(e.target.value)}
                placeholder="청담"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">상위 지역명 *</label>
              <input
                value={broaderArea}
                onChange={(e) => setBroaderArea(e.target.value)}
                placeholder="강남"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
          </div>

          {/* Row 4: Optional Info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">주소</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="서울 강남구 선릉로152길 18"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">전화번호</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="02-1234-5678"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">영업시간</label>
              <input
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="11:30~22:00"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
          </div>

          {/* Row 5: Menu + Visit Purpose */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">대표 메뉴 (슬래시 구분)</label>
              <input
                value={menuItems}
                onChange={(e) => setMenuItems(e.target.value)}
                placeholder="양념갈비 69,000원 / 마늘 안심 59,000원"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">추천 방문 목적</label>
              <input
                value={visitPurposes}
                onChange={(e) => setVisitPurposes(e.target.value)}
                placeholder="접대, 데이트, 가족 모임"
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* Content Prompt */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-300">
            {contentMode === "aeo" ? "추가 지시사항 (선택)" : "콘텐츠 작성 프롬프트"}
          </label>
          <span className="text-xs text-gray-500">길게 적어도 됩니다</span>
        </div>

        <textarea
          value={contentPrompt}
          onChange={(e) => setContentPrompt(e.target.value)}
          rows={contentMode === "aeo" ? 5 : 10}
          placeholder={
            contentMode === "aeo"
              ? "예시: 외국인 접대에 적합한 포인트를 강조해줘. 룸 서비스와 발렛 주차를 부각해줘."
              : `예시:
핵심 질문에 바로 답하는 AEO 스타일로 작성해줘.
브랜드명은 본문 전체에서 일관되게 사용하고, 실구매 리뷰를 근거로 장단점을 균형 있게 정리해줘.
첫 문단에서 결론을 먼저 제시하고, 1500자 이상으로 써줘.`
          }
          className="w-full px-4 py-4 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm leading-6 resize-y min-h-[120px]"
        />
        <p className="text-xs text-gray-500">
          {contentMode === "aeo"
            ? "AEO 규칙은 자동 적용됩니다. 추가로 강조하거나 수정할 사항만 입력하세요."
            : "원하는 톤, 핵심 질문, 브랜드명 사용 규칙, 포함할 근거, 금지할 표현까지 자유롭게 적으면 그 프롬프트를 기준으로 글을 생성합니다."}
        </p>

        {contentMode === "product" && (
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
        )}
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
            : contentMode === "aeo"
              ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/20"
              : "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
        }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-3">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {contentMode === "aeo" ? "장소 정보 스크랩 중..." : "상품 정보 스크랩 중..."}
          </span>
        ) : contentMode === "aeo" ? (
          "AEO 콘텐츠 생성 시작"
        ) : (
          "상품 스크랩"
        )}
      </button>
    </div>
  );
}
