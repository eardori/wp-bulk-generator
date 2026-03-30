"use client";

import { useState } from "react";
import type { SchemaFormData } from "@/lib/schema-types";
import type { SchemaOutput } from "@/lib/schema-types";
import { generateSchema } from "@/lib/schema-builder";
import SchemaForm from "@/components/schema-generator/SchemaForm";
import SchemaPreview from "@/components/schema-generator/SchemaPreview";
import SchemaUrlExtractor from "@/components/schema-generator/SchemaUrlExtractor";
import SchemaBulkInstaller from "@/components/schema-generator/SchemaBulkInstaller";

type TabId = "url" | "bulk" | "manual";

const TABS: Array<{ id: TabId; label: string; icon: string; description: string }> = [
  {
    id: "url",
    label: "URL 자동 분석",
    icon: "🔗",
    description: "웹사이트 URL만 넣으면 AI가 자동으로 분석",
  },
  {
    id: "bulk",
    label: "WP 일괄 설치",
    icon: "🏢",
    description: "기존 워드프레스 사이트에 일괄 설치",
  },
  {
    id: "manual",
    label: "수동 입력",
    icon: "✏️",
    description: "업체 정보를 직접 입력해서 생성",
  },
];

export default function SchemaGeneratorPage() {
  const [activeTab, setActiveTab] = useState<TabId>("url");
  const [output, setOutput] = useState<SchemaOutput | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleGenerate = (data: SchemaFormData) => {
    const result = generateSchema(data);
    setOutput(result);
    setShowResult(true);
    setTimeout(() => {
      document.getElementById("schema-result")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  const handleReset = () => {
    setOutput(null);
    setShowResult(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20">
              <span className="text-lg">🔧</span>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20 rounded-full">
              AEO Tool
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white">
            웹사이트 Schema 생성기
          </h2>
          <p className="text-gray-400 mt-1">
            업종과 업체 정보를 입력하면 AEO에 최적화된 구조화 데이터(JSON-LD)를
            자동으로 생성합니다.
          </p>
        </div>
        {showResult && activeTab === "manual" && (
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            새로 만들기
          </button>
        )}
      </div>

      {/* ── About Section ── */}
      {!showResult && (
        <div className="space-y-6 animate-slide-in">
          {/* Hero Banner */}
          <div className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-violet-950/40 via-gray-900 to-purple-950/40">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-500/5 via-transparent to-transparent" />
            <div className="relative px-8 py-8 space-y-6">
              {/* What is Schema */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">💡</span>
                  Schema(구조화 데이터)란?
                </h3>
                <p className="text-sm text-gray-300 leading-relaxed max-w-3xl">
                  Schema(구조화 데이터)는 웹사이트의 콘텐츠를 <span className="text-violet-300 font-medium">AI와 검색엔진이 이해할 수 있는 표준 형식</span>으로
                  변환한 데이터입니다. JSON-LD 형태로 웹페이지에 삽입하면, ChatGPT·Gemini·Claude 같은 AI 답변 엔진과
                  Google 검색엔진이 업체 정보(상호명, 주소, 메뉴, 영업시간 등)를 <span className="text-violet-300 font-medium">정확하게 인식하고 답변에 활용</span>할 수 있게 됩니다.
                </p>
              </div>

              {/* 3 Core Values */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 space-y-2 hover:border-violet-500/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-base">🤖</span>
                    <h4 className="text-sm font-semibold text-white">AI 답변 엔진 노출</h4>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    ChatGPT, Gemini, Claude가 업체를 추천할 때 구조화 데이터를 참고합니다.
                    Schema가 없으면 AI가 업체 정보를 정확히 파악하기 어렵습니다.
                  </p>
                </div>
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 space-y-2 hover:border-cyan-500/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-base">🔍</span>
                    <h4 className="text-sm font-semibold text-white">검색 결과 강화</h4>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Google에서 별점, 영업시간, 가격대 등이 포함된 리치 스니펫으로 표시됩니다.
                    클릭률(CTR)이 평균 30% 이상 향상됩니다.
                  </p>
                </div>
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 space-y-2 hover:border-emerald-500/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-base">⚡</span>
                    <h4 className="text-sm font-semibold text-white">간편한 설치</h4>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    생성된 코드를 복사하거나, 워드프레스 사이트에는 자동으로 설치할 수 있습니다.
                    카페24, 아임웹 등 모든 플랫폼에서도 사용 가능합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      {!showResult && (
        <div className="flex gap-2 p-1.5 bg-gray-900/50 border border-gray-800 rounded-2xl">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-3.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-violet-600/20 to-purple-600/20 text-white border border-violet-500/30 shadow-lg shadow-violet-500/5"
                  : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/30"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </div>
              <p className={`text-[11px] mt-1 ${
                activeTab === tab.id ? "text-gray-400" : "text-gray-600"
              }`}>
                {tab.description}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* ── Tab Content ── */}
      {activeTab === "url" && !showResult && <SchemaUrlExtractor />}

      {activeTab === "bulk" && !showResult && <SchemaBulkInstaller />}

      {activeTab === "manual" && !showResult && <SchemaForm onGenerate={handleGenerate} />}

      {/* Result Preview (manual tab only) */}
      {showResult && output && activeTab === "manual" && (
        <div id="schema-result">
          <SchemaPreview output={output} />
        </div>
      )}
    </div>
  );
}
