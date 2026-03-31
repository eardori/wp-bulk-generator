"use client";

import { useState, useCallback } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";
import ScoreCheckerForm from "@/components/score-checker/ScoreCheckerForm";
import type { ScoreCheckerInput } from "@/components/score-checker/ScoreCheckerForm";
import ScoreCheckerResults from "@/components/score-checker/ScoreCheckerResults";
import type { ScoreResult } from "@/components/score-checker/ScoreCheckerResults";

type PageState = "form" | "scanning" | "results";

type StepEvent = {
  type: string;
  step?: number;
  label?: string;
  message?: string;
  category?: string;
  score?: number;
  maxScore?: number;
  // done payload
  businessName?: string;
  websiteUrl?: string;
  hasWebsite?: boolean;
  crawlFailed?: boolean;
  crawlError?: string;
  totalScore?: number;
  grade?: string;
  categories?: ScoreResult["categories"];
  summary?: string;
  topPriorities?: string[];
  scanDate?: string;
  discoveredSources?: string[];
  // discovery step payload
  discovery?: {
    websiteUrl?: string;
    address?: string;
    phone?: string;
    naverPlaceFound?: boolean;
    googleBizFound?: boolean;
    blogCount?: number;
    directoryCount?: number;
    snsCount?: number;
    sources?: string[];
  };
};

const STEPS = [
  { step: 1, label: "업체 정보 자동 수집", icon: "🔍" },
  { step: 2, label: "웹페이지 크롤링", icon: "🌐" },
  { step: 3, label: "구조화 데이터 분석", icon: "🔧" },
  { step: 4, label: "콘텐츠 품질 체크", icon: "📝" },
  { step: 5, label: "엔티티 존재감 확인", icon: "🌍" },
  { step: 6, label: "권위성 신호 수집", icon: "⭐" },
  { step: 7, label: "AI 종합 평가 생성", icon: "🤖" },
];

export default function ScoreCheckerPage() {
  const [state, setState] = useState<PageState>("form");
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessages, setStepMessages] = useState<StepEvent[]>([]);
  const [resultData, setResultData] = useState<ScoreResult | null>(null);
  const [error, setError] = useState("");

  const handleStartDiagnosis = useCallback(async (input: ScoreCheckerInput) => {
    setState("scanning");
    setCurrentStep(0);
    setStepMessages([]);
    setResultData(null);
    setError("");

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/score-checker/analyze",
        body: input as unknown as Record<string, unknown>,
      });

      await readSSEStream(reader, (data) => {
        const event = data as unknown as StepEvent;

        if (event.type === "step") {
          setCurrentStep(event.step || 0);
        }

        if (event.type === "step-done" || event.type === "category-done") {
          setStepMessages((prev) => [...prev, event]);
        }

        if (event.type === "done") {
          setResultData({
            businessName: event.businessName || input.businessName,
            websiteUrl: event.websiteUrl || input.websiteUrl,
            hasWebsite: event.hasWebsite ?? !!(input.websiteUrl?.trim()),
            crawlFailed: event.crawlFailed,
            crawlError: event.crawlError,
            totalScore: event.totalScore || 0,
            grade: event.grade || "D",
            categories: event.categories || [],
            summary: event.summary || "",
            topPriorities: event.topPriorities || [],
            scanDate: event.scanDate || new Date().toISOString(),
            discoveredSources: event.discoveredSources,
          });
          setState("results");
        }

        if (event.type === "error") {
          setError(event.message || "진단 실패");
          setState("form");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "진단 실패");
      setState("form");
    }
  }, []);

  const handleReset = () => {
    setState("form");
    setCurrentStep(0);
    setStepMessages([]);
    setResultData(null);
    setError("");
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-lg">📊</span>
          </div>
          <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded-full">
            AEO Tool
          </span>
        </div>
        <h2 className="text-2xl font-bold text-white">AI 검색 진단 스코어링</h2>
        <p className="text-gray-400 mt-1">
          웹사이트가 AI 답변 엔진에 노출될 준비가 되었는지 100점 만점으로 진단합니다.
          <span className="text-emerald-400 text-xs ml-2">✔ Gemini AI 기반 분석</span>
        </p>
      </div>

      {/* ── About Banner ── */}
      {state === "form" && (
        <div className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-emerald-950/40 via-gray-900 to-teal-950/40">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/5 via-transparent to-transparent" />
          <div className="relative px-8 py-8 space-y-6">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-sm">💡</span>
                AI 가시성 진단이란?
              </h3>
              <p className="text-sm text-gray-300 leading-relaxed max-w-3xl">
                AI가 특정 업체를 추천하려면 <span className="text-emerald-300 font-medium">구조화 데이터, 콘텐츠 품질, 온라인 존재감, 권위성</span> 네 가지 조건이 필요합니다.
                이 도구는 4개 카테고리 21개 항목을 자동 분석하여 <span className="text-emerald-300 font-medium">S~D등급</span>으로 평가하고, 구체적인 개선 가이드를 제공합니다.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { grade: "S", range: "90~100", color: "emerald", desc: "AI 노출 준비 완료" },
                { grade: "A", range: "75~89", color: "cyan", desc: "소폭 개선 필요" },
                { grade: "B", range: "60~74", color: "amber", desc: "주요 개선 필요" },
                { grade: "C", range: "40~59", color: "orange", desc: "본격 작업 필요" },
                { grade: "D", range: "0~39", color: "red", desc: "전면 재구축 필요" },
              ].map((g) => (
                <div
                  key={g.grade}
                  className="text-center px-3 py-3 rounded-xl bg-gray-800/30 border border-gray-700/50"
                >
                  <span className={`text-xl font-black text-${g.color}-400`}>{g.grade}</span>
                  <p className="text-[10px] text-gray-500 mt-0.5">{g.range}점</p>
                  <p className="text-[10px] text-gray-400">{g.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* ── Form ── */}
      {state === "form" && <ScoreCheckerForm onStartDiagnosis={handleStartDiagnosis} />}

      {/* ── Scanning Progress ── */}
      {state === "scanning" && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-8 space-y-8">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-white animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" className="opacity-75" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white">진단 진행 중...</h3>
            <p className="text-sm text-gray-400">
              단계 {currentStep}/{STEPS.length} 진행 중
            </p>
          </div>

          {/* Step List */}
          <div className="space-y-3 max-w-lg mx-auto">
            {STEPS.map((s) => {
              const completed = stepMessages.some(
                (m) => m.step === s.step && (m.type === "step-done" || m.type === "category-done")
              );
              const isCurrent = currentStep === s.step;
              const catResult = stepMessages.find(
                (m) => m.step === s.step && m.type === "category-done"
              );

              return (
                <div
                  key={s.step}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    completed
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : isCurrent
                      ? "bg-cyan-500/5 border-cyan-500/20 animate-pulse"
                      : "bg-gray-800/20 border-gray-800 opacity-40"
                  }`}
                >
                  <span className="text-base w-6 text-center">
                    {completed ? "✅" : isCurrent ? s.icon : "⬜"}
                  </span>
                  <span className={`text-sm flex-1 ${
                    completed ? "text-emerald-300" : isCurrent ? "text-cyan-300" : "text-gray-500"
                  }`}>
                    {s.label}
                  </span>
                  {catResult && (
                    <span className="text-xs font-mono text-emerald-400">
                      {catResult.score}/{catResult.maxScore}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-700"
              style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {state === "results" && resultData && (
        <ScoreCheckerResults data={resultData} onReset={handleReset} />
      )}
    </div>
  );
}
