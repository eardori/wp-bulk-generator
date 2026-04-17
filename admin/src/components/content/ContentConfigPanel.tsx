"use client";

import { useEffect, useMemo, useState } from "react";
import type { SiteCredential, ContentArticleConfig } from "@/app/content/types";
import { getDomainGroup, getDomainGroupLabel, getDomainGroupColor, type DomainGroup } from "@/lib/domainGroup";

type Props = {
  sites: SiteCredential[];
  contentPrompt: string;
  onGenerate: (configs: ContentArticleConfig[]) => void;
  onSubmitAsJob?: (configs: ContentArticleConfig[]) => void;
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

export default function ContentConfigPanel({ sites, contentPrompt, onGenerate, onSubmitAsJob, onBack }: Props) {
  const [configs, setConfigs] = useState<ContentArticleConfig[]>([]);
  const [activeDomainTab, setActiveDomainTab] = useState("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => {
      setConfigs((prev) => {
        const prevMap = new Map(prev.map((config) => [config.siteSlug, config]));
        return sites.map((site) => prevMap.get(site.slug) || {
          siteSlug: site.slug,
          count: 1,
          enabled: true,
        });
      });
    }, 0);
    return () => clearTimeout(t);
  }, [sites]);

  const domainTabs = useMemo(() => {
    const groups = Array.from(new Set(sites.map((site) => getDomainGroup(site))));
    return [
      { id: "all", label: "전체", count: sites.length },
      ...groups.map((group) => ({
        id: group,
        label: getDomainGroupLabel(group),
        count: sites.filter((site) => getDomainGroup(site) === group).length,
      })),
    ];
  }, [sites]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!domainTabs.some((tab) => tab.id === activeDomainTab)) {
        setActiveDomainTab("all");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [activeDomainTab, domainTabs]);

  const filteredSites = sites.filter((site) =>
    activeDomainTab === "all" ? true : getDomainGroup(site) === activeDomainTab
  );
  const filteredSiteSlugs = new Set(filteredSites.map((site) => site.slug));

  // 전역 기준 (정보성 표시용)
  const globalEnabled = configs.filter((c) => c.enabled);
  const globalEnabledCount = globalEnabled.length;
  const globalTotalArticles = globalEnabled.reduce((sum, c) => sum + c.count, 0);

  // 탭 = 생성 범위. 상단 집계·바닥 버튼·Job 제출 모두 scoped 기준 사용
  const scopedConfigs = configs.filter((c) => filteredSiteSlugs.has(c.siteSlug));
  const scopedEnabled = scopedConfigs.filter((c) => c.enabled);
  const totalArticles = scopedEnabled.reduce((sum, c) => sum + c.count, 0);
  const enabledCount = scopedEnabled.length;
  const visibleConfigs = scopedConfigs;
  const visibleEnabledCount = enabledCount;

  const scopeLabel =
    activeDomainTab === "all" ? "전체" : getDomainGroupLabel(activeDomainTab);

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
        activeDomainTab === "all"
          ? { ...config, enabled: true }
          : { ...config, enabled: filteredSiteSlugs.has(config.siteSlug) }
      )
    );

  // 도메인별 사이트 slug 집합 (O(1) 조회)
  const groupSlugMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const site of sites) {
      const g = getDomainGroup(site);
      if (!map.has(g)) map.set(g, new Set());
      map.get(g)!.add(site.slug);
    }
    return map;
  }, [sites]);

  const setGroupEnabled = (group: string, enabled: boolean) => {
    const slugs = groupSlugMap.get(group);
    if (!slugs) return;
    setConfigs((prev) => prev.map((c) => (slugs.has(c.siteSlug) ? { ...c, enabled } : c)));
  };

  const setGroupCount = (group: string, count: number) => {
    const slugs = groupSlugMap.get(group);
    if (!slugs) return;
    setConfigs((prev) =>
      prev.map((c) => (slugs.has(c.siteSlug) && c.enabled ? { ...c, count } : c))
    );
  };

  const toggleGroupCollapsed = (group: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const handleGenerate = () => {
    if (scopedEnabled.length === 0) return;
    onGenerate(scopedEnabled);
  };

  const handleSubmitJob = () => {
    if (!onSubmitAsJob) return;
    if (scopedEnabled.length === 0) return;
    onSubmitAsJob(scopedEnabled);
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
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">
            {scopeLabel} 범위
          </div>
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

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {domainTabs.map((tab) => {
            const isActive = activeDomainTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveDomainTab(tab.id)}
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
        <p className="text-[11px] text-gray-500">
          선택한 탭이 생성 범위가 됩니다. 일괄 선택·글 수 설정·생성 버튼 모두 현재 탭에만 적용됩니다.
        </p>
      </div>

      {/* ── 일괄 설정 바 ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700">
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {activeDomainTab === "all" ? "전체 일괄:" : `${getDomainGroupLabel(activeDomainTab)} 일괄:`}
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
          {activeDomainTab === "all" ? "전체 선택" : `${getDomainGroupLabel(activeDomainTab)}만 선택`}
        </button>
        <span className="text-xs text-emerald-400 whitespace-nowrap">
          {scopeLabel} {enabledCount}/{filteredSites.length}개
        </span>
        {activeDomainTab !== "all" && globalEnabledCount !== enabledCount && (
          <span className="text-[11px] text-gray-500 whitespace-nowrap hidden sm:inline">
            (전체 {globalEnabledCount}개)
          </span>
        )}
      </div>

      {/* ── 사이트 목록 (도메인 그룹별) ── */}
      {filteredSites.length === 0 ? (
        <div className="text-center py-8 text-gray-500">배포된 사이트가 없습니다.</div>
      ) : (
        <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
          {(() => {
            // 도메인 그룹별로 정렬하여 표시
            const grouped = new Map<DomainGroup, SiteCredential[]>();
            for (const site of filteredSites) {
              const group = getDomainGroup(site);
              if (!grouped.has(group)) grouped.set(group, []);
              grouped.get(group)!.push(site);
            }
            const entries = Array.from(grouped.entries());
            const showHeaders = activeDomainTab === "all" && entries.length > 1;
            return entries.map(([group, groupSites]) => {
              const color = getDomainGroupColor(group);
              const isCollapsed = collapsedGroups.has(group);
              const groupEnabledCount = groupSites.filter((s) =>
                configs.find((c) => c.siteSlug === s.slug)?.enabled
              ).length;
              return (
              <div key={group}>
                {showHeaders && (
                  <div className={`flex items-center gap-2 px-3 py-2 mt-2 first:mt-0 border-l-2 ${color.border}`}>
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(group)}
                      className="flex items-center gap-1.5 text-xs font-semibold hover:opacity-80"
                      title={isCollapsed ? "펼치기" : "접기"}
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"} ${color.text}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <span className={color.text}>{getDomainGroupLabel(group)}</span>
                    </button>
                    <span className="text-[10px] text-gray-500">
                      {groupEnabledCount}/{groupSites.length}개
                    </span>

                    {/* 도메인별 선택/해제 */}
                    <div className="ml-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setGroupEnabled(group, true)}
                        className="px-2 h-6 text-[11px] rounded bg-gray-700 text-gray-200 hover:bg-emerald-500 hover:text-white transition-colors"
                      >
                        전체 선택
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupEnabled(group, false)}
                        className="px-2 h-6 text-[11px] rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                      >
                        해제
                      </button>
                    </div>

                    {/* 도메인별 일괄 글 수 */}
                    <div className="ml-auto flex items-center gap-1">
                      <span className="text-[10px] text-gray-500 mr-1 hidden sm:inline">일괄</span>
                      {COUNT_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setGroupCount(group, n)}
                          disabled={groupEnabledCount === 0}
                          className="w-7 h-6 text-[11px] rounded bg-gray-700 text-gray-300 hover:bg-emerald-500 hover:text-white font-semibold transition-colors disabled:opacity-40 disabled:hover:bg-gray-700 disabled:hover:text-gray-300"
                          title={groupEnabledCount === 0 ? "활성 사이트 없음" : `${getDomainGroupLabel(group)} 활성 사이트 ${n}개로`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!(showHeaders && isCollapsed) && groupSites.map((site) => {
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

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
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
                    <span className={`px-1.5 py-0.5 text-[10px] rounded flex-shrink-0 ${
                      getDomainGroup(site) === "myground.website"
                        ? "bg-purple-500/15 text-purple-400"
                        : "bg-cyan-500/15 text-cyan-400"
                    }`}>
                      {getDomainGroup(site)}
                    </span>
                  </div>
                  {site.url && (
                    <div className="text-[11px] text-gray-500 truncate mt-0.5">
                      {site.url}
                    </div>
                  )}
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
              );
            });
          })()}
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
        <div className="flex items-center gap-2">
          {onSubmitAsJob && totalArticles > 0 && (
            <button
              onClick={handleSubmitJob}
              className="px-5 py-2.5 rounded-xl font-semibold transition-all text-sm bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-500/20"
              title={`${scopeLabel} 범위: ${totalArticles}개 생성`}
            >
              🚀 백그라운드 Job ({scopeLabel} {totalArticles}개)
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={totalArticles === 0}
            className={`px-6 py-2.5 rounded-xl font-semibold transition-all text-sm ${
              totalArticles > 0
                ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
                : "bg-gray-800 text-gray-500 cursor-not-allowed"
            }`}
            title={totalArticles > 0 ? `${scopeLabel} 범위: ${totalArticles}개 생성` : ""}
          >
            {totalArticles > 0
              ? `${scopeLabel} ${totalArticles}개 실시간 생성 →`
              : "사이트를 선택하세요"}
          </button>
        </div>
      </div>
    </div>
  );
}
