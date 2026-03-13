"use client";

import { useState, useEffect, useRef } from "react";
import type { SiteCredential } from "@/app/content/types";

type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

function normalizeGroups(input: unknown): SiteGroup[] {
  if (Array.isArray(input)) {
    return input as SiteGroup[];
  }

  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as { groups?: unknown[] }).groups)
  ) {
    return (input as { groups: SiteGroup[] }).groups;
  }

  return [];
}

function normalizeSites(input: unknown): SiteCredential[] {
  return Array.isArray(input) ? (input as SiteCredential[]) : [];
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<SiteGroup[]>([]);
  const [sites, setSites] = useState<SiteCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New group creation
  const [isCreating, setIsCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupSlugs, setNewGroupSlugs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Inline name editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Confirm delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Site filter for create form
  const [siteFilter, setSiteFilter] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/content/site-groups").then((r) => r.json()),
      fetch("/api/content/fetch-sites").then((r) => r.json()),
    ]).then(([groupData, siteData]) => {
      setGroups(normalizeGroups(groupData.groups ?? groupData));
      setSites(normalizeSites(siteData.sites));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ── CRUD helpers ──────────────────────────────────────────────────

  const createGroup = async () => {
    if (!newGroupName.trim() || newGroupSlugs.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/content/site-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          group: { name: newGroupName.trim(), slugs: Array.from(newGroupSlugs) },
        }),
      });
      const data = await res.json();
      if (data.group) {
        setGroups((prev) => [...prev, data.group]);
        setIsCreating(false);
        setNewGroupName("");
        setNewGroupSlugs(new Set());
        setSiteFilter("");
      }
    } finally {
      setSaving(false);
    }
  };

  const renameGroup = async (id: string, name: string) => {
    if (!name.trim()) return;
    await fetch("/api/content/site-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", group: { id, name: name.trim() } }),
    });
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)));
    setEditingId(null);
  };

  const deleteGroup = async (id: string) => {
    await fetch("/api/content/site-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", group: { id } }),
    });
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setDeletingId(null);
  };

  // ── Navigate to content page with group preselected ───────────────

  const startContent = (group: SiteGroup) => {
    sessionStorage.setItem("preselectedGroupSlugs", JSON.stringify(group.slugs));
    sessionStorage.setItem("preselectedGroupName", group.name);
    window.location.href = "/content";
  };

  // ── Derived helpers ───────────────────────────────────────────────

  const getSitesForGroup = (group: SiteGroup) =>
    group.slugs.map((slug) => sites.find((s) => s.slug === slug)).filter(Boolean) as SiteCredential[];

  const filteredSites = sites.filter(
    (s) =>
      !siteFilter ||
      s.slug.toLowerCase().includes(siteFilter.toLowerCase()) ||
      (s.title || "").toLowerCase().includes(siteFilter.toLowerCase()) ||
      (s.persona?.name || "").toLowerCase().includes(siteFilter.toLowerCase())
  );

  const toggleNewSlug = (slug: string) => {
    setNewGroupSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const selectAll = () => setNewGroupSlugs(new Set(filteredSites.map((s) => s.slug)));
  const deselectAll = () => setNewGroupSlugs(new Set());

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <svg className="animate-spin h-5 w-5 mr-2 text-emerald-400" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">사이트 그룹</h2>
          <p className="text-gray-400 mt-1">
            사이트를 그룹으로 묶어 한 번에 콘텐츠를 생성하세요.
          </p>
        </div>
        <button
          onClick={() => {
            setIsCreating(true);
            setNewGroupName("");
            setNewGroupSlugs(new Set());
            setSiteFilter("");
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold text-sm hover:from-emerald-600 hover:to-cyan-600 transition-all shadow-lg shadow-emerald-500/20 whitespace-nowrap"
        >
          <span className="text-lg leading-none">+</span>
          새 그룹 만들기
        </button>
      </div>

      {/* ── 새 그룹 만들기 폼 ───────────────────────────────────────── */}
      {isCreating && (
        <div className="bg-gray-900 border border-emerald-500/30 rounded-2xl p-6 space-y-5 animate-slide-in">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">새 그룹 만들기</h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-gray-500 hover:text-gray-300 transition-colors text-xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Group name input */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">그룹 이름</label>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="예: 헬스케어 그룹, 뷰티 A팀..."
              className="w-full px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-sm"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }}
            />
          </div>

          {/* Site selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">
                사이트 선택
                <span className="ml-2 text-emerald-400 font-semibold">{newGroupSlugs.size}개 선택됨</span>
              </label>
              <div className="flex items-center gap-3 text-xs">
                <button onClick={selectAll} className="text-emerald-400 hover:text-emerald-300 transition-colors">
                  전체 선택
                </button>
                <button onClick={deselectAll} className="text-gray-500 hover:text-gray-300 transition-colors">
                  전체 해제
                </button>
              </div>
            </div>

            {/* Search input */}
            <input
              type="text"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              placeholder="사이트 검색..."
              className="w-full mb-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-xs"
            />

            {sites.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">
                배포된 사이트가 없습니다. 먼저 사이트를 생성하세요.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {filteredSites.map((site) => {
                  const checked = newGroupSlugs.has(site.slug);
                  return (
                    <div
                      key={site.slug}
                      onClick={() => toggleNewSlug(site.slug)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                        checked
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : "bg-gray-800/30 border-gray-800 hover:border-gray-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0 pointer-events-none"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-white truncate block">
                          {site.title || site.slug}
                        </span>
                        <span className="text-xs text-gray-500 truncate block">{site.domain}</span>
                      </div>
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form actions */}
          <div className="flex items-center justify-between pt-1 border-t border-gray-800">
            <span className="text-xs text-gray-500">
              {newGroupSlugs.size > 0
                ? `${newGroupSlugs.size}개 사이트 포함`
                : "사이트를 1개 이상 선택하세요"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                취소
              </button>
              <button
                onClick={createGroup}
                disabled={saving || !newGroupName.trim() || newGroupSlugs.size === 0}
                className={`px-5 py-2 text-sm rounded-lg font-semibold transition-all ${
                  !saving && newGroupName.trim() && newGroupSlugs.size > 0
                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                    : "bg-gray-800 text-gray-500 cursor-not-allowed"
                }`}
              >
                {saving ? "저장 중..." : "그룹 저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 그룹 목록 ─────────────────────────────────────────────── */}
      {groups.length === 0 && !isCreating ? (
        <div className="text-center py-20 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-800 flex items-center justify-center text-3xl">
            📁
          </div>
          <p className="text-gray-400 text-sm">아직 만든 그룹이 없습니다.</p>
          <button
            onClick={() => setIsCreating(true)}
            className="px-5 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all text-sm"
          >
            첫 번째 그룹 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const groupSites = getSitesForGroup(group);
            const isExpanded = expandedId === group.id;
            const isDeleting = deletingId === group.id;
            const isEditing = editingId === group.id;

            return (
              <div
                key={group.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden transition-all"
              >
                {/* Group header */}
                <div className="flex items-center gap-3 px-5 py-4">
                  {/* Expand toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : group.id)}
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Group name (editable) */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => renameGroup(group.id, editingName)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameGroup(group.id, editingName);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="bg-gray-800 border border-emerald-500 rounded-lg px-3 py-1 text-white text-base font-semibold focus:outline-none w-full max-w-xs"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className="text-base font-semibold text-white hover:text-emerald-300 cursor-pointer transition-colors"
                          onClick={() => {
                            setEditingId(group.id);
                            setEditingName(group.name);
                          }}
                          title="클릭하여 이름 변경"
                        >
                          {group.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({group.slugs.length}개 사이트)
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-gray-600 mt-0.5">
                      {new Date(group.createdAt).toLocaleDateString("ko-KR", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}{" "}
                      생성
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDeleting ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-400">삭제할까요?</span>
                        <button
                          onClick={() => deleteGroup(group.id)}
                          className="px-3 py-1 text-xs rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all font-semibold"
                        >
                          삭제
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-3 py-1 text-xs rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 transition-all"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => startContent(group)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-xs font-semibold hover:from-emerald-600 hover:to-cyan-600 transition-all shadow shadow-emerald-500/20"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.82m5.84-2.56a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 3.07a14.98 14.98 0 00-.79 4.56" />
                          </svg>
                          콘텐츠 생성
                        </button>
                        <button
                          onClick={() => setDeletingId(group.id)}
                          className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-all"
                          title="그룹 삭제"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded site list */}
                {isExpanded && (
                  <div className="border-t border-gray-800 px-5 pb-4 pt-3 animate-slide-in">
                    {groupSites.length === 0 ? (
                      <p className="text-gray-500 text-sm py-2">
                        이 그룹의 사이트를 찾을 수 없습니다. (삭제된 사이트일 수 있습니다)
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {groupSites.map((site) => (
                          <div
                            key={site.slug}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-800"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-white font-medium truncate block">
                                {site.title || site.slug}
                              </span>
                              <span className="text-xs text-gray-500 truncate block">{site.domain}</span>
                            </div>
                            {site.persona?.name && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/15 text-blue-400 flex-shrink-0">
                                {site.persona.name}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Missing sites warning */}
                    {group.slugs.length > groupSites.length && (
                      <p className="mt-2 text-xs text-amber-400/70">
                        ⚠ {group.slugs.length - groupSites.length}개 사이트를 찾을 수 없습니다
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary footer */}
      {groups.length > 0 && (
        <div className="text-center text-xs text-gray-600 pt-2">
          그룹 {groups.length}개 · 총 {groups.reduce((sum, g) => sum + g.slugs.length, 0)}개 사이트 등록됨
        </div>
      )}
    </div>
  );
}
