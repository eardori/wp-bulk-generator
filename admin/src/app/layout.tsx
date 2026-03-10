import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WP Bulk Generator — 어드민",
  description: "AI 기반 WordPress 대량 사이트 자동 생성 시스템",
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
              <a href="/" className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-cyan-400 rounded-lg flex items-center justify-center text-sm font-bold text-gray-900">
                  W
                </div>
                <span className="text-lg font-semibold text-white">WP Bulk Generator</span>
              </a>
              <div className="flex items-center gap-4 text-sm">
                <a href="/dashboard" className="text-gray-400 hover:text-white transition-colors">대시보드</a>
                <a href="/" className="text-gray-400 hover:text-white transition-colors">사이트 생성</a>
                <a href="/groups" className="text-gray-400 hover:text-white transition-colors">사이트 그룹</a>
                <a href="/content" className="text-gray-400 hover:text-white transition-colors">콘텐츠 제작</a>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                108.129.225.228
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
