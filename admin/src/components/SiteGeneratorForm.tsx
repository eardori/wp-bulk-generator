"use client";

import { useState } from "react";

const NICHE_PRESETS = [
  { label: "화장품/스킨케어", value: "화장품 리뷰" },
  { label: "건강식품/영양제", value: "건강식품 영양제 리뷰" },
  { label: "패션/의류", value: "패션 의류 리뷰" },
  { label: "테크/가전", value: "전자기기 가전 리뷰" },
  { label: "여행/숙소", value: "여행 숙소 리뷰" },
  { label: "반려동물", value: "반려동물 용품 리뷰" },
  { label: "육아/유아용품", value: "육아 유아용품 리뷰" },
  { label: "요리/식품", value: "요리 레시피 식품 리뷰" },
];

export type DomainMode = "subdomain" | "individual";

export type SiteGenerationRequest = {
  niche: string;
  count: number;
  language_ratio: {
    ko: number;
    en: number;
  };
  domain_mode: DomainMode;
  base_domain?: string;
  domain_suffix?: string;
};

type Props = {
  isGenerating: boolean;
  externalError?: string;
  onGenerate: (request: SiteGenerationRequest) => void;
};

export default function SiteGeneratorForm({
  isGenerating,
  externalError = "",
  onGenerate,
}: Props) {
  const [niche, setNiche] = useState("");
  const [count, setCount] = useState(5);
  const [koRatio, setKoRatio] = useState(80);
  const [domainMode, setDomainMode] = useState<DomainMode>("subdomain");
  const [baseDomain, setBaseDomain] = useState("");
  const [domainSuffix, setDomainSuffix] = useState(".site");
  const [validationError, setValidationError] = useState("");

  const handleGenerate = () => {
    if (!niche.trim()) {
      setValidationError("니치(주제)를 입력해주세요.");
      return;
    }

    if (domainMode === "subdomain" && !baseDomain.trim()) {
      setValidationError("베이스 도메인을 입력해주세요. (예: myhealthblog.site)");
      return;
    }

    setValidationError("");

    onGenerate({
      niche: niche.trim(),
      count,
      language_ratio: {
        ko: koRatio / 100,
        en: (100 - koRatio) / 100,
      },
      domain_mode: domainMode,
      base_domain:
        domainMode === "subdomain"
          ? baseDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")
          : undefined,
      domain_suffix: domainMode === "individual" ? domainSuffix : undefined,
    });
  };

  const error = validationError || externalError;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-8">
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-300">니치 (주제)</label>
        <input
          type="text"
          value={niche}
          onChange={(e) => {
            setNiche(e.target.value);
            if (validationError) setValidationError("");
          }}
          placeholder='예: "건강식품 영양제 리뷰"'
          disabled={isGenerating}
          className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all text-lg disabled:opacity-60"
        />
        <div className="flex flex-wrap gap-2">
          {NICHE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              disabled={isGenerating}
              onClick={() => {
                setNiche(preset.value);
                if (validationError) setValidationError("");
              }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-all disabled:opacity-60 ${
                niche === preset.value
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                  : "border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-300">수량</label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={50}
              value={count}
              disabled={isGenerating}
              onChange={(e) => setCount(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-gray-700 accent-emerald-500 disabled:opacity-60"
            />
            <span className="text-2xl font-bold text-emerald-400 w-12 text-right">{count}</span>
          </div>
          <p className="text-xs text-gray-500">
            사이트 {count}개 생성
            {count > 10 && (
              <span className="text-yellow-500 ml-2">
                ({Math.ceil(count / 10)}번 API 호출, 약 {Math.ceil(count / 10) * 15}초~)
              </span>
            )}
          </p>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-300">한국어 비율</label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={koRatio}
              disabled={isGenerating}
              onChange={(e) => setKoRatio(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-gray-700 accent-cyan-500 disabled:opacity-60"
            />
            <span className="text-lg font-semibold text-cyan-400 w-16 text-right">{koRatio}%</span>
          </div>
          <p className="text-xs text-gray-500">
            한국어 {koRatio}% / 영어 {100 - koRatio}%
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block text-sm font-medium text-gray-300">도메인 방식</label>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => setDomainMode("subdomain")}
            className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all disabled:opacity-60 ${
              domainMode === "subdomain"
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                : "border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
          >
            <div className="font-semibold">서브도메인</div>
            <div className="text-xs mt-0.5 opacity-70">도메인 1개로 N개 운영 (추천)</div>
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => setDomainMode("individual")}
            className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all disabled:opacity-60 ${
              domainMode === "individual"
                ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                : "border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
          >
            <div className="font-semibold">개별 도메인</div>
            <div className="text-xs mt-0.5 opacity-70">사이트마다 독립 도메인</div>
          </button>
        </div>

        {domainMode === "subdomain" && (
          <div className="space-y-3">
            <div className="relative">
              <input
                type="text"
                value={baseDomain}
                disabled={isGenerating}
                onChange={(e) => {
                  setBaseDomain(e.target.value);
                  if (validationError) setValidationError("");
                }}
                placeholder="구매한 도메인 입력 (예: myhealthblog.site)"
                className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all disabled:opacity-60"
              />
              {baseDomain && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-400 font-mono">
                  ✓ {baseDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </div>
              )}
            </div>
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-400 text-sm font-semibold">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                DNS 설정 방법 (도메인 구매 후 1번만)
              </div>
              <div className="font-mono text-xs bg-gray-900/60 rounded-lg p-3 space-y-1 text-gray-300">
                <div className="text-gray-500">// 레지스트라 DNS 패널에서 추가</div>
                <div>
                  <span className="text-yellow-400">타입:</span> A &nbsp;
                  <span className="text-yellow-400">호스트:</span>{" "}
                  <span className="text-emerald-300">*</span> &nbsp;
                  <span className="text-yellow-400">값:</span>{" "}
                  <span className="text-emerald-300">{"{서버 IP}"}</span>
                </div>
              </div>
              {baseDomain && (
                <div className="text-xs text-gray-400 space-y-1 pt-1">
                  <div>생성 예시:</div>
                  <div className="text-emerald-400 font-mono">
                    nutri-daily.{baseDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </div>
                  <div className="text-emerald-400 font-mono">
                    vitamind-guru.{baseDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </div>
                  <div className="text-gray-500">... {count}개</div>
                </div>
              )}
            </div>
          </div>
        )}

        {domainMode === "individual" && (
          <div className="space-y-2">
            <select
              value={domainSuffix}
              disabled={isGenerating}
              onChange={(e) => setDomainSuffix(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-60"
            >
              <option value=".site">.site (저가 ~$2/년)</option>
              <option value=".xyz">.xyz (저가 ~$1/년)</option>
              <option value=".online">.online (저가 ~$2/년)</option>
              <option value=".kr">.kr (신뢰도 ↑ ~11,000원/년)</option>
              <option value=".com">.com (표준 ~$10/년)</option>
            </select>
            <p className="text-xs text-gray-500">
              ⚠ 개별 도메인은 사이트마다 구매 + A 레코드 설정이 필요합니다.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
          isGenerating
            ? "bg-gray-800 text-gray-500 cursor-wait"
            : "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30"
        }`}
      >
        {isGenerating ? (
          <span className="flex items-center justify-center gap-3">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            생성 시작 중...
          </span>
        ) : (
          `AI 설정 생성 (${count}개)`
        )}
      </button>
    </div>
  );
}
