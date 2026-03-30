"use client";

import { useState, useCallback, useEffect } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";
import AiTestForm from "@/components/ai-test/AiTestForm";
import type { AiTestConfig } from "@/components/ai-test/AiTestForm";
import AiTestResults from "@/components/ai-test/AiTestResults";
import type { AiTestResultData } from "@/components/ai-test/AiTestResults";

type PageState = "form" | "testing" | "results";

type PlatformAvailability = {
  id: string;
  label: string;
  available: boolean;
};

type ProgressEvent = {
  type: string;
  message?: string;
  queryIndex?: number;
  query?: string;
  platform?: string;
  mentioned?: boolean;
  mentionPosition?: number | null;
  sentiment?: string;
  totalQueries?: number;
  platforms?: string[];
  results?: AiTestResultData["results"];
  citationRates?: Record<string, number>;
  averageCitationRate?: number;
  topCompetitors?: AiTestResultData["topCompetitors"];
  businessName?: string;
  error?: string;
};

export default function AiTestPage() {
  const [state, setState] = useState<PageState>("form");
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [resultData, setResultData] = useState<AiTestResultData | null>(null);
  const [platformsInfo, setPlatformsInfo] = useState<PlatformAvailability[]>([]);

  // Fetch available platforms on mount
  useEffect(() => {
    fetch("/api/ai-test/platforms")
      .then((r) => r.json())
      .then((data) => {
        if (data.allPlatforms) {
          setPlatformsInfo(data.allPlatforms);
        }
      })
      .catch(() => {});
  }, []);

  const handleStartTest = useCallback(async (config: AiTestConfig) => {
    setState("testing");
    setProgress([]);
    setResultData(null);

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/ai-test/run",
        body: config,
      });

      await readSSEStream(reader, (data) => {
        const event = data as unknown as ProgressEvent;

        setProgress((prev) => [...prev, event]);

        if (event.type === "done" && event.results) {
          setResultData({
            businessName: event.businessName || config.businessName,
            totalQueries: event.totalQueries || config.queries.filter((q) => q.enabled).length,
            citationRates: event.citationRates || {},
            averageCitationRate: event.averageCitationRate || 0,
            topCompetitors: event.topCompetitors || [],
            results: event.results,
          });
          setState("results");
        }

        if (event.type === "error") {
          setState("form");
        }
      });
    } catch (err) {
      setProgress((prev) => [
        ...prev,
        {
          type: "error",
          message: err instanceof Error ? err.message : "테스트 실행 실패",
        },
      ]);
      setState("form");
    }
  }, []);

  const handleReset = () => {
    setState("form");
    setProgress([]);
    setResultData(null);
  };

  // Count current progress
  const totalQueries = progress.find((p) => p.type === "start")?.totalQueries || 0;
  const completedQueries = new Set(
    progress.filter((p) => p.type === "platform-result" || p.type === "platform-error").map((p) => p.queryIndex)
  ).size;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-lg">🤖</span>
          </div>
          <span className="px-2.5 py-1 text-xs font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 rounded-full">
            AEO Tool
          </span>
        </div>
        <h2 className="text-2xl font-bold text-white">AI 검색 인용 테스트</h2>
        <p className="text-gray-400 mt-1">
          Gemini에게 질문을 던져 고객 업체가 실제로 AI 답변에 언급되는지 확인합니다.
          <span className="text-cyan-400 text-xs ml-2">✔ 현재 Gemini만 지원 (ChatGPT·Claude 추후 추가 예정)</span>
        </p>
      </div>

      {/* ── About Banner ── */}
      {state === "form" && (
        <div className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-cyan-950/40 via-gray-900 to-blue-950/40">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-500/5 via-transparent to-transparent" />
          <div className="relative px-8 py-8 space-y-6">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center text-sm">💡</span>
                AI 인용 테스트란?
              </h3>
              <p className="text-sm text-gray-300 leading-relaxed max-w-3xl">
                AEO(Answer Engine Optimization)의 핵심은 <span className="text-cyan-300 font-medium">AI가 고객 업체를 실제로 추천하는지</span> 확인하는 것입니다.
                이 도구는 AI에 동일한 질문을 보내 업체가 답변에 포함되는지 테스트합니다.
                현재는 <span className="text-cyan-300 font-medium">Google Gemini</span>로 테스트가 진행되며,
                추후 ChatGPT, Claude가 추가될 예정입니다.
                AEO 작업 전후로 테스트하면 <span className="text-cyan-300 font-medium">최적화 효과를 수치로 측정</span>할 수 있습니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-base">📊</span>
                  <h4 className="text-sm font-semibold text-white">인용률 측정</h4>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  각 AI 플랫폼별로 업체가 언급되는 비율을 % 수치로 확인합니다.
                </p>
              </div>
              <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-base">🏆</span>
                  <h4 className="text-sm font-semibold text-white">경쟁 분석</h4>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  같은 쿼리에서 경쟁업체가 얼마나 자주 추천되는지 비교 분석합니다.
                </p>
              </div>
              <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-base">📈</span>
                  <h4 className="text-sm font-semibold text-white">Before / After</h4>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  AEO 최적화 전후로 테스트하여 인용률 변화를 추적할 수 있습니다.
                </p>
              </div>
            </div>

            {/* Platform Availability */}
            {platformsInfo.length > 0 && (
              <div className="flex items-center gap-4 pt-2">
                <span className="text-xs text-gray-500">사용 가능한 플랫폼:</span>
                {platformsInfo.map((p) => (
                  <span
                    key={p.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border ${
                      p.available
                        ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/20"
                        : "bg-gray-800/50 text-gray-500 border-gray-700"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${p.available ? "bg-emerald-400" : "bg-gray-600"}`} />
                    {p.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Form ── */}
      {state === "form" && <AiTestForm onStartTest={handleStartTest} />}

      {/* ── Testing Progress ── */}
      {state === "testing" && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">AI 테스트 진행 중...</h3>
              <p className="text-xs text-gray-500">
                쿼리 {completedQueries}/{totalQueries} 완료
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          {totalQueries > 0 && (
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${(completedQueries / totalQueries) * 100}%` }}
              />
            </div>
          )}

          {/* Live Log */}
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {progress
              .filter((p) =>
                ["query-start", "platform-result", "platform-error"].includes(p.type)
              )
              .slice(-15)
              .map((p, idx) => (
                <div
                  key={idx}
                  className={`px-3 py-2 rounded-lg text-sm ${
                    p.type === "platform-result" && p.mentioned
                      ? "bg-emerald-500/5 text-emerald-300"
                      : p.type === "platform-error"
                      ? "bg-red-500/5 text-red-300"
                      : p.type === "platform-result" && !p.mentioned
                      ? "bg-gray-800/30 text-gray-400"
                      : "bg-cyan-500/5 text-cyan-300"
                  }`}
                >
                  {p.message}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {state === "results" && resultData && (
        <AiTestResults data={resultData} onReset={handleReset} />
      )}
    </div>
  );
}
