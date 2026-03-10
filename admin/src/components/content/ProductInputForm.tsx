"use client";

import { useState } from "react";
import type { TargetQuestion } from "@/app/content/types";

const INTENT_OPTIONS = [
  { value: "recommendation", label: "추천" },
  { value: "comparison", label: "비교" },
  { value: "review", label: "리뷰" },
  { value: "howto", label: "사용법" },
] as const;

const QUESTION_PRESETS = [
  { label: "건성 피부 화장품", q: "건성 피부에 좋은 화장품 추천", intent: "recommendation" as const },
  { label: "30대 남성 영양제", q: "30대 남자한테 좋은 영양제 추천", intent: "recommendation" as const },
  { label: "민감성 피부 선크림", q: "민감성 피부 선크림 추천", intent: "recommendation" as const },
  { label: "다이어트 보조제", q: "다이어트에 효과적인 보조제 추천", intent: "recommendation" as const },
  { label: "제품 성분 분석", q: "이 제품 성분 안전한가요?", intent: "review" as const },
  { label: "사용법 가이드", q: "올바른 사용법과 순서", intent: "howto" as const },
];

const MAX_QUESTIONS = 5;

type Props = {
  onScrape: (url: string, questions: TargetQuestion[]) => void;
  isLoading: boolean;
};

export default function ProductInputForm({ onScrape, isLoading }: Props) {
  const [url, setUrl] = useState("");
  const [questions, setQuestions] = useState<TargetQuestion[]>([
    { question: "", intent: "recommendation" },
  ]);
  const [error, setError] = useState("");

  const addQuestion = () => {
    if (questions.length < MAX_QUESTIONS) {
      setQuestions([...questions, { question: "", intent: "recommendation" }]);
    }
  };

  const removeQuestion = (idx: number) => {
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const updateQuestion = (idx: number, field: keyof TargetQuestion, value: string) => {
    setQuestions(questions.map((q, i) => (i === idx ? { ...q, [field]: value } : q)));
  };

  const applyPreset = (preset: (typeof QUESTION_PRESETS)[number]) => {
    const emptyIdx = questions.findIndex((q) => !q.question.trim());
    if (emptyIdx >= 0) {
      updateQuestion(emptyIdx, "question", preset.q);
      updateQuestion(emptyIdx, "intent", preset.intent);
    } else if (questions.length < MAX_QUESTIONS) {
      setQuestions([...questions, { question: preset.q, intent: preset.intent }]);
    }
  };

  const handleSubmit = () => {
    if (!url.trim()) {
      setError("제품 URL을 입력해주세요.");
      return;
    }
    const validQuestions = questions.filter((q) => q.question.trim());
    if (validQuestions.length === 0) {
      setError("타겟 질문을 최소 1개 입력해주세요.");
      return;
    }
    setError("");
    onScrape(url.trim(), validQuestions);
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

      {/* Target Questions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-300">
            타겟 질문 (AI가 물어볼 만한 질문)
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">최대 {MAX_QUESTIONS}개</span>
            <button
              onClick={addQuestion}
              disabled={questions.length >= MAX_QUESTIONS}
              className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-gray-600 transition-colors"
            >
              + 질문 추가
            </button>
          </div>
        </div>

        {questions.map((q, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex-1">
              <input
                type="text"
                value={q.question}
                onChange={(e) => updateQuestion(i, "question", e.target.value)}
                placeholder={`예: "건성 피부에 좋은 화장품 추천"`}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
              />
            </div>
            <select
              value={q.intent}
              onChange={(e) => updateQuestion(i, "intent", e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-sm focus:outline-none"
            >
              {INTENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {questions.length > 1 && (
              <button
                onClick={() => removeQuestion(i)}
                className="mt-2 text-gray-500 hover:text-red-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}

        {/* Presets */}
        <div className="flex flex-wrap gap-2 pt-2">
          {QUESTION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
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
