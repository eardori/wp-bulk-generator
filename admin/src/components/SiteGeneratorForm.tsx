"use client";

import { useState } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";
import type { SiteConfig, DeployStatus } from "@/app/page";

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

type Props = {
  onGenerated: (configs: SiteConfig[]) => void;
  onStatusChange: (status: DeployStatus["status"]) => void;
};

type DomainMode = "subdomain" | "individual";

export default function SiteGeneratorForm({ onGenerated, onStatusChange }: Props) {
  const [niche, setNiche] = useState("");
  const [count, setCount] = useState(5);
  const [koRatio, setKoRatio] = useState(80);
  const [domainMode, setDomainMode] = useState<DomainMode>("subdomain");
  const [baseDomain, setBaseDomain] = useState("");
  const [domainSuffix, setDomainSuffix] = useState(".site");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  // Progress state
  const [progressMsg, setProgressMsg] = useState("");
  const [collected, setCollected] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [doneBatches, setDoneBatches] = useState(0);
  const [partialWarning, setPartialWarning] = useState("");

  const handleGenerate = async () => {
    if (!niche.trim()) {
      setError("니치(주제)를 입력해주세요.");
      return;
    }
    if (domainMode === "subdomain" && !baseDomain.trim()) {
      setError("베이스 도메인을 입력해주세요. (예: myhealthblog.site)");
      return;
    }

    setError("");
    setPartialWarning("");
    setProgressMsg("");
    setCollected(0);
    setDoneBatches(0);
    setTotalBatches(0);
    setIsGenerating(true);
    onStatusChange("generating");

    const accumulatedConfigs: SiteConfig[] = [];

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/generate-configs",
        body: {
          niche: niche.trim(),
          count,
          language_ratio: { ko: koRatio / 100, en: (100 - koRatio) / 100 },
          domain_mode: domainMode,
          base_domain:
            domainMode === "subdomain"
              ? baseDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")
              : undefined,
          domain_suffix: domainMode === "individual" ? domainSuffix : undefined,
        },
      });

      await readSSEStream(reader, (event) => {
        const type = event.type as string;

        if (type === "start") {
          setTotalBatches(event.totalBatches as number);
        } else if (type === "progress") {
          setProgressMsg(event.message as string);
        } else if (type === "batch") {
          const newConfigs = event.configs as SiteConfig[];
          accumulatedConfigs.push(...newConfigs);
          const c = event.collected as number;
          const tb = event.totalBatches as number;
          const bi = (event.batchIndex as number) + 1;
          setCollected(c);
          setDoneBatches(bi);
          setTotalBatches(tb);
          setProgressMsg(`✅ 배치 ${bi}/${tb} 완료 — ${c}개 누적`);
          onGenerated([...accumulatedConfigs]);
        } else if (type === "batch_error") {
          const c = event.collected as number;
          const tb = event.totalBatches as number;
          const bi = (event.batchIndex as number) + 1;
          setPartialWarning(
            `⚠️ 배치 ${bi}/${tb}에서 중단됨 — ${c}개 저장됨. 아래 버튼으로 이어서 생성하세요.`
          );
          setProgressMsg("");
        } else if (type === "done") {
          const total = event.total as number;
          setProgressMsg(`🎉 완료! 총 ${total}개 생성됨`);
        } else if (type === "error") {
          throw new Error(event.message as string);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      setError(msg);
      if (accumulatedConfigs.length > 0) {
        setPartialWarning(`⚠️ 오류 전까지 ${accumulatedConfigs.length}개는 저장됐습니다.`);
      } else {
        onStatusChange("idle");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const progressPercent =
    totalBatches > 0 ? Math.round((doneBatches / totalBatches) * 100) : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-8">
      {/* Niche Input */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-300">니치 (주제)</label>
        <input
          type="text"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder='예: "건강식품 영양제 리뷰"'
          className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all text-lg"
        />
        <div className="flex flex-wrap gap-2">
          {NICHE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => setNiche(preset.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
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

      {/* Count & Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-300">수량</label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-gray-700 accent-emerald-500"
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
              onChange={(e) => setKoRatio(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-gray-700 accent-cyan-500"
            />
            <span className="text-lg font-semibold text-cyan-400 w-16 text-right">{koRatio}%</span>
          </div>
          <p className="text-xs text-gray-500">
            한국어 {koRatio}% / 영어 {100 - koRatio}%
          </p>
        </div>
      </div>

      {/* Domain Mode Toggle */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-gray-300">도메인 방식</label>
        <div className="flex gap-3">
          <button
            onClick={() => setDomainMode("subdomain")}
            className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all ${
              domainMode === "subdomain"
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                : "border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
          >
            <div className="font-semibold">서브도메인</div>
            <div className="text-xs mt-0.5 opacity-70">도메인 1개로 N개 운영 (추천)</div>
          </button>
          <button
            onClick={() => setDomainMode("individual")}
            className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all ${
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
                onChange={(e) => setBaseDomain(e.target.value)}
                placeholder="구매한 도메인 입력 (예: myhealthblog.site)"
                className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
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
              onChange={(e) => setDomainSuffix(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
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

      {/* Progress bar (while generating) */}
      {isGenerating && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400">{progressMsg || "시작 중..."}</span>
            <span className="text-emerald-400 font-bold">
              {doneBatches}/{totalBatches || "?"} 배치 · {collected}/{count}개
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 text-right">{progressPercent}%</p>
        </div>
      )}

      {/* Partial warning (after error with some results saved) */}
      {partialWarning && (
        <div className="px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm space-y-2">
          <p>{partialWarning}</p>
          <button
            onClick={handleGenerate}
            className="text-xs underline text-yellow-400 hover:text-yellow-300"
          >
            이어서 더 생성하기
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Generate Button */}
      <button
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
            배치 {doneBatches}/{totalBatches || "?"} 처리 중... ({collected}/{count}개)
          </span>
        ) : (
          `AI 설정 생성 (${count}개)`
        )}
      </button>
    </div>
  );
}
