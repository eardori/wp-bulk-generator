"use client";

import { useState, type ChangeEvent } from "react";
import type {
  SchemaFormData,
  BusinessTypeKey,
  OpeningHoursEntry,
  MenuItem,
  ServiceItem,
  CourseItem,
  FaqItem,
  DayOfWeek,
} from "@/lib/schema-types";
import {
  BUSINESS_TYPES,
  DAYS_OF_WEEK,
  PRICE_RANGES,
  createInitialFormData,
} from "@/lib/schema-types";

interface SchemaFormProps {
  onGenerate: (data: SchemaFormData) => void;
}

// ─── Reusable styled wrappers ───────────────────────────────────────────────

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-300 mb-1.5">
      {children}
    </label>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/60 transition-all"
    />
  );
}

function SectionCard({
  title,
  icon,
  children,
  gradient,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  gradient?: string;
}) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
      <div
        className={`px-6 py-4 border-b border-gray-800 ${gradient || "bg-gray-800/30"}`}
      >
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          {title}
        </h3>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function SchemaForm({ onGenerate }: SchemaFormProps) {
  const [form, setForm] = useState<SchemaFormData>(createInitialFormData());

  const updateField = <K extends keyof SchemaFormData>(key: K, value: SchemaFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleTextChange = (key: keyof SchemaFormData) => (e: ChangeEvent<HTMLInputElement>) => {
    updateField(key, e.target.value as SchemaFormData[typeof key]);
  };

  // ── Dynamic list helpers ──

  function addListItem<T>(key: keyof SchemaFormData, template: T) {
    const current = form[key] as T[];
    if (key === "faqItems" && current.length >= 10) return;
    updateField(key, [...current, template] as SchemaFormData[typeof key]);
  }

  function updateListItem<T>(key: keyof SchemaFormData, index: number, updated: T) {
    const current = [...(form[key] as T[])];
    current[index] = updated;
    updateField(key, current as SchemaFormData[typeof key]);
  }

  function removeListItem<T>(key: keyof SchemaFormData, index: number) {
    const current = [...(form[key] as T[])];
    if (current.length <= 1) return;
    current.splice(index, 1);
    updateField(key, current as SchemaFormData[typeof key]);
  }

  // ── Opening hours helpers ──

  const addHoursEntry = () => {
    updateField("openingHours", [
      ...form.openingHours,
      { days: [], opens: "09:00", closes: "18:00" },
    ]);
  };

  const updateHoursEntry = (index: number, entry: OpeningHoursEntry) => {
    const updated = [...form.openingHours];
    updated[index] = entry;
    updateField("openingHours", updated);
  };

  const removeHoursEntry = (index: number) => {
    if (form.openingHours.length <= 1) return;
    const updated = [...form.openingHours];
    updated.splice(index, 1);
    updateField("openingHours", updated);
  };

  const toggleDay = (entryIndex: number, day: DayOfWeek) => {
    const entry = { ...form.openingHours[entryIndex] };
    entry.days = entry.days.includes(day)
      ? entry.days.filter((d) => d !== day)
      : [...entry.days, day];
    updateHoursEntry(entryIndex, entry);
  };

  // ── Determine which optional sections to show ──

  const isRestaurantOrCafe = form.businessType === "restaurant" || form.businessType === "cafe";
  const isMedical = form.businessType === "dermatology" || form.businessType === "dentist";
  const isBeauty = form.businessType === "beauty_salon" || form.businessType === "nail_salon";
  const isEducation = form.businessType === "education";
  const isFitness = form.businessType === "fitness";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Business Type Selection ── */}
      <SectionCard title="업종 선택" icon="🏪" gradient="bg-gradient-to-r from-violet-900/20 to-purple-900/20">
        <div>
          <FieldLabel htmlFor="businessType">업종을 선택하세요</FieldLabel>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(Object.entries(BUSINESS_TYPES) as [BusinessTypeKey, (typeof BUSINESS_TYPES)[BusinessTypeKey]][]).map(
              ([key, { label }]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateField("businessType", key)}
                  className={`px-3 py-2.5 text-sm rounded-xl border transition-all ${
                    form.businessType === key
                      ? "bg-violet-500/20 border-violet-500 text-violet-300 shadow-lg shadow-violet-500/10"
                      : "bg-gray-800/40 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
        </div>
      </SectionCard>

      {/* ── Common Fields ── */}
      <SectionCard title="기본 정보" icon="📋" gradient="bg-gradient-to-r from-blue-900/20 to-cyan-900/20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="businessName">상호명 *</FieldLabel>
            <TextInput
              id="businessName"
              value={form.businessName}
              onChange={handleTextChange("businessName")}
              placeholder="예: 설야갈비 청담"
            />
          </div>
          <div>
            <FieldLabel htmlFor="address">도로명 주소 *</FieldLabel>
            <TextInput
              id="address"
              value={form.address}
              onChange={handleTextChange("address")}
              placeholder="예: 서울 강남구 선릉로152길 18"
            />
          </div>
          <div>
            <FieldLabel htmlFor="phone">전화번호</FieldLabel>
            <TextInput
              id="phone"
              value={form.phone}
              onChange={handleTextChange("phone")}
              placeholder="예: 02-1234-5678"
            />
          </div>
          <div>
            <FieldLabel htmlFor="websiteUrl">웹사이트 URL</FieldLabel>
            <TextInput
              id="websiteUrl"
              value={form.websiteUrl}
              onChange={handleTextChange("websiteUrl")}
              placeholder="예: https://example.com"
            />
          </div>
          <div>
            <FieldLabel htmlFor="imageUrl">대표 이미지 URL</FieldLabel>
            <TextInput
              id="imageUrl"
              value={form.imageUrl}
              onChange={handleTextChange("imageUrl")}
              placeholder="예: https://example.com/photo.jpg"
            />
          </div>
          <div>
            <FieldLabel htmlFor="description">한 줄 설명</FieldLabel>
            <TextInput
              id="description"
              value={form.description}
              onChange={handleTextChange("description")}
              placeholder="예: 청담동 소갈비 전문점"
            />
          </div>
        </div>

        {/* Price & Reservation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="priceRange">가격대</FieldLabel>
            <select
              id="priceRange"
              value={form.priceRange}
              onChange={(e) => updateField("priceRange", e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/60 transition-all"
            >
              <option value="">선택 안 함</option>
              {PRICE_RANGES.map((pr) => (
                <option key={pr.value} value={pr.value}>
                  {pr.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                role="switch"
                aria-checked={form.acceptsReservations}
                tabIndex={0}
                onClick={() => updateField("acceptsReservations", !form.acceptsReservations)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    updateField("acceptsReservations", !form.acceptsReservations);
                  }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  form.acceptsReservations ? "bg-violet-500" : "bg-gray-700"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    form.acceptsReservations ? "translate-x-5" : ""
                  }`}
                />
              </div>
              <span className="text-sm text-gray-300">예약 가능</span>
            </label>
          </div>
        </div>
      </SectionCard>

      {/* ── Geo Coordinates ── */}
      <SectionCard title="좌표 (선택사항)" icon="📍">
        <p className="text-xs text-gray-500 -mt-2 mb-2">
          위도/경도를 직접 입력하거나, 비워두시면 좌표 없이 Schema가 생성됩니다.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="latitude">위도 (Latitude)</FieldLabel>
            <TextInput
              id="latitude"
              value={form.latitude}
              onChange={handleTextChange("latitude")}
              placeholder="예: 37.5242"
            />
          </div>
          <div>
            <FieldLabel htmlFor="longitude">경도 (Longitude)</FieldLabel>
            <TextInput
              id="longitude"
              value={form.longitude}
              onChange={handleTextChange("longitude")}
              placeholder="예: 127.0458"
            />
          </div>
        </div>
      </SectionCard>

      {/* ── Opening Hours ── */}
      <SectionCard title="영업시간" icon="🕐">
        {form.openingHours.map((entry, i) => (
          <div key={i} className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">영업시간 그룹 {i + 1}</span>
              {form.openingHours.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeHoursEntry(i)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  삭제
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleDay(i, day.key)}
                  className={`w-9 h-9 text-xs rounded-lg border transition-all ${
                    entry.days.includes(day.key)
                      ? "bg-violet-500/20 border-violet-500 text-violet-300"
                      : "bg-gray-800/40 border-gray-700 text-gray-500 hover:border-gray-600"
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={entry.opens}
                onChange={(e) =>
                  updateHoursEntry(i, { ...entry, opens: e.target.value })
                }
                className="px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <span className="text-gray-500 text-sm">~</span>
              <input
                type="time"
                value={entry.closes}
                onChange={(e) =>
                  updateHoursEntry(i, { ...entry, closes: e.target.value })
                }
                className="px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addHoursEntry}
          className="w-full py-2.5 text-sm border border-dashed border-gray-700 text-gray-400 rounded-xl hover:border-violet-500/50 hover:text-violet-300 transition-all"
        >
          + 영업시간 그룹 추가
        </button>
      </SectionCard>

      {/* ── Restaurant / Cafe Fields ── */}
      {isRestaurantOrCafe && (
        <SectionCard title="음식점 / 카페 정보" icon="🍽️" gradient="bg-gradient-to-r from-orange-900/20 to-amber-900/20">
          <div>
            <FieldLabel htmlFor="cuisineType">음식 유형</FieldLabel>
            <TextInput
              id="cuisineType"
              value={form.cuisineType}
              onChange={handleTextChange("cuisineType")}
              placeholder="예: Korean BBQ, Italian, Coffee"
            />
          </div>
          <div className="space-y-3">
            <FieldLabel>메뉴 항목</FieldLabel>
            {form.menuItems.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateListItem<MenuItem>("menuItems", i, { ...item, name: e.target.value })
                  }
                  placeholder="메뉴명"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                <input
                  value={item.price}
                  onChange={(e) =>
                    updateListItem<MenuItem>("menuItems", i, { ...item, price: e.target.value })
                  }
                  placeholder="가격"
                  className="w-28 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                {form.menuItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeListItem<MenuItem>("menuItems", i)}
                    className="px-2 py-2 text-red-400 hover:text-red-300 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => addListItem<MenuItem>("menuItems", { name: "", price: "" })}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              + 메뉴 추가
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Medical Fields ── */}
      {isMedical && (
        <SectionCard title="의료 업종 정보" icon="🏥" gradient="bg-gradient-to-r from-emerald-900/20 to-teal-900/20">
          <div>
            <FieldLabel htmlFor="medicalSpecialty">전문 분야</FieldLabel>
            <TextInput
              id="medicalSpecialty"
              value={form.medicalSpecialty}
              onChange={handleTextChange("medicalSpecialty")}
              placeholder="예: Dermatology, Dentistry"
            />
          </div>
          <div className="space-y-3">
            <FieldLabel>시술/진료 항목</FieldLabel>
            {form.services.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateListItem<ServiceItem>("services", i, { ...item, name: e.target.value })
                  }
                  placeholder="시술명"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                <input
                  value={item.description}
                  onChange={(e) =>
                    updateListItem<ServiceItem>("services", i, { ...item, description: e.target.value })
                  }
                  placeholder="설명"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                {form.services.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeListItem<ServiceItem>("services", i)}
                    className="px-2 py-2 text-red-400 hover:text-red-300 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => addListItem<ServiceItem>("services", { name: "", description: "" })}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              + 시술/진료 추가
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Beauty Fields ── */}
      {isBeauty && (
        <SectionCard title="뷰티 서비스 정보" icon="💇" gradient="bg-gradient-to-r from-pink-900/20 to-rose-900/20">
          <div className="space-y-3">
            <FieldLabel>서비스 항목</FieldLabel>
            {form.beautyServices.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateListItem<ServiceItem>("beautyServices", i, { ...item, name: e.target.value })
                  }
                  placeholder="서비스명"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                <input
                  value={item.description}
                  onChange={(e) =>
                    updateListItem<ServiceItem>("beautyServices", i, { ...item, description: e.target.value })
                  }
                  placeholder="설명"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                {form.beautyServices.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeListItem<ServiceItem>("beautyServices", i)}
                    className="px-2 py-2 text-red-400 hover:text-red-300 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => addListItem<ServiceItem>("beautyServices", { name: "", description: "" })}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              + 서비스 추가
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Education Fields ── */}
      {isEducation && (
        <SectionCard title="교육 정보" icon="📚" gradient="bg-gradient-to-r from-yellow-900/20 to-amber-900/20">
          <div className="space-y-3">
            <FieldLabel>교육 과정</FieldLabel>
            {form.courses.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateListItem<CourseItem>("courses", i, { ...item, name: e.target.value })
                  }
                  placeholder="과정명"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                <input
                  value={item.audience}
                  onChange={(e) =>
                    updateListItem<CourseItem>("courses", i, { ...item, audience: e.target.value })
                  }
                  placeholder="대상 (예: 초등학생)"
                  className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                {form.courses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeListItem<CourseItem>("courses", i)}
                    className="px-2 py-2 text-red-400 hover:text-red-300 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => addListItem<CourseItem>("courses", { name: "", audience: "" })}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              + 과정 추가
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Fitness Fields ── */}
      {isFitness && (
        <SectionCard title="편의시설 정보" icon="🏋️" gradient="bg-gradient-to-r from-lime-900/20 to-green-900/20">
          <div>
            <FieldLabel htmlFor="amenities">편의시설</FieldLabel>
            <TextInput
              id="amenities"
              value={form.amenities}
              onChange={handleTextChange("amenities")}
              placeholder="예: 샤워실, 사우나, 주차장"
            />
          </div>
        </SectionCard>
      )}

      {/* ── FAQ ── */}
      <SectionCard title="FAQ (최대 10개)" icon="❓" gradient="bg-gradient-to-r from-indigo-900/20 to-blue-900/20">
        <div className="space-y-3">
          {form.faqItems.map((item, i) => (
            <div key={i} className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium">FAQ {i + 1}</span>
                {form.faqItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeListItem<FaqItem>("faqItems", i)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    삭제
                  </button>
                )}
              </div>
              <input
                value={item.question}
                onChange={(e) =>
                  updateListItem<FaqItem>("faqItems", i, { ...item, question: e.target.value })
                }
                placeholder="질문을 입력하세요"
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <textarea
                value={item.answer}
                onChange={(e) =>
                  updateListItem<FaqItem>("faqItems", i, { ...item, answer: e.target.value })
                }
                placeholder="답변을 입력하세요"
                rows={2}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none"
              />
            </div>
          ))}
          {form.faqItems.length < 10 && (
            <button
              type="button"
              onClick={() => addListItem<FaqItem>("faqItems", { question: "", answer: "" })}
              className="w-full py-2.5 text-sm border border-dashed border-gray-700 text-gray-400 rounded-xl hover:border-violet-500/50 hover:text-violet-300 transition-all"
            >
              + FAQ 추가 ({form.faqItems.length}/10)
            </button>
          )}
        </div>
      </SectionCard>

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={!form.businessName.trim() || !form.address.trim()}
        className="w-full py-4 text-base font-semibold rounded-2xl transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 shadow-xl shadow-violet-500/20 hover:shadow-violet-500/30 active:scale-[0.98]"
      >
        ✨ Schema 생성하기
      </button>
    </form>
  );
}
