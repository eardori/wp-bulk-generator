"use client";

import { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type CheckItem = {
  name: string;
  maxScore: number;
  actualScore: number;
  status: "pass" | "fail" | "partial";
  recommendation: string;
};

type CategoryResult = {
  label: string;
  maxScore: number;
  score: number;
  items: CheckItem[];
};

export type ScoreResult = {
  businessName: string;
  websiteUrl: string;
  hasWebsite?: boolean;
  crawlFailed?: boolean;
  crawlError?: string;
  totalScore: number;
  grade: string;
  categories: CategoryResult[];
  summary: string;
  topPriorities: string[];
  scanDate: string;
  discoveredSources?: string[];
};

interface ScoreCheckerResultsProps {
  data: ScoreResult;
  onReset: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GRADE_CONFIG: Record<string, { label: string; color: string; bgGradient: string; description: string }> = {
  S: { label: "S", color: "text-emerald-400", bgGradient: "from-emerald-500/20 to-emerald-500/5", description: "AI 답변 엔진 노출 준비 완료" },
  A: { label: "A", color: "text-cyan-400", bgGradient: "from-cyan-500/20 to-cyan-500/5", description: "대부분 준비됨, 소폭 개선 필요" },
  B: { label: "B", color: "text-amber-400", bgGradient: "from-amber-500/20 to-amber-500/5", description: "기본은 갖춤, 주요 개선 필요" },
  C: { label: "C", color: "text-orange-400", bgGradient: "from-orange-500/20 to-orange-500/5", description: "다수 항목 미비, 본격 작업 필요" },
  D: { label: "D", color: "text-red-400", bgGradient: "from-red-500/20 to-red-500/5", description: "AI 노출 거의 불가, 전면 재구축 필요" },
};

const CATEGORY_COLORS: Record<string, { bar: string; bg: string; icon: string }> = {
  "엔티티 권위성": { bar: "bg-emerald-500", bg: "bg-emerald-500/10", icon: "⭐" },
  "플랫폼 존재감": { bar: "bg-amber-500", bg: "bg-amber-500/10", icon: "🌐" },
  "웹사이트 최적화": { bar: "bg-violet-500", bg: "bg-violet-500/10", icon: "🔧" },
  "AI 접근성": { bar: "bg-cyan-500", bg: "bg-cyan-500/10", icon: "🤖" },
};

const STATUS_ICON: Record<string, string> = {
  pass: "✅",
  partial: "⚡",
  fail: "❌",
};

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const config = GRADE_CONFIG[grade] || GRADE_CONFIG.D;
  const circumference = 2 * Math.PI * 56;
  const offset = circumference - (score / 100) * circumference;

  const strokeColor =
    grade === "S" ? "#34d399" :
    grade === "A" ? "#22d3ee" :
    grade === "B" ? "#fbbf24" :
    grade === "C" ? "#fb923c" : "#f87171";

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg className="w-40 h-40 -rotate-90" viewBox="0 0 128 128">
        {/* Background circle */}
        <circle
          cx="64" cy="64" r="56"
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="10"
        />
        {/* Score arc */}
        <circle
          cx="64" cy="64" r="56"
          fill="none"
          stroke={strokeColor}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
          style={{ filter: `drop-shadow(0 0 6px ${strokeColor}40)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${config.color}`}>{score}</span>
        <span className="text-xs text-gray-500">/ 100</span>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScoreCheckerResults({ data, onReset }: ScoreCheckerResultsProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const gradeConfig = GRADE_CONFIG[data.grade] || GRADE_CONFIG.D;

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white">{data.businessName}</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {data.websiteUrl || "웹사이트 없음 — 엔티티/권위성만 진단"}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          새 진단
        </button>
      </div>

      {/* ── Score + Grade Hero ── */}
      <div className={`relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br ${gradeConfig.bgGradient} p-8`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent" />
        <div className="relative flex flex-col md:flex-row items-center gap-8">
          {/* Gauge */}
          <ScoreGauge score={data.totalScore} grade={data.grade} />

          {/* Grade + Summary */}
          <div className="flex-1 text-center md:text-left space-y-4">
            <div className="flex items-center gap-3 justify-center md:justify-start">
              <span className={`text-5xl font-black ${gradeConfig.color}`}>
                {data.grade}
              </span>
              <div>
                <p className="text-sm text-gray-300 font-medium">{gradeConfig.description}</p>
                <p className="text-xs text-gray-500">
                  {new Date(data.scanDate).toLocaleDateString("ko-KR")} 진단
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-300 leading-relaxed">{data.summary}</p>
          </div>
        </div>
      </div>

      {/* ── No-Website Banner ── */}
      {!data.hasWebsite && (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-5 space-y-2">
          <h4 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
            🌐 웹사이트를 제작하면 최대 30점을 추가 확보할 수 있습니다
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            현재 웹사이트가 없어 웹사이트 최적화(20점)와 AI 접근성(10점) 카테고리가 0점 처리되었습니다.
            AEO 최적화 사이트를 제작하고 Schema + llms.txt를 설치하면 점수가 크게 향상됩니다.
          </p>
        </div>
      )}

      {/* ── Crawl Failed Banner ── */}
      {data.crawlFailed && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5 space-y-2">
          <h4 className="text-sm font-semibold text-red-300 flex items-center gap-2">
            ⚠️ 웹사이트 접근 불가 — 웹사이트 최적화 · AI 접근성 진단 생략
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            {data.crawlError || `입력하신 웹사이트(${data.websiteUrl})에 접근할 수 없어 웹사이트 최적화(20점)와 AI 접근성(10점)을 진단하지 못했습니다.`}
            {' '}도메인 주소를 확인하고 다시 시도하시거나, 웹사이트 없이 엔티티 권위성/플랫폼 존재감만 진단할 수 있습니다.
          </p>
        </div>
      )}

      {/* ── Discovered Sources ── */}
      {data.discoveredSources && data.discoveredSources.length > 0 && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
            🔍 자동 탐색 결과
          </h4>
          <div className="space-y-1.5">
            {data.discoveredSources.map((src, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-xs text-cyan-400 mt-0.5">•</span>
                <p className="text-xs text-gray-300">{src}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Top Priorities ── */}
      {data.topPriorities.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
            ⚡ 우선 개선 항목 Top {data.topPriorities.length}
          </h4>
          <div className="space-y-2">
            {data.topPriorities.map((p, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-xs text-amber-400 mt-0.5 font-bold">{i + 1}.</span>
                <p className="text-sm text-gray-300">{p}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Category Bars ── */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-4">
        <h4 className="text-base font-semibold text-white">카테고리별 점수</h4>
        <div className="space-y-4">
          {data.categories.map((cat) => {
            const colors = CATEGORY_COLORS[cat.label] || { bar: "bg-gray-500", bg: "bg-gray-500/10", icon: "📋" };
            const percent = Math.round((cat.score / cat.maxScore) * 100);
            return (
              <div key={cat.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-white flex items-center gap-2">
                    <span className={`w-6 h-6 rounded ${colors.bg} flex items-center justify-center text-xs`}>
                      {colors.icon}
                    </span>
                    {cat.label}
                  </span>
                  <span className="text-sm font-semibold text-gray-300">
                    {cat.score}<span className="text-gray-500">/{cat.maxScore}</span>
                  </span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${colors.bar} rounded-full transition-all duration-1000 ease-out`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Detailed Items (Expandable) ── */}
      <div className="space-y-3">
        <h4 className="text-base font-semibold text-white">항목별 상세 진단</h4>
        {data.categories.map((cat) => {
          const colors = CATEGORY_COLORS[cat.label] || { bar: "bg-gray-500", bg: "bg-gray-500/10", icon: "📋" };
          const isExpanded = expandedCategory === cat.label;
          const passCount = cat.items.filter((i) => i.status === "pass").length;
          const failCount = cat.items.filter((i) => i.status === "fail").length;

          return (
            <div key={cat.label} className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedCategory(isExpanded ? null : cat.label)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center text-sm`}>
                    {colors.icon}
                  </span>
                  <div className="text-left">
                    <p className="text-sm font-medium text-white">{cat.label}</p>
                    <p className="text-xs text-gray-500">
                      {passCount}개 통과 · {failCount}개 미달
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-300">
                    {cat.score}/{cat.maxScore}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-800 divide-y divide-gray-800/50">
                  {cat.items.map((item, idx) => (
                    <div key={idx} className="px-5 py-4 hover:bg-gray-800/10">
                      <div className="flex items-start gap-3">
                        <span className="text-sm mt-0.5">{STATUS_ICON[item.status]}</span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-white">{item.name}</p>
                            <span className={`text-xs font-mono ${
                              item.actualScore === item.maxScore
                                ? "text-emerald-400"
                                : item.actualScore > 0
                                ? "text-amber-400"
                                : "text-gray-500"
                            }`}>
                              {item.actualScore}/{item.maxScore}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                            {item.recommendation}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
