"use client";

import { useState } from "react";
import type { SchemaFormData, BusinessTypeKey, SchemaOutput } from "@/lib/schema-types";
import { generateSchema } from "@/lib/schema-builder";
import type { ExtractedBusinessInfo } from "@/lib/schema-api";
import SchemaPreview from "./SchemaPreview";

const BUSINESS_TYPE_MAP: Record<string, BusinessTypeKey> = {
  restaurant: "restaurant",
  cafe: "cafe",
  dermatology: "dermatology",
  dental: "dentist",
  hair_salon: "beauty_salon",
  nail_salon: "nail_salon",
  academy: "education",
  gym: "fitness",
  local_business: "local_business",
};

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  restaurant: "음식점",
  cafe: "카페",
  dermatology: "피부과",
  dental: "치과",
  hair_salon: "미용실/헤어",
  nail_salon: "네일샵",
  academy: "학원/교육",
  gym: "헬스/피트니스",
  local_business: "일반 로컬 비즈니스",
};

type ExtractionState = "idle" | "extracting" | "extracted" | "generated" | "error";

export default function SchemaUrlExtractor() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ExtractionState>("idle");

  const [editData, setEditData] = useState<ExtractedBusinessInfo | null>(null);
  const [output, setOutput] = useState<SchemaOutput | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"ai" | "fallback" | "">("");

  const handleExtract = async () => {
    if (!url.trim()) return;

    setState("extracting");
    setError("");

    try {
      const res = await fetch("/api/schema/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const result = await res.json();

      if (result.error) {
        setError(result.error);
        setState("error");
        return;
      }

      setEditData(result.data);
      setSource(result.source || "");
      setState("extracted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "추출 실패");
      setState("error");
    }
  };

  const handleGenerate = () => {
    if (!editData) return;

    const formData: SchemaFormData = {
      businessType: BUSINESS_TYPE_MAP[editData.businessType] || "local_business",
      businessName: editData.businessName,
      address: editData.address,
      phone: editData.phone,
      websiteUrl: editData.website || url,
      imageUrl: "",
      description: editData.description,
      openingHours: editData.openingHours.map((h) => ({
        days: (h.days.includes(",") ? h.days.split(",").map((d) => d.trim()) : [h.days.trim()]) as import("@/lib/schema-types").DayOfWeek[],
        opens: h.hours.split("-")[0]?.trim() || "09:00",
        closes: h.hours.split("-")[1]?.trim() || "18:00",
      })),
      menuItems: editData.menuItems.map((m) => ({
        name: m.name,
        price: m.price,
      })),
      faqItems: editData.faq.map((f) => ({
        question: f.question,
        answer: f.answer,
      })),
      priceRange: editData.priceRange,
      acceptsReservations: false,
      cuisineType: "",
      medicalSpecialty: "",
      services: [],
      courses: [],
      amenities: "",
      beautyServices: [],
      latitude: "",
      longitude: "",
    };

    const result = generateSchema(formData);
    setOutput(result);
    setState("generated");
  };

  const handleReset = () => {
    setState("idle");
    setEditData(null);
    setOutput(null);
    setError("");
    setSource("");
  };

  const updateField = (field: keyof ExtractedBusinessInfo, value: unknown) => {
    if (!editData) return;
    setEditData({ ...editData, [field]: value });
  };

  return (
    <div className="space-y-6">
      {/* URL Input */}
      {state !== "generated" && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">🔗</span>
            웹사이트 URL 입력
          </h3>
          <div className="flex gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={state === "extracting"}
              className="flex-1 px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleExtract();
              }}
            />
            <button
              type="button"
              onClick={state === "extracted" ? handleReset : handleExtract}
              disabled={state === "extracting" || (!url.trim() && state === "idle")}
              className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-medium rounded-xl hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
            >
              {state === "extracting" ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" className="opacity-75" />
                  </svg>
                  분석 중...
                </span>
              ) : state === "extracted" ? (
                "다시 분석"
              ) : (
                "🔍 분석하기"
              )}
            </button>
          </div>

          {state === "extracting" && (
            <div className="mt-4 flex items-center gap-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
              <div className="relative w-8 h-8">
                <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
                <div className="absolute inset-0 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-sm text-violet-300 font-medium">AI가 웹사이트를 분석하고 있습니다...</p>
                <p className="text-xs text-gray-500 mt-0.5">크롤링 → 정보 추출 → 구조화 (약 10~20초 소요)</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state === "error" && error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Extracted Data Editor */}
      {state === "extracted" && editData && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-6 animate-slide-in">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-sm">✅</span>
              추출 결과
              {source === "ai" && (
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                  AI 추출
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={handleGenerate}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 text-white font-medium rounded-xl hover:from-emerald-500 hover:to-cyan-500 transition-all"
            >
              ✨ Schema 생성
            </button>
          </div>

          <p className="text-xs text-gray-500">
            AI가 추출한 정보를 확인하고, 틀린 부분이 있으면 수정한 후 &quot;Schema 생성&quot;을 클릭하세요.
          </p>

          {/* Business Type */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">업종</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateField("businessType", value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    editData.businessType === value
                      ? "bg-violet-500/20 border-violet-500/50 text-violet-300"
                      : "bg-gray-800/30 border-gray-700/50 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Core Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">상호명 *</label>
              <input
                type="text"
                value={editData.businessName}
                onChange={(e) => updateField("businessName", e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">주소</label>
              <input
                type="text"
                value={editData.address}
                onChange={(e) => updateField("address", e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">전화번호</label>
              <input
                type="text"
                value={editData.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">웹사이트</label>
              <input
                type="url"
                value={editData.website}
                onChange={(e) => updateField("website", e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">설명</label>
            <textarea
              value={editData.description}
              onChange={(e) => updateField("description", e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
            />
          </div>

          {/* Opening Hours */}
          {editData.openingHours.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">영업시간</label>
              <div className="space-y-2">
                {editData.openingHours.map((h, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={h.days}
                      onChange={(e) => {
                        const updated = [...editData.openingHours];
                        updated[idx] = { ...updated[idx], days: e.target.value };
                        updateField("openingHours", updated);
                      }}
                      className="w-32 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                    <input
                      type="text"
                      value={h.hours}
                      onChange={(e) => {
                        const updated = [...editData.openingHours];
                        updated[idx] = { ...updated[idx], hours: e.target.value };
                        updateField("openingHours", updated);
                      }}
                      className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Menu Items */}
          {editData.menuItems.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                메뉴/서비스 ({editData.menuItems.length}개)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {editData.menuItems.slice(0, 8).map((m, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={m.name}
                      onChange={(e) => {
                        const updated = [...editData.menuItems];
                        updated[idx] = { ...updated[idx], name: e.target.value };
                        updateField("menuItems", updated);
                      }}
                      className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                    <input
                      type="text"
                      value={m.price}
                      onChange={(e) => {
                        const updated = [...editData.menuItems];
                        updated[idx] = { ...updated[idx], price: e.target.value };
                        updateField("menuItems", updated);
                      }}
                      className="w-28 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FAQ */}
          {editData.faq.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                FAQ ({editData.faq.length}개)
              </label>
              <div className="space-y-2">
                {editData.faq.slice(0, 5).map((f, idx) => (
                  <div key={idx} className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-3 space-y-2">
                    <input
                      type="text"
                      value={f.question}
                      onChange={(e) => {
                        const updated = [...editData.faq];
                        updated[idx] = { ...updated[idx], question: e.target.value };
                        updateField("faq", updated);
                      }}
                      className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                      placeholder="질문"
                    />
                    <textarea
                      value={f.answer}
                      onChange={(e) => {
                        const updated = [...editData.faq];
                        updated[idx] = { ...updated[idx], answer: e.target.value };
                        updateField("faq", updated);
                      }}
                      rows={2}
                      className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
                      placeholder="답변"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Generated Schema */}
      {state === "generated" && output && (
        <div className="space-y-4 animate-slide-in">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">생성된 Schema</h3>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              새로 만들기
            </button>
          </div>
          <SchemaPreview output={output} />
        </div>
      )}
    </div>
  );
}
