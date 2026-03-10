"use client";

import { useState, useEffect, useCallback } from "react";

type Persona = {
  name: string;
  age?: number;
  concern?: string;
  expertise?: string;
  tone?: string;
  bio?: string;
};

type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  app_pass: string;
  persona?: Persona;
};

type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

type WPPost = {
  id: number;
  title: { rendered: string };
  link: string;
  date: string;
};

type SitePostData = {
  posts: WPPost[];
  totalCount: number;
  loaded: boolean;
  error?: boolean;
};

type PostMap = Record<string, SitePostData>;

// ── helpers ──────────────────────────────────────────────────────────

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

// ── Spinner ────────────────────────────────────────────────────────

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg
      className={`animate-spin h-${size} w-${size} text-emerald-400`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Site Card ─────────────────────────────────────────────────────

function SiteCard({
  site,
  postData,
  groupNames,
}: {
  site: SiteCredential;
  postData?: SitePostData;
  groupNames: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  const totalCount = postData?.totalCount ?? 0;
  const posts = postData?.posts ?? [];
  const loaded = postData?.loaded ?? false;
  const hasError = postData?.error;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-all">
      {/* Card header */}
      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 mt-0.5" />
              <h3 className="text-sm font-semibold text-white truncate">
                {site.title || site.slug}
              </h3>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate ml-4">{site.domain}</p>
          </div>
          {/* Post count badge */}
          <div className="flex-shrink-0 text-right">
            {!loaded ? (
              <Spinner size={3} />
            ) : (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  totalCount > 0
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-gray-800 text-gray-500"
                }`}
              >
                {totalCount}개
              </span>
            )}
          </div>
        </div>

        {/* Persona + group tags */}
        <div className="flex flex-wrap gap-1 mt-2 ml-4">
          {site.persona?.name && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/15 text-blue-400">
              {site.persona.name}
            </span>
          )}
          {site.persona?.tone && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-400">
              {site.persona.tone}
            </span>
          )}
          {groupNames.map((g) => (
            <span key={g} className="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/15 text-purple-400">
              {g}
            </span>
          ))}
        </div>
      </div>

      {/* Posts preview */}
      {loaded && (
        <>
          {posts.length > 0 ? (
            <div className="border-t border-gray-800">
              {/* Show first 3 always */}
              <ul className="divide-y divide-gray-800/60">
                {(expanded ? posts : posts.slice(0, 3)).map((post) => (
                  <li key={post.id} className="px-4 py-2 flex items-start gap-2 group">
                    <span className="text-gray-600 text-xs mt-0.5 flex-shrink-0">•</span>
                    <div className="flex-1 min-w-0">
                      <a
                        href={post.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-300 group-hover:text-white transition-colors line-clamp-2 leading-4"
                        title={decodeHtml(post.title.rendered)}
                      >
                        {decodeHtml(post.title.rendered)}
                      </a>
                    </div>
                    <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5">
                      {formatDate(post.date)}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Expand toggle */}
              {posts.length > 3 && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-300 border-t border-gray-800/60 transition-colors flex items-center justify-center gap-1"
                >
                  {expanded ? (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                      접기
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                      +{posts.length - 3}개 더 보기
                      {totalCount > posts.length && ` (총 ${totalCount}개)`}
                    </>
                  )}
                </button>
              )}
              {/* Total count note */}
              {!expanded && totalCount > posts.length && (
                <p className="px-4 py-1.5 text-[10px] text-gray-600 border-t border-gray-800/60">
                  총 {totalCount}개 발행됨
                </p>
              )}
            </div>
          ) : (
            <div className="border-t border-gray-800 px-4 py-3">
              {hasError ? (
                <p className="text-xs text-red-400/70">연결 실패</p>
              ) : (
                <p className="text-xs text-gray-600">발행된 글 없음</p>
              )}
            </div>
          )}
        </>
      )}
      {!loaded && (
        <div className="border-t border-gray-800 px-4 py-3 flex items-center gap-2 text-xs text-gray-600">
          <Spinner size={3} />
          글 목록 불러오는 중...
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function DashboardPage() {
  const [sites, setSites] = useState<SiteCredential[]>([]);
  const [groups, setGroups] = useState<SiteGroup[]>([]);
  const [postMap, setPostMap] = useState<PostMap>({});
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [done, setDone] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const load = useCallback(() => {
    setLoading(true);
    setLoadingPosts(true);
    setDone(false);
    setSites([]);
    setGroups([]);
    setPostMap({});

    const es = fetch("/api/dashboard");
    es.then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "meta") {
              setSites(evt.sites || []);
              setGroups(evt.groups || []);
              setLoading(false);
            } else if (evt.type === "posts") {
              setPostMap((prev) => ({
                ...prev,
                [evt.slug]: {
                  posts: evt.posts || [],
                  totalCount: evt.totalCount ?? 0,
                  loaded: true,
                  error: evt.error,
                },
              }));
            } else if (evt.type === "done") {
              setDone(true);
              setLoadingPosts(false);
            }
          } catch {
            /* ignore */
          }
        }
      }
      setLoadingPosts(false);
      setDone(true);
    }).catch(() => {
      setLoading(false);
      setLoadingPosts(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Derived ────────────────────────────────────────────────────

  const totalPosts = Object.values(postMap).reduce((s, d) => s + (d.totalCount || 0), 0);
  const loadedCount = Object.keys(postMap).length;

  // Map slug → group names
  const slugToGroups: Record<string, string[]> = {};
  groups.forEach((g) => {
    g.slugs.forEach((slug) => {
      if (!slugToGroups[slug]) slugToGroups[slug] = [];
      slugToGroups[slug].push(g.name);
    });
  });

  // Filter sites
  const filteredSites = sites.filter((s) => {
    const matchText =
      !siteFilter ||
      s.slug.toLowerCase().includes(siteFilter.toLowerCase()) ||
      (s.title || "").toLowerCase().includes(siteFilter.toLowerCase()) ||
      (s.domain || "").toLowerCase().includes(siteFilter.toLowerCase()) ||
      (s.persona?.name || "").toLowerCase().includes(siteFilter.toLowerCase());

    const matchGroup =
      groupFilter === "all" ||
      (groupFilter === "ungrouped" && !(slugToGroups[s.slug]?.length > 0)) ||
      groups.find((g) => g.id === groupFilter)?.slugs.includes(s.slug);

    return matchText && matchGroup;
  });

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">대시보드</h2>
          <p className="text-gray-400 mt-1 text-sm">사이트 · 그룹 · 발행 현황을 한눈에 확인하세요.</p>
        </div>
        <button
          onClick={load}
          disabled={loadingPosts}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-all text-sm disabled:opacity-50"
        >
          <svg
            className={`w-4 h-4 ${loadingPosts ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          새로고침
        </button>
      </div>

      {/* ── Stats row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "총 사이트",
            value: loading ? "—" : `${sites.length}개`,
            icon: "🌐",
            color: "emerald",
          },
          {
            label: "사이트 그룹",
            value: loading ? "—" : `${groups.length}개`,
            icon: "📁",
            color: "blue",
          },
          {
            label: "총 발행 글",
            value: done ? `${totalPosts}개` : loadingPosts ? `${totalPosts}…` : "—",
            icon: "📝",
            color: "amber",
          },
          {
            label: "평균 글/사이트",
            value:
              done && sites.length > 0
                ? `${(totalPosts / sites.length).toFixed(1)}개`
                : loadingPosts
                ? "…"
                : "—",
            icon: "📊",
            color: "purple",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4"
          >
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── 사이트 그룹 ─────────────────────────────────────────── */}
      {!loading && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">사이트 그룹</h3>
          {groups.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-8 text-center text-gray-500 text-sm">
              생성된 그룹이 없습니다.{" "}
              <a href="/groups" className="text-emerald-400 hover:underline">
                그룹 만들기 →
              </a>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const groupSites = group.slugs
                  .map((slug) => sites.find((s) => s.slug === slug))
                  .filter(Boolean) as SiteCredential[];
                const groupTotal = group.slugs.reduce(
                  (s, slug) => s + (postMap[slug]?.totalCount ?? 0),
                  0
                );
                const isExpanded = expandedGroupId === group.id;

                return (
                  <div
                    key={group.id}
                    className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-800/30 transition-colors"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-white text-sm">{group.name}</span>
                        <span className="ml-2 text-xs text-gray-500">
                          {group.slugs.length}개 사이트
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-400 flex-shrink-0">
                        <span>
                          {loadingPosts && loadedCount < sites.length ? (
                            <span className="flex items-center gap-1">
                              <Spinner size={3} />
                              {groupTotal}개…
                            </span>
                          ) : (
                            <span className="font-semibold text-emerald-400">{groupTotal}개 글</span>
                          )}
                        </span>
                        <a
                          href="/groups"
                          onClick={(e) => e.stopPropagation()}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                        >
                          콘텐츠 생성
                        </a>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-800 px-5 py-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                          {groupSites.map((site) => {
                            const pd = postMap[site.slug];
                            return (
                              <div
                                key={site.slug}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-800"
                              >
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs text-white font-medium truncate block">
                                    {site.title || site.slug}
                                  </span>
                                  <span className="text-[10px] text-gray-500">
                                    {pd?.loaded ? `${pd.totalCount}개 글` : "…"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 사이트별 글 목록 ─────────────────────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <h3 className="text-lg font-semibold text-white flex-shrink-0">
            사이트별 글 목록
            {loadingPosts && (
              <span className="ml-2 text-sm font-normal text-gray-500 inline-flex items-center gap-1.5">
                <Spinner size={3} />
                {loadedCount}/{sites.length}
              </span>
            )}
          </h3>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-1">
            {/* Group filter */}
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-xs focus:outline-none focus:border-emerald-500"
            >
              <option value="all">전체 사이트</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value="ungrouped">그룹 미배정</option>
            </select>

            {/* Text search */}
            <input
              type="text"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              placeholder="사이트 검색..."
              className="flex-1 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 placeholder-gray-600 text-xs focus:outline-none focus:border-emerald-500 min-w-0"
            />

            {siteFilter && (
              <button
                onClick={() => setSiteFilter("")}
                className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 gap-3">
            <Spinner />
            불러오는 중...
          </div>
        ) : filteredSites.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            검색 결과가 없습니다.
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-600 mb-3">
              {filteredSites.length}개 사이트
              {siteFilter || groupFilter !== "all" ? ` (필터 적용됨)` : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredSites.map((site) => (
                <SiteCard
                  key={site.slug}
                  site={site}
                  postData={postMap[site.slug]}
                  groupNames={slugToGroups[site.slug] || []}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Done indicator */}
      {done && (
        <p className="text-center text-xs text-gray-700 pb-4">
          전체 {sites.length}개 사이트 · 총 {totalPosts}개 글 조회 완료
        </p>
      )}
    </div>
  );
}
