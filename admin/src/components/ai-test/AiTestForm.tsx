"use client";

import { useState } from "react";

const BUSINESS_TYPES = [
  { value: "restaurant", label: "음식점" },
  { value: "cafe", label: "카페" },
  { value: "dermatology", label: "피부과" },
  { value: "dental", label: "치과" },
  { value: "hair_salon", label: "미용실/헤어" },
  { value: "nail_salon", label: "네일샵" },
  { value: "academy", label: "학원/교육" },
  { value: "gym", label: "헬스/피트니스" },
  { value: "local_business", label: "기타" },
];

export type AiTestQuery = {
  query: string;
  enabled: boolean;
};

export type AiTestConfig = {
  businessName: string;
  businessType: string;
  location: string;
  broaderLocation: string;
  serviceType: string;
  queries: AiTestQuery[];
};

interface AiTestFormProps {
  onStartTest: (config: AiTestConfig) => void;
}

export default function AiTestForm({ onStartTest }: AiTestFormProps) {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("restaurant");
  const [location, setLocation] = useState("");
  const [broaderLocation, setBroaderLocation] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [queries, setQueries] = useState<AiTestQuery[]>([]);
  const [generating, setGenerating] = useState(false);
  const [customQuery, setCustomQuery] = useState("");
  const [error, setError] = useState("");

  const handleGenerateQueries = async () => {
    if (!businessName.trim() || !location.trim()) {
      setError("업체명과 지역은 필수입니다.");
      return;
    }

    setGenerating(true);
    setError("");

    try {
      const res = await fetch("/api/ai-test/generate-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          businessType,
          location,
          broaderLocation: broaderLocation || location,
          serviceType,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }

      setQueries(data.queries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "쿼리 생성 실패");
    } finally {
      setGenerating(false);
    }
  };

  const toggleQuery = (idx: number) => {
    setQueries((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, enabled: !q.enabled } : q))
    );
  };

  const removeQuery = (idx: number) => {
    setQueries((prev) => prev.filter((_, i) => i !== idx));
  };

  const addCustomQuery = () => {
    if (!customQuery.trim()) return;
    setQueries((prev) => [...prev, { query: customQuery.trim(), enabled: true }]);
    setCustomQuery("");
  };

  const enabledCount = queries.filter((q) => q.enabled).length;

  const handleStart = () => {
    if (enabledCount === 0) {
      setError("최소 1개 이상의 쿼리를 선택해주세요.");
      return;
    }
    onStartTest({
      businessName,
      businessType,
      location,
      broaderLocation: broaderLocation || location,
      serviceType,
      queries,
    });
  };

  return (
    <div className="space-y-6">
      {/* Business Info */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-sm">🏢</span>
          업체 정보
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">업체명 *</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="예: 설야갈비 청담"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">업종</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {BUSINESS_TYPES.map((bt) => (
                <option key={bt.value} value={bt.value}>
                  {bt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">지역 *</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="예: 청담"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              상위 지역 <span className="text-gray-600">(선택)</span>
            </label>
            <input
              type="text"
              value={broaderLocation}
              onChange={(e) => setBroaderLocation(e.target.value)}
              placeholder="예: 강남"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder-gray-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              서비스/음식 유형 <span className="text-gray-600">(선택)</span>
            </label>
            <input
              type="text"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              placeholder="예: 갈비, 보톡스, 미적분"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder-gray-500"
            />
          </div>
        </div>

        {/* Generate Queries Button */}
        <button
          type="button"
          onClick={handleGenerateQueries}
          disabled={generating || !businessName.trim() || !location.trim()}
          className="w-full px-5 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-medium rounded-xl hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" className="opacity-75" />
              </svg>
              AI가 쿼리 생성 중...
            </span>
          ) : queries.length > 0 ? (
            "🔄 쿼리 재생성"
          ) : (
            "✨ AI 테스트 쿼리 자동 생성"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Query List */}
      {queries.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-4 animate-slide-in">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">📝</span>
              테스트 쿼리 목록
            </h3>
            <span className="text-sm text-gray-400">
              {enabledCount}/{queries.length}개 선택
            </span>
          </div>

          <p className="text-xs text-gray-500">
            각 쿼리를 선택/해제하거나, 직접 추가/삭제할 수 있습니다.
          </p>

          <div className="space-y-2">
            {queries.map((q, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                  q.enabled
                    ? "bg-violet-500/5 border-violet-500/20 hover:border-violet-500/40"
                    : "bg-gray-800/20 border-gray-800 hover:border-gray-700 opacity-50"
                }`}
                onClick={() => toggleQuery(idx)}
              >
                <input
                  type="checkbox"
                  checked={q.enabled}
                  onChange={() => toggleQuery(idx)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500/50"
                />
                <span className="flex-1 text-sm text-white">&quot;{q.query}&quot;</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeQuery(idx);
                  }}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Custom Query Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder="커스텀 쿼리 추가..."
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustomQuery();
              }}
              className="flex-1 px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder-gray-500"
            />
            <button
              type="button"
              onClick={addCustomQuery}
              disabled={!customQuery.trim()}
              className="px-4 py-2.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors text-sm"
            >
              + 추가
            </button>
          </div>

          {/* Start Test Button */}
          <button
            type="button"
            onClick={handleStart}
            disabled={enabledCount === 0}
            className="w-full px-5 py-4 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold rounded-xl hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-base"
          >
            🚀 {enabledCount}개 쿼리로 AI 테스트 시작
          </button>
        </div>
      )}

      {/* Empty State */}
      {queries.length === 0 && !generating && (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-2xl bg-gray-800/50 flex items-center justify-center mx-auto mb-4 text-2xl">
            🤖
          </div>
          <p className="text-gray-400 text-sm">
            업체 정보를 입력하고 &quot;쿼리 자동 생성&quot; 버튼을 누르면
          </p>
          <p className="text-gray-400 text-sm">
            AI가 업종에 맞는 테스트 쿼리를 자동으로 만들어 줍니다.
          </p>
        </div>
      )}
    </div>
  );
}
