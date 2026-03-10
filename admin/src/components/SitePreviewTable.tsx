"use client";

import { useState } from "react";
import type { SiteConfig } from "@/app/page";

type Props = {
  configs: SiteConfig[];
  setConfigs: (configs: SiteConfig[]) => void;
};

export default function SitePreviewTable({ configs, setConfigs }: Props) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const handleDelete = (index: number) => {
    setConfigs(configs.filter((_, i) => i !== index));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-900/80 text-xs text-gray-400 uppercase tracking-wider">
            <th className="px-4 py-3 text-left w-8">#</th>
            <th className="px-4 py-3 text-left">사이트</th>
            <th className="px-4 py-3 text-left">페르소나</th>
            <th className="px-4 py-3 text-left">톤</th>
            <th className="px-4 py-3 text-left">스타일</th>
            <th className="px-4 py-3 text-left">컬러</th>
            <th className="px-4 py-3 text-center w-16">카테고리</th>
            <th className="px-4 py-3 text-center w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {configs.map((site, i) => (
            <tr key={i} className="group">
              {/* Main Row */}
              <td className="px-4 py-3">
                <button
                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                  className="w-6 h-6 rounded-md bg-gray-800 text-gray-400 text-xs flex items-center justify-center hover:bg-gray-700 transition-colors"
                >
                  {expandedRow === i ? "−" : i + 1}
                </button>
              </td>
              <td className="px-4 py-3">
                <div>
                  <p className="text-white font-medium text-sm leading-tight">
                    {site.site_title}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {site.domain}
                  </p>
                </div>
              </td>
              <td className="px-4 py-3">
                <div>
                  <p className="text-gray-200 text-sm">
                    {site.persona.name} ({site.persona.age}세)
                  </p>
                  <p className="text-gray-500 text-xs">
                    {site.persona.concern}
                  </p>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="inline-block px-2 py-0.5 rounded-md bg-gray-800 text-gray-300 text-xs">
                  {site.persona.tone}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="inline-block px-2 py-0.5 rounded-md bg-gray-800 text-gray-300 text-xs">
                  {site.color_scheme.style}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  <div
                    className="w-5 h-5 rounded-md border border-gray-700"
                    style={{ backgroundColor: site.color_scheme.primary }}
                    title={`Primary: ${site.color_scheme.primary}`}
                  />
                  <div
                    className="w-5 h-5 rounded-md border border-gray-700"
                    style={{ backgroundColor: site.color_scheme.secondary }}
                    title={`Secondary: ${site.color_scheme.secondary}`}
                  />
                  <div
                    className="w-5 h-5 rounded-md border border-gray-700"
                    style={{ backgroundColor: site.color_scheme.accent }}
                    title={`Accent: ${site.color_scheme.accent}`}
                  />
                </div>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="text-gray-400 text-sm">
                  {site.categories.length}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => handleDelete(i)}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
                  title="삭제"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </td>

              {/* Expanded Details */}
              {expandedRow === i && (
                <td colSpan={8} className="px-4 py-4 bg-gray-900/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-slide-in">
                    {/* Left: Persona */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        페르소나
                      </h4>
                      <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
                        <p className="text-white font-medium">
                          {site.persona.name} ({site.persona.age}세)
                        </p>
                        <p className="text-gray-300 text-sm">{site.persona.bio}</p>
                        <div className="flex gap-2 mt-2">
                          <span className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300">
                            {site.persona.concern}
                          </span>
                          <span className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300">
                            {site.persona.expertise}
                          </span>
                          <span className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300">
                            {site.persona.tone}
                          </span>
                        </div>
                      </div>

                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">
                        카테고리
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {site.categories.map((cat, ci) => (
                          <span
                            key={ci}
                            className="px-2.5 py-1 rounded-full text-xs border border-gray-700 text-gray-300"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Right: Topics & Layout */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        초기 글 주제
                      </h4>
                      <ul className="space-y-1.5">
                        {site.initial_post_topics.map((topic, ti) => (
                          <li
                            key={ti}
                            className="text-sm text-gray-300 pl-3 border-l-2 border-gray-700"
                          >
                            {topic}
                          </li>
                        ))}
                      </ul>

                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">
                        레이아웃
                      </h4>
                      <div className="flex gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-gray-700 text-gray-300">
                          {site.layout_preference.homepage}
                        </span>
                        <span className="px-2 py-1 rounded bg-gray-700 text-gray-300">
                          사이드바: {site.layout_preference.sidebar ? "있음" : "없음"}
                        </span>
                        <span className="px-2 py-1 rounded bg-gray-700 text-gray-300">
                          이미지: {site.layout_preference.featured_image_style}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
