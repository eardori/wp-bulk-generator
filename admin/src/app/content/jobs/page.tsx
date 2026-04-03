"use client";

import { useCallback, useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type ContentJob = {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  createdAt: string;
  updatedAt: string;
  totalArticles: number;
  generatedCount: number;
  publishedCount: number;
  failedCount: number;
  currentTask: string;
  log: string[];
  input: {
    productUrl: string;
    contentPrompt: string;
    siteConfigs: { slug: string; count: number }[];
    autoPublish: boolean;
  };
  errors: { siteSlug: string; message: string }[];
};

type JobsResponse = {
  jobs: ContentJob[];
  workerBusy: boolean;
  currentJobId: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { text: string; color: string; bg: string }> = {
  queued: { text: "대기 중", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  running: { text: "진행 중", color: "text-blue-400", bg: "bg-blue-400/10" },
  done: { text: "완료", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  error: { text: "오류", color: "text-red-400", bg: "bg-red-400/10" },
  cancelled: { text: "취소됨", color: "text-gray-400", bg: "bg-gray-400/10" },
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function calcProgress(job: ContentJob) {
  if (job.totalArticles === 0) return 0;
  if (job.input.autoPublish) {
    return Math.round((job.publishedCount / job.totalArticles) * 100);
  }
  return Math.round((job.generatedCount / job.totalArticles) * 100);
}

// ── Component ───────────────────────────────────────────────────────────────

export default function JobDashboardPage() {
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<ContentJob | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/list");
      if (!res.ok) return;
      const data: JobsResponse = await res.json();
      setJobs(data.jobs);
      setWorkerBusy(data.workerBusy);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const data: ContentJob = await res.json();
      setDetailJob(data);
    } catch {
      /* ignore */
    }
  }, []);

  // Initial + polling
  useEffect(() => {
    fetchJobs();
    const timer = setInterval(fetchJobs, 5000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  // Poll detail for expanded job
  useEffect(() => {
    if (!expandedId) {
      setDetailJob(null);
      return;
    }
    fetchDetail(expandedId);
    const timer = setInterval(() => fetchDetail(expandedId), 3000);
    return () => clearInterval(timer);
  }, [expandedId, fetchDetail]);

  const handleAction = async (id: string, action: "cancel" | "retry") => {
    setActionLoading(id);
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchJobs();
      if (expandedId === id) {
        await fetchDetail(id);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const completedJobs = jobs.filter((j) => j.status === "done" || j.status === "error" || j.status === "cancelled");

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400">Job 목록 로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            ⚙️ 콘텐츠 Job 대시보드
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            백그라운드 콘텐츠 생성/발행 작업을 모니터링합니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {workerBusy && (
            <span className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              Worker 실행 중
            </span>
          )}
          <button
            onClick={fetchJobs}
            className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition text-sm"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* Active Jobs */}
      {runningJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            진행 중 ({runningJobs.length})
          </h2>
          <div className="space-y-3">
            {runningJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                detail={expandedId === job.id ? detailJob : null}
                expanded={expandedId === job.id}
                onToggle={() => setExpandedId(expandedId === job.id ? null : job.id)}
                onAction={handleAction}
                actionLoading={actionLoading === job.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {jobs.length === 0 && (
        <div className="text-center py-16 border border-gray-800 rounded-2xl bg-gray-900/50">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-400">아직 생성된 Job이 없습니다.</p>
          <p className="text-gray-500 text-sm mt-1">
            콘텐츠 제작 페이지에서 &quot;백그라운드 Job으로 실행&quot;을 선택하세요.
          </p>
          <a
            href="/content"
            className="inline-block mt-4 px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium text-sm hover:brightness-110 transition"
          >
            콘텐츠 제작으로 이동
          </a>
        </div>
      )}

      {/* Completed Jobs */}
      {completedJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">
            완료 ({completedJobs.length})
          </h2>
          <div className="space-y-3">
            {completedJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                detail={expandedId === job.id ? detailJob : null}
                expanded={expandedId === job.id}
                onToggle={() => setExpandedId(expandedId === job.id ? null : job.id)}
                onAction={handleAction}
                actionLoading={actionLoading === job.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Job Card ────────────────────────────────────────────────────────────────

function JobCard({
  job,
  detail,
  expanded,
  onToggle,
  onAction,
  actionLoading,
}: {
  job: ContentJob;
  detail: ContentJob | null;
  expanded: boolean;
  onToggle: () => void;
  onAction: (id: string, action: "cancel" | "retry") => void;
  actionLoading: boolean;
}) {
  const st = STATUS_LABELS[job.status] || STATUS_LABELS.queued;
  const progress = calcProgress(job);
  const displayJob = detail || job;
  const siteCount = job.input.siteConfigs?.length || 0;
  const promptPreview = (job.input.contentPrompt || "").slice(0, 60);

  return (
    <div className="border border-gray-800 rounded-xl bg-gray-900/60 overflow-hidden hover:border-gray-700 transition">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-800/30 transition"
      >
        {/* Status badge */}
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.color} ${st.bg} shrink-0`}>
          {st.text}
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white truncate">
              {promptPreview || "콘텐츠 생성"}
            </span>
            <span className="text-xs text-gray-500 shrink-0">
              {siteCount}개 사이트 · {job.totalArticles}개 글
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {formatTime(job.createdAt)}
            {job.currentTask && job.status === "running" && (
              <span className="ml-2 text-blue-400">— {job.currentTask}</span>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 shrink-0">
          {(job.status === "running" || job.status === "done") && (
            <>
              <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    job.status === "done" ? "bg-emerald-400" : "bg-blue-400"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-10 text-right">{progress}%</span>
            </>
          )}
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatBox label="전체" value={displayJob.totalArticles} />
            <StatBox label="생성" value={displayJob.generatedCount} color="text-cyan-400" />
            <StatBox label="발행" value={displayJob.publishedCount} color="text-emerald-400" />
            <StatBox label="실패" value={displayJob.failedCount} color="text-red-400" />
          </div>

          {/* Log */}
          {displayJob.log.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">최근 로그</h4>
              <div className="max-h-48 overflow-y-auto bg-gray-950/50 rounded-lg p-3 space-y-0.5 text-xs font-mono text-gray-400">
                {displayJob.log.slice(-20).map((line, i) => (
                  <div key={i} className={line.includes("에러") || line.includes("실패") ? "text-red-400" : ""}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {displayJob.errors.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-red-400 uppercase mb-2">
                오류 ({displayJob.errors.length})
              </h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {displayJob.errors.map((err, i) => (
                  <div key={i} className="text-xs text-red-300 bg-red-900/10 px-3 py-1.5 rounded">
                    <span className="font-medium">{err.siteSlug}</span> — {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {(job.status === "running" || job.status === "queued") && (
              <button
                onClick={() => onAction(job.id, "cancel")}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 transition text-sm disabled:opacity-50"
              >
                {actionLoading ? "처리 중..." : "❌ 취소"}
              </button>
            )}
            {(job.status === "error" || job.status === "cancelled") && (
              <button
                onClick={() => onAction(job.id, "retry")}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition text-sm disabled:opacity-50"
              >
                {actionLoading ? "처리 중..." : "🔄 재시도"}
              </button>
            )}
            <span className="text-xs text-gray-600 flex items-center ml-auto">
              ID: {job.id}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color = "text-white" }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center py-2 bg-gray-800/30 rounded-lg">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
