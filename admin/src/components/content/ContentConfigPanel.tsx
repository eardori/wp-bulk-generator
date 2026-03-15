"use client";

import { useEffect, useState } from "react";
import type { SiteCredential, ContentArticleConfig } from "@/app/content/types";

type Props = {
  sites: SiteCredential[];
  contentPrompt: string;
  onGenerate: (configs: ContentArticleConfig[]) => void;
  onBack: () => void;
};

const COUNT_OPTIONS = [1, 2, 3, 5];

// 예상 소요 시간 (글 1개당 약 25초, 3개 병렬)
function formatETA(totalArticles: number): string {
  const seconds = Math.ceil((totalArticles / 3) * 25);
  if (seconds < 60) return `약 ${seconds}초`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `약 ${min}분 ${sec}초` : `약 ${min}분`;
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function getServerGroupId(site: SiteCredential): string {
  const serverId = site.server_id?.trim();
  if (serverId) return serverId;
  return "primary";
}

function getServerGroupLabel(serverId: string): string {
  if (serverId === "primary") return "기존 서버";
  if (serverId === "secondary") return "새 서버";
  return serverId;
}

export default function ContentConfigPanel({ sites, contentPrompt, onGenerate, onBack }: Props) {
  const [configs, setConfigs] = useState<ContentArticleConfig[]>([]);
  const [activeServerTab, setActiveServerTab] = useState("all");

  useEffect(() => {
    setConfigs((prev) => {
      const prevMap = new Map(prev.map((config) => [config.siteSlug, config]));
      return sites.map((site) => prevMap.get(site.slug) || {
        siteSlug: site.slug,
        count: 1,
        enabled: true,
      });
    });
  }, [sites]);

  const serverTabs = [
    { id: "all", label: "전체 사이트", count: sites.length },
    ...Array.from(new Set(sites.map((site) => getServerGroupId(site)))).map((serverId) => ({
      id: serverId,
      label: getServerGroupLabel(serverId),
      count: sites.filter((site) => getServerGroupId(site) === serverId).length,
    })),
  ];

  useEffect(() => {
    if (!serverTabs.some((tab) => tab.id === activeServerTab)) {
      setActiveServerTab("all");
    }
  }, [activeServerTab, serverTabs]);

  const filteredSites = sites.filter((site) =>
    activeServerTab === "all" ? true : getServerGroupId(site) === activeServerTab
  );
  const filteredSiteSlugs = new Set(filteredSites.map((site) => site.slug));

  const totalArticles = configs.filter((c) => c.enabled).reduce((sum, c) => sum + c.count, 0);
  const enabledCount = configs.filter((c) => c.enabled).length;
  const visibleConfigs = configs.filter((config) => filteredSiteSlugs.has(config.siteSlug));
  const visibleEnabledCount = visibleConfigs.filter((config) => config.enabled).length;

  const toggleEnabled = (slug: string) =>
    setConfigs((prev) => prev.map((c) => (c.siteSlug === slug ? { ...c, enabled: !c.enabled } : c)));

  const setCount = (slug: string, count: number) =>
    setConfigs((prev) => prev.map((c) => (c.siteSlug === slug ? { ...c, count } : c)));

  // 현재 탭에서 보이는 활성 사이트만 일괄 글 수 설정
  const setBulkCount = (count: number) =>
    setConfigs((prev) =>
      prev.map((config) =>
        filteredSiteSlugs.has(config.siteSlug) && config.enabled
          ? { ...config, count }
          : config
      )
    );

  const clearAll = () =>
    setConfigs((prev) => prev.map((config) => ({ ...config, enabled: false })));

  const selectVisibleOnly = () =>
    setConfigs((prev) =>
      prev.map((config) =>
        activeServerTab === "all"
          ? { ...config, enabled: true }
          : { ...config, enabled: filteredSiteSlugs.has(config.siteSlug) }
      )
    );

  const handleGenerate = () => {
    const active = configs.filter((c) => c.enabled);
    if (active.length === 0) return;
    onGenerate(active);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">컨텐츠 생성 설정</h3>
          <p className="text-gray-400 text-sm mt-0.5">
            사이트별 글 수 설정 · 3개 병렬 생성 · 12개 배치 처리
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">
            {totalArticles}
            <span className="text-sm font-normal text-gray-400 ml-1">개</span>
          </div>
          {totalArticles > 0 && (
            <div className="text-xs text-emerald-400">{formatETA(totalArticles)}</div>
          )}
        </div>
      </div>

      {/* 프롬프트 요약 */}
      <div className="px-4 py-2.5 rounded-xl bg-gray-800/50 border border-gray-700">
        <p className="text-xs text-gray-500 mb-1.5">
          이번 생성에 적용되는 작성 프롬프트
        </p>
        <p className="text-sm text-gray-300 leading-6">{summarizePrompt(contentPrompt)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {serverTabs.map((tab) => {
          const isActive = activeServerTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveServerTab(tab.id)}
              className={`px-3 py-2 rounded-xl text-sm border transition-all ${
                isActive
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-80">{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* ── 일괄 설정 바 ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700">
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {activeServerTab === "all" ? "전체 일괄:" : `${getServerGroupLabel(activeServerTab)} 일괄:`}
        </span>
        <div className="flex items-center gap-1.5">
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setBulkCount(n)}
              className="px-3 h-7 text-xs rounded-lg bg-gray-700 text-gray-300 hover:bg-emerald-500 hover:text-white font-semibold transition-all"
            >
              {n}개
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={clearAll}
          className="text-xs text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap"
        >
          전체 해제
        </button>
        <button
          onClick={selectVisibleOnly}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap"
        >
          {activeServerTab === "all" ? "전체 선택" : `${getServerGroupLabel(activeServerTab)}만 선택`}
        </button>
        <span className="text-xs text-gray-500 whitespace-nowrap">
          전체 {enabledCount}/{sites.length}개
        </span>
        <span className="text-xs text-gray-600 whitespace-nowrap hidden sm:inline">
          현재 탭 {visibleEnabledCount}/{filteredSites.length}개
        </span>
      </div>

      {/* ── 사이트 목록 (컴팩트 테이블) ── */}
      {filteredSites.length === 0 ? (
        <div className="text-center py-8 text-gray-500">배포된 사이트가 없습니다.</div>
      ) : (
        <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
          {filteredSites.map((site) => {
            const config = configs.find((c) => c.siteSlug === site.slug);
            if (!config) return null;
            return (
              <div
                key={site.slug}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                  config.enabled
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-gray-800/30 border-gray-800 opacity-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={() => toggleEnabled(site.slug)}
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer flex-shrink-0"
                />

                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">
                    {site.title || site.slug}
                  </span>
                  {site.persona?.name && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/15 text-blue-400 flex-shrink-0">
                      {site.persona.name}
                    </span>
                  )}
                  {site.persona?.tone && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-400 flex-shrink-0 hidden sm:inline">
                      {site.persona.tone}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700/70 text-gray-300 flex-shrink-0">
                    {getServerGroupLabel(getServerGroupId(site))}
                  </span>
                </div>

                {config.enabled && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {COUNT_OPTIONS.map((n) => (
                      <button
                        key={n}
                        onClick={() => setCount(site.slug, n)}
                        className={`w-9 h-6 text-xs rounded font-semibold transition-all ${
                          config.count === n
                            ? "bg-emerald-500 text-white"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 대규모 생성 안내 (50개 이상) */}
      {totalArticles >= 50 && (
        <div className="px-4 py-2.5 rounded-xl bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300 space-y-0.5">
          <div className="font-semibold">대규모 생성 안내</div>
          <div className="text-blue-400/70">
            · {Math.ceil(totalArticles / 12)}번 배치 호출 · 3개 병렬 · {formatETA(totalArticles)} 소요 예상
          </div>
          <div className="text-blue-400/70">
            · 생성 중 브라우저를 닫지 마세요. 완료된 글은 실시간으로 저장됩니다.
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-800">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          이전
        </button>
        <button
          onClick={handleGenerate}
          disabled={totalArticles === 0}
          className={`px-6 py-2.5 rounded-xl font-semibold transition-all text-sm ${
            totalArticles > 0
              ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`}
        >
          {totalArticles > 0 ? `${totalArticles}개 글 생성 시작 →` : "사이트를 선택하세요"}
        </button>
      </div>
    </div>
  );
}
