"use client";

import { useRef, useEffect } from "react";
import type { DeployStatus } from "@/app/page";

type Props = {
  status: DeployStatus;
  onReset: () => void;
};

export default function DeployProgress({ status, onReset }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const credentials = status.credentials;
  const credentialSites = Array.isArray(credentials?.sites) ? credentials.sites : [];
  const adminUser = typeof credentials?.admin_user === "string" ? credentials.admin_user : "";
  const adminPass = typeof credentials?.admin_pass === "string" ? credentials.admin_pass : "";
  const failedSites = Array.isArray(status.failedSites) ? status.failedSites : [];
  const failureCount = typeof status.failureCount === "number" ? status.failureCount : failedSites.length;
  const successCount =
    typeof status.successCount === "number"
      ? status.successCount
      : Math.max(credentialSites.length, status.total - failureCount);
  const hasPartialFailure = failureCount > 0;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [status.log]);

  const percent =
    status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Status Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
        {status.status === "deploying" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="animate-spin h-5 w-5 text-emerald-400" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <h3 className="text-xl font-semibold text-white">
                  WordPress 설치 중...
                </h3>
              </div>
              <span className="text-2xl font-bold text-emerald-400">
                {status.progress}/{status.total}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all duration-500 animate-progress"
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="flex justify-between text-sm text-gray-400">
              <span>{status.currentSite && `현재: ${status.currentSite}`}</span>
              <span>{percent}%</span>
            </div>
          </div>
        )}

        {status.status === "done" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className={`text-5xl ${hasPartialFailure ? "text-amber-400" : ""}`}>&#10003;</div>
              <h3 className="text-2xl font-bold text-white">
                {hasPartialFailure
                  ? `${successCount}개 성공, ${failureCount}개 실패`
                  : `${status.total}개 사이트 생성 완료!`}
              </h3>
              <p className="text-gray-400">
                {hasPartialFailure
                  ? "실패한 사이트는 건너뛰고 나머지 설치를 계속 진행했습니다. 아래 실패 목록을 확인해주세요."
                  : "모든 WordPress 사이트가 성공적으로 설치되었습니다."}
              </p>
            </div>

            {hasPartialFailure && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 space-y-3">
                <h4 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">
                  실패한 사이트
                </h4>
                <div className="space-y-2 text-sm">
                  {failedSites.map((site, index) => (
                    <div
                      key={`${site.slug}-${index}`}
                      className="rounded-lg bg-gray-800/70 px-3 py-2"
                    >
                      <div className="font-medium text-white">{site.slug}</div>
                      <div className="text-gray-400">{site.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Credentials */}
            {credentials && (
              <div className="bg-gray-800/50 rounded-xl p-6 space-y-4">
                <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                  접속 정보
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">관리자 ID:</span>{" "}
                    <code className="text-emerald-400">{adminUser || "-"}</code>
                  </div>
                  <div>
                    <span className="text-gray-500">비밀번호:</span>{" "}
                    <code className="text-emerald-400">{adminPass || "-"}</code>
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  <h5 className="text-xs text-gray-500 uppercase">사이트 목록</h5>
                  {credentialSites.map((site, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-800 text-sm"
                    >
                      <span className="text-gray-300">{site.slug}</span>
                      <span className="text-gray-500">{site.domain}</span>
                      <a
                        href={`${site.url}/wp-admin`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        WP Admin &rarr;
                      </a>
                    </div>
                  ))}
                  {credentialSites.length === 0 && (
                    <div className="text-sm text-gray-500">표시할 사이트 정보가 없습니다.</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <button
                onClick={onReset}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold hover:from-emerald-600 hover:to-cyan-600 transition-all"
              >
                새로운 사이트 생성하기
              </button>
            </div>
          </div>
        )}

        {status.status === "error" && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <div className="text-5xl text-red-400">&#10007;</div>
              <h3 className="text-xl font-bold text-white">오류 발생</h3>
              <p className="text-gray-400">
                배포 중 문제가 발생했습니다. 로그를 확인해주세요.
              </p>
            </div>
            <div className="flex justify-center">
              <button
                onClick={onReset}
                className="px-6 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Output */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/50" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
            <div className="w-3 h-3 rounded-full bg-green-500/50" />
          </div>
          <span className="text-xs text-gray-500 ml-2">배포 로그</span>
        </div>
        <div
          ref={logRef}
          className="p-4 font-mono text-xs text-gray-400 max-h-64 overflow-y-auto space-y-0.5"
        >
          {status.log.map((line, i) => (
            <div
              key={i}
              className={
                line.includes("완료") || line.includes("✓")
                  ? "text-emerald-400"
                  : line.includes("오류") || line.includes("Error")
                  ? "text-red-400"
                  : line.includes("설치 중") || line.includes("...")
                  ? "text-cyan-400"
                  : "text-gray-400"
              }
            >
              <span className="text-gray-600 mr-2">
                {String(i + 1).padStart(3, "0")}
              </span>
              {line}
            </div>
          ))}
          {status.status === "deploying" && (
            <div className="text-gray-600 animate-pulse">&#9646;</div>
          )}
        </div>
      </div>
    </div>
  );
}
