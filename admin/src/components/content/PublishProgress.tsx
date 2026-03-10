"use client";

import type { GeneratedArticle } from "@/app/content/types";

type Props = {
  articles: GeneratedArticle[];
  progress: { current: number; total: number };
  log: string[];
  isDone: boolean;
  onReset: () => void;
};

export default function PublishProgress({
  articles,
  progress,
  log,
  isDone,
  onReset,
}: Props) {
  const publishedArticles = articles.filter((a) => a.status === "published");
  const pct =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6 animate-slide-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        {isDone ? (
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        ) : (
          <svg
            className="animate-spin h-6 w-6 text-emerald-400"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        <div>
          <h3 className="text-xl font-semibold text-white">
            {isDone
              ? `발행 완료 (${publishedArticles.length}/${articles.length})`
              : `WordPress 발행 중... (${progress.current}/${progress.total})`}
          </h3>
          {!isDone && (
            <p className="text-sm text-gray-400">잠시만 기다려주세요.</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div
          className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all duration-500"
          style={{ width: `${isDone ? 100 : pct}%` }}
        />
      </div>

      {/* Published articles */}
      {publishedArticles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-300">발행된 글</h4>
          <div className="space-y-2">
            {publishedArticles.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-emerald-400 text-sm">&#10003;</span>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">
                      {a.title}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {a.personaName} &middot; {a.siteSlug}
                    </p>
                  </div>
                </div>
                {a.publishedUrl && (
                  <a
                    href={a.publishedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex-shrink-0 ml-2"
                  >
                    보기 &rarr;
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-300">진행 로그</h4>
        <div className="bg-gray-950 rounded-xl p-4 max-h-48 overflow-y-auto font-mono text-xs text-gray-400 space-y-1">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>

      {/* Actions */}
      {isDone && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onReset}
            className="px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20 transition-all"
          >
            새 콘텐츠 작성
          </button>
        </div>
      )}
    </div>
  );
}
