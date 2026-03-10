"use client";

import { useState } from "react";
import type { ScrapedProduct } from "@/app/content/types";

type Props = {
  productUrl: string;
  errorMessage?: string;
  onSubmit: (product: ScrapedProduct) => void;
  onBack: () => void;
};

export default function ManualProductForm({
  productUrl,
  errorMessage,
  onSubmit,
  onBack,
}: Props) {
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSubmit({
      url: productUrl,
      title: title.trim(),
      brand: brand.trim(),
      price: price.trim(),
      description: description.trim(),
      images: imageUrl.trim() ? [imageUrl.trim()] : [],
      specs: {},
      reviews: [],
      rating: null,
      reviewCount: 0,
      category: "",
      source: "manual",
    });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6 animate-slide-in">
      {/* Warning */}
      <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <p className="text-amber-400 text-sm font-medium">자동 스크랩 실패</p>
        <p className="text-gray-400 text-xs mt-1">
          {errorMessage || "해당 사이트가 자동 스크랩을 차단했습니다."}
          {" "}제품 정보를 직접 입력해주세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            제품명 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 비타민D 5000IU 소프트젤 120캡슐"
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              브랜드
            </label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="예: 뉴트리원"
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              가격
            </label>
            <input
              type="text"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="예: 29,900원"
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            제품 설명
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="제품 특징, 성분, 효능 등을 입력해주세요. 상세할수록 좋은 글이 생성됩니다."
            rows={4}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            제품 이미지 URL (선택)
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            이전
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
              title.trim()
                ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
                : "bg-gray-800 text-gray-500 cursor-not-allowed"
            }`}
          >
            이 정보로 계속 진행
          </button>
        </div>
      </form>
    </div>
  );
}
