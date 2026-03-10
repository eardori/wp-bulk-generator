"use client";

import { useState } from "react";
import type { SiteCredential, TargetQuestion } from "@/app/content/types";

type Props = {
  sites: SiteCredential[];
  questions: TargetQuestion[];
  onGenerate: (selected: SiteCredential[]) => void;
  onBack: () => void;
};

export default function SiteSelector({ sites, questions, onGenerate, onBack }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(sites.map((s) => s.slug))
  );

  const toggleSite = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === sites.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sites.map((s) => s.slug)));
    }
  };

  const handleGenerate = () => {
    const selectedSites = sites.filter((s) => selected.has(s.slug));
    if (selectedSites.length === 0) return;
    onGenerate(selectedSites);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">발행 사이트 선택</h3>
          <p className="text-gray-400 text-sm mt-1">
            각 사이트의 페르소나에 맞는 고유한 글이 생성됩니다.
          </p>
        </div>
        <button
          onClick={toggleAll}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          {selected.size === sites.length ? "전체 해제" : "전체 선택"}
        </button>
      </div>

      {/* Target questions summary */}
      <div className="px-4 py-3 rounded-xl bg-gray-800/50 border border-gray-700">
        <p className="text-xs text-gray-500 mb-2">타겟 질문</p>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, i) => (
            <span
              key={i}
              className="px-2 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            >
              {q.question}
            </span>
          ))}
        </div>
      </div>

      {/* Site list */}
      {sites.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          배포된 사이트가 없습니다. 먼저 사이트를 생성해주세요.
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map((site) => (
            <label
              key={site.slug}
              className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
                selected.has(site.slug)
                  ? "bg-emerald-500/5 border-emerald-500/30"
                  : "bg-gray-800/30 border-gray-700 hover:border-gray-600"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(site.slug)}
                onChange={() => toggleSite(site.slug)}
                className="mt-1 accent-emerald-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{site.title}</span>
                  <span className="text-xs text-gray-500">{site.slug}</span>
                </div>
                <p className="text-sm text-gray-400 mt-1">{site.url}</p>
                {site.persona && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
                      {site.persona.name}
                      {site.persona.age ? ` (${site.persona.age}세)` : ""}
                    </span>
                    {site.persona.expertise && (
                      <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">
                        {site.persona.expertise}
                      </span>
                    )}
                    {site.persona.tone && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400">
                        {site.persona.tone}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          이전
        </button>
        <button
          onClick={handleGenerate}
          disabled={selected.size === 0}
          className={`px-6 py-3 rounded-xl font-semibold transition-all ${
            selected.size > 0
              ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`}
        >
          {selected.size}개 사이트에 글 생성
        </button>
      </div>
    </div>
  );
}
