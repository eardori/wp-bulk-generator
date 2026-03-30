"use client";

import { useState, useCallback } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";

type SiteStatus = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  hasSchema: boolean;
  schemaTypes: string[];
  hasLocalBusiness: boolean;
  error?: string;
};

type LoadState = "idle" | "loading" | "loaded" | "installing" | "done" | "error";

type InstallLog = {
  slug: string;
  title: string;
  type: "installed" | "install-error";
  message: string;
};

export default function SchemaBulkInstaller() {
  const [state, setState] = useState<LoadState>("idle");
  const [sites, setSites] = useState<SiteStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installLogs, setInstallLogs] = useState<InstallLog[]>([]);
  const [loadError, setLoadError] = useState("");
  const [installStats, setInstallStats] = useState({ installed: 0, failed: 0 });

  // ── Load Schema Status ──────────────────────────────────────

  const loadStatus = useCallback(async () => {
    setState("loading");
    setSites([]);
    setSelected(new Set());
    setLoadError("");

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/schema/status",
        body: {},
        method: "GET",
      });

      await readSSEStream(reader, (data) => {
        if (data.type === "site-status") {
          const site: SiteStatus = {
            slug: data.slug as string,
            domain: data.domain as string,
            title: data.title as string,
            url: data.url as string,
            hasSchema: data.hasSchema as boolean,
            schemaTypes: data.schemaTypes as string[],
            hasLocalBusiness: data.hasLocalBusiness as boolean,
            error: data.error as string | undefined,
          };
          setSites((prev) => [...prev, site]);
        } else if (data.type === "done") {
          setState("loaded");
        } else if (data.type === "error") {
          setLoadError(data.message as string);
          setState("error");
        }
      });

      setState("loaded");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "상태 확인 실패");
      setState("error");
    }
  }, []);

  // ── Toggle Selection ────────────────────────────────────────

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

  const selectUninstalled = () => {
    setSelected(new Set(sites.filter((s) => !s.hasLocalBusiness).map((s) => s.slug)));
  };

  // ── Install Schema ──────────────────────────────────────────

  const handleInstall = useCallback(async () => {
    if (selected.size === 0) return;

    setState("installing");
    setInstallLogs([]);
    setInstallStats({ installed: 0, failed: 0 });

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/schema/install",
        body: { sites: Array.from(selected), schemaJson: "" },
      });

      await readSSEStream(reader, (data) => {
        if (data.type === "installed" || data.type === "install-error") {
          setInstallLogs((prev) => [
            ...prev,
            {
              slug: data.slug as string,
              title: data.title as string,
              type: data.type as "installed" | "install-error",
              message: data.message as string,
            },
          ]);
        } else if (data.type === "done") {
          setInstallStats({
            installed: (data.installed as number) || 0,
            failed: (data.failed as number) || 0,
          });
          setState("done");
        }
      });

      setState("done");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "설치 실패");
      setState("error");
    }
  }, [selected]);

  // ── Counts ──────────────────────────────────────────────────

  const withSchema = sites.filter((s) => s.hasLocalBusiness).length;
  const withoutSchema = sites.filter((s) => !s.hasLocalBusiness).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-sm">🏢</span>
            WP 사이트 Schema 관리
          </h3>
          <button
            type="button"
            onClick={loadStatus}
            disabled={state === "loading"}
            className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-medium rounded-xl hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {state === "loading" ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" className="opacity-75" />
                </svg>
                확인 중...
              </span>
            ) : state === "loaded" || state === "done" ? (
              "🔄 새로고침"
            ) : (
              "📡 상태 확인"
            )}
          </button>
        </div>
        <p className="text-sm text-gray-400">
          기존 워드프레스 사이트에 LocalBusiness Schema가 설치되어 있는지 확인하고, 미설치 사이트에 한 번에 설치합니다.
        </p>
      </div>

      {/* Loading */}
      {state === "loading" && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20" />
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
          </div>
          <div>
            <p className="text-sm text-cyan-300 font-medium">사이트 상태 확인 중...</p>
            <p className="text-xs text-gray-500 mt-0.5">{sites.length}개 확인됨</p>
          </div>
        </div>
      )}

      {/* Error */}
      {state === "error" && loadError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          ❌ {loadError}
        </div>
      )}

      {/* Sites Table */}
      {(state === "loaded" || state === "installing" || state === "done") && sites.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
          {/* Summary Bar */}
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-400">총 {sites.length}개 사이트</span>
              <span className="text-emerald-400">✅ {withSchema}개 설치됨</span>
              <span className="text-amber-400">⚠️ {withoutSchema}개 미설치</span>
            </div>
            <div className="flex items-center gap-2">
              {withoutSchema > 0 && (
                <button
                  type="button"
                  onClick={selectUninstalled}
                  className="px-3 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                >
                  미설치만 선택 ({withoutSchema})
                </button>
              )}
              <button
                type="button"
                onClick={toggleAll}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-700/50 text-gray-300 border border-gray-600/50 hover:bg-gray-700 transition-colors"
              >
                {selected.size === sites.length ? "전체 해제" : "전체 선택"}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-800/30">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === sites.length && sites.length > 0}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500/50"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">사이트</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">도메인</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Schema 상태</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Schema 종류</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {sites.map((site) => (
                  <tr
                    key={site.slug}
                    className={`hover:bg-gray-800/20 transition-colors cursor-pointer ${
                      selected.has(site.slug) ? "bg-violet-500/5" : ""
                    }`}
                    onClick={() => toggleSite(site.slug)}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(site.slug)}
                        onChange={() => toggleSite(site.slug)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500/50"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-white font-medium">{site.title}</p>
                      <p className="text-xs text-gray-500">{site.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {site.domain}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {site.error ? (
                        <span className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/20">
                          ⚠️ 확인 불가
                        </span>
                      ) : site.hasLocalBusiness ? (
                        <span className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          ✅ 설치됨
                        </span>
                      ) : site.hasSchema ? (
                        <span className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          ⚡ 일부만
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                          ❌ 미설치
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {site.schemaTypes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {site.schemaTypes.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700/50 text-gray-400"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Install Action Bar */}
          {selected.size > 0 && state !== "installing" && (
            <div className="px-6 py-4 border-t border-gray-800 bg-violet-500/5 flex items-center justify-between">
              <p className="text-sm text-violet-300">
                <span className="font-semibold">{selected.size}개</span> 사이트 선택됨
              </p>
              <button
                type="button"
                onClick={handleInstall}
                className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-medium rounded-xl hover:from-violet-500 hover:to-purple-500 transition-all"
              >
                🚀 선택한 사이트에 Schema 설치
              </button>
            </div>
          )}
        </div>
      )}

      {/* Install Progress */}
      {(state === "installing" || state === "done") && installLogs.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            {state === "installing" ? (
              <>
                <svg className="w-5 h-5 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" className="opacity-75" />
                </svg>
                설치 중...
              </>
            ) : (
              <>✨ 설치 완료</>
            )}
          </h3>

          {state === "done" && (
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-400">✅ {installStats.installed}개 설치</span>
              {installStats.failed > 0 && (
                <span className="text-red-400">❌ {installStats.failed}개 실패</span>
              )}
            </div>
          )}

          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {installLogs.map((log, idx) => (
              <div
                key={idx}
                className={`px-3 py-2 rounded-lg text-sm ${
                  log.type === "installed"
                    ? "bg-emerald-500/5 text-emerald-300"
                    : "bg-red-500/5 text-red-300"
                }`}
              >
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {state === "idle" && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gray-800/50 flex items-center justify-center mx-auto mb-4 text-2xl">
            📡
          </div>
          <p className="text-gray-400 text-sm">
            &quot;상태 확인&quot; 버튼을 클릭하면 모든 WP 사이트의 Schema 설치 상태를 확인합니다.
          </p>
        </div>
      )}
    </div>
  );
}
