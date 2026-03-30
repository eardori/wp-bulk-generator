"use client";

import { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type PlatformResult = {
  platform: string;
  mentioned: boolean;
  mentionPosition: number | null;
  mentionContext: string;
  sentiment: "positive" | "neutral" | "negative" | "none";
  competitors: string[];
  fullResponse: string;
  modelVersion: string;
  error?: string;
};

type QueryResult = {
  query: string;
  platforms: Record<string, PlatformResult>;
};

type Competitor = {
  name: string;
  count: number;
};

export type AiTestResultData = {
  businessName: string;
  totalQueries: number;
  citationRates: Record<string, number>;
  averageCitationRate: number;
  topCompetitors: Competitor[];
  results: QueryResult[];
};

interface AiTestResultsProps {
  data: AiTestResultData;
  onReset: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string; gradient: string }> = {
  chatgpt: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
    gradient: "from-emerald-600 to-green-600",
  },
  gemini: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
    gradient: "from-blue-600 to-cyan-600",
  },
  claude: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/20",
    gradient: "from-orange-600 to-amber-600",
  },
};

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  negative: "😞",
  none: "",
};

function getGradeColor(rate: number): string {
  if (rate >= 80) return "text-emerald-400";
  if (rate >= 60) return "text-cyan-400";
  if (rate >= 40) return "text-amber-400";
  if (rate >= 20) return "text-orange-400";
  return "text-red-400";
}

function getGradeBg(rate: number): string {
  if (rate >= 80) return "from-emerald-500/20 to-emerald-500/5";
  if (rate >= 60) return "from-cyan-500/20 to-cyan-500/5";
  if (rate >= 40) return "from-amber-500/20 to-amber-500/5";
  if (rate >= 20) return "from-orange-500/20 to-orange-500/5";
  return "from-red-500/20 to-red-500/5";
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AiTestResults({ data, onReset }: AiTestResultsProps) {
  const [selectedResponse, setSelectedResponse] = useState<{
    query: string;
    platform: string;
    result: PlatformResult;
  } | null>(null);

  const platforms = Object.keys(data.citationRates);

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white">
            {data.businessName} — AI 인용 분석 결과
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {data.totalQueries}개 쿼리 × {platforms.length}개 플랫폼 테스트 완료
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          새 테스트
        </button>
      </div>

      {/* ── Citation Rate Cards ── */}
      <div className={`grid gap-4 ${platforms.length === 3 ? "grid-cols-1 md:grid-cols-3" : platforms.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
        {platforms.map((pid) => {
          const rate = data.citationRates[pid];
          const colors = PLATFORM_COLORS[pid] || PLATFORM_COLORS.gemini;
          return (
            <div
              key={pid}
              className={`relative overflow-hidden rounded-2xl border ${colors.border} bg-gradient-to-br ${getGradeBg(rate)} p-6`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-400">
                    {PLATFORM_LABELS[pid] || pid}
                  </p>
                  <p className={`text-4xl font-bold mt-2 ${getGradeColor(rate)}`}>
                    {rate}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {data.totalQueries}개 중{" "}
                    {Math.round((rate / 100) * data.totalQueries)}건 언급
                  </p>
                </div>
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center text-lg opacity-80`}
                >
                  {pid === "chatgpt" ? "🤖" : pid === "gemini" ? "✨" : "🧠"}
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-4 h-2 bg-gray-800/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${colors.gradient} transition-all duration-1000`}
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Average */}
      <div className="text-center py-3 rounded-xl bg-gray-800/30 border border-gray-800">
        <span className="text-gray-400 text-sm">평균 인용률: </span>
        <span className={`text-lg font-bold ${getGradeColor(data.averageCitationRate)}`}>
          {data.averageCitationRate}%
        </span>
      </div>

      {/* ── Query Results Table ── */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h3 className="text-base font-semibold text-white">쿼리별 상세 결과</h3>
          <p className="text-xs text-gray-500 mt-0.5">각 셀을 클릭하면 AI의 전체 응답을 확인할 수 있습니다.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800/30">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase w-8">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">쿼리</th>
                {platforms.map((pid) => (
                  <th
                    key={pid}
                    className={`px-4 py-3 text-center text-xs font-medium uppercase ${
                      (PLATFORM_COLORS[pid] || PLATFORM_COLORS.gemini).text
                    }`}
                  >
                    {PLATFORM_LABELS[pid] || pid}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {data.results.map((result, qi) => (
                <tr key={qi} className="hover:bg-gray-800/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500">{qi + 1}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-white">{result.query}</p>
                  </td>
                  {platforms.map((pid) => {
                    const pr = result.platforms[pid];
                    if (!pr) {
                      return (
                        <td key={pid} className="px-4 py-3 text-center">
                          <span className="text-xs text-gray-600">—</span>
                        </td>
                      );
                    }
                    if (pr.error) {
                      return (
                        <td key={pid} className="px-4 py-3 text-center">
                          <span className="inline-flex items-center px-2 py-1 text-[10px] rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/20">
                            ⚠️ 오류
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={pid} className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedResponse({
                              query: result.query,
                              platform: pid,
                              result: pr,
                            })
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-all hover:scale-105 cursor-pointer ${
                            pr.mentioned
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                              : "bg-red-500/5 text-red-400/60 border-red-500/10 hover:bg-red-500/10"
                          }`}
                        >
                          {pr.mentioned ? (
                            <>
                              ✅ {pr.mentionPosition ? `${pr.mentionPosition}위` : "언급"}
                              {SENTIMENT_EMOJI[pr.sentiment]}
                            </>
                          ) : (
                            "❌"
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Competitors ── */}
      {data.topCompetitors.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center text-sm">🏆</span>
            경쟁업체 분석
          </h3>
          <p className="text-xs text-gray-500">동일 쿼리에서 함께 언급되는 업체</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.topCompetitors.map((comp, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-4 py-2.5 bg-gray-800/30 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-5">{idx + 1}.</span>
                  <span className="text-sm text-white">{comp.name}</span>
                </div>
                <span className="text-xs text-gray-400">{comp.count}회 언급</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Response Detail Modal ── */}
      {selectedResponse && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedResponse(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">
                  {PLATFORM_LABELS[selectedResponse.platform] || selectedResponse.platform} 응답
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  &quot;{selectedResponse.query}&quot;
                </p>
              </div>
              <div className="flex items-center gap-3">
                {selectedResponse.result.mentioned && (
                  <span className="px-2 py-1 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    ✅ {selectedResponse.result.mentionPosition
                      ? `${selectedResponse.result.mentionPosition}위 언급`
                      : "언급됨"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedResponse(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Mention Context */}
            {selectedResponse.result.mentionContext && (
              <div className="px-6 py-3 bg-emerald-500/5 border-b border-gray-800">
                <p className="text-xs text-gray-400 mb-1">언급 문맥:</p>
                <p className="text-sm text-emerald-300 font-medium">
                  {selectedResponse.result.mentionContext}
                </p>
              </div>
            )}

            {/* Competitors */}
            {selectedResponse.result.competitors.length > 0 && (
              <div className="px-6 py-3 border-b border-gray-800">
                <p className="text-xs text-gray-400 mb-1">함께 언급된 경쟁업체:</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedResponse.result.competitors.map((c, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-300 border border-gray-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Full Response */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <p className="text-xs text-gray-500 mb-2">전체 응답:</p>
              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-xs text-gray-300 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                  {selectedResponse.result.fullResponse}
                </pre>
              </div>
            </div>

            {/* Model info */}
            <div className="px-6 py-3 border-t border-gray-800 text-xs text-gray-500">
              모델: {selectedResponse.result.modelVersion}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
