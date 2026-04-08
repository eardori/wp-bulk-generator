import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "WP Bulk Generator — 어드민",
  description: "AI 기반 WordPress 대량 사이트 자동 생성 시스템 & AEO 툴킷",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-cyan-400 rounded-lg flex items-center justify-center text-sm font-bold text-gray-900">
                  W
                </div>
                <span className="text-lg font-semibold text-white">WP Bulk Generator</span>
              </Link>
              <div className="flex items-center gap-4 text-sm">
                <a href="/dashboard" className="text-gray-400 hover:text-white transition-colors">대시보드</a>
                <Link href="/" className="text-gray-400 hover:text-white transition-colors">사이트 생성</Link>
                <a href="/groups" className="text-gray-400 hover:text-white transition-colors">사이트 그룹</a>
                <a href="/content" className="text-gray-400 hover:text-white transition-colors">콘텐츠 제작</a>
                <a href="/content/jobs" className="text-gray-400 hover:text-white transition-colors flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  Job 대시보드
                </a>

                {/* AEO 도구 드롭다운 */}
                <div className="relative group">
                  <button className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span>
                    AEO 도구
                    <svg className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-all group-hover:translate-y-0.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <div className="absolute left-0 top-full pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    <div className="w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-800 bg-gradient-to-r from-violet-900/20 to-purple-900/20">
                        <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">AEO Toolkit</p>
                      </div>
                      <div className="py-1">
                        <a
                          href="/schema-generator"
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors group/item"
                        >
                          <span className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-sm group-hover/item:bg-violet-500/20 transition-colors">🔧</span>
                          <div>
                            <p className="text-sm font-medium text-gray-200 group-hover/item:text-white">웹사이트 Schema 생성기</p>
                            <p className="text-xs text-gray-500">JSON-LD 자동 생성</p>
                          </div>
                        </a>
                        <a
                          href="/ai-test"
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors group/item"
                        >
                          <span className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm group-hover/item:bg-cyan-500/20 transition-colors">🤖</span>
                          <div>
                            <p className="text-sm font-medium text-gray-200 group-hover/item:text-white">AI 검색 인용 테스트</p>
                            <p className="text-xs text-gray-500">멀티 플랫폼 인용 추적</p>
                          </div>
                        </a>
                        <a
                          href="/score-checker"
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors group/item"
                        >
                          <span className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm group-hover/item:bg-emerald-500/20 transition-colors">📊</span>
                          <div>
                            <p className="text-sm font-medium text-gray-200 group-hover/item:text-white">AI 검색 진단 스코어링</p>
                            <p className="text-xs text-gray-500">AI 노출 스코어링</p>
                          </div>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                EC2 Server
              </span>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
