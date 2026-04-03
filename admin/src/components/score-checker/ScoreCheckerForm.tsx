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

export type ScoreCheckerInput = {
  businessName: string;
  websiteUrl: string;
  address: string;
  businessType: string;
  phone: string;
};

interface ScoreCheckerFormProps {
  onStartDiagnosis: (input: ScoreCheckerInput) => void;
}

export default function ScoreCheckerForm({ onStartDiagnosis }: ScoreCheckerFormProps) {
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [address, setAddress] = useState("");
  const [businessType, setBusinessType] = useState("restaurant");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!businessName.trim()) {
      setError("업체명은 필수입니다.");
      return;
    }
    setError("");
    onStartDiagnosis({
      businessName: businessName.trim(),
      websiteUrl: websiteUrl.trim(),
      address: address.trim(),
      businessType,
      phone: phone.trim(),
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-sm">🔍</span>
          진단 정보 입력
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">업체명 *</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="예: 설야갈비 청담"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">업종</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            >
              {BUSINESS_TYPES.map((bt) => (
                <option key={bt.value} value={bt.value}>{bt.label}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              웹사이트 URL <span className="text-gray-600">(선택 — 없으면 엔티티/권위성만 진단)</span>
            </label>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com (없으면 빈칸 유지)"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              주소 <span className="text-gray-600">(선택)</span>
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="예: 서울 강남구 선릉로152길 18"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              전화번호 <span className="text-gray-600">(선택)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="예: 02-1234-5678"
              className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder-gray-500"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            ❌ {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          className="w-full px-5 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold rounded-xl hover:from-emerald-500 hover:to-teal-500 transition-all text-base"
        >
          🚀 AI 가시성 진단 시작
        </button>
      </div>

      {/* Scoring Breakdown Preview */}
      <div className="bg-gray-900/30 border border-gray-800 rounded-2xl p-6">
        <p className="text-xs text-gray-500 mb-3">진단 항목 (100점 만점)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "엔티티 권위성", score: 30, icon: "⭐", color: "emerald" },
            { label: "플랫폼 존재감", score: 25, icon: "🌐", color: "amber" },
            { label: "웹사이트 최적화", score: 25, icon: "🔧", color: "violet" },
            { label: "AI 접근성", score: 20, icon: "🤖", color: "cyan" },
          ].map((cat) => (
            <div
              key={cat.label}
              className={`text-center px-3 py-4 rounded-xl bg-${cat.color}-500/5 border border-${cat.color}-500/10`}
            >
              <span className="text-lg">{cat.icon}</span>
              <p className="text-xs text-gray-400 mt-1">{cat.label}</p>
              <p className={`text-sm font-bold text-${cat.color}-400 mt-0.5`}>{cat.score}점</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
