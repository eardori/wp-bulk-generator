"use client";

import { useState, useCallback } from "react";
import type { SchemaOutput } from "@/lib/schema-types";

interface SchemaPreviewProps {
  output: SchemaOutput | null;
}

// ─── Simple JSON Syntax Highlighter ─────────────────────────────────────────

function highlightJson(json: string): string {
  return json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // String values (including keys)
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="json-key">$1</span>:'
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="json-string">$1</span>'
    )
    // Standalone strings (in arrays)
    .replace(
      /(?<=[\[,]\s*)("(?:[^"\\]|\\.)*")/g,
      '<span class="json-string">$1</span>'
    )
    // Numbers
    .replace(
      /:\s*(\d+\.?\d*)/g,
      ': <span class="json-number">$1</span>'
    )
    // Booleans
    .replace(
      /:\s*(true|false)/g,
      ': <span class="json-boolean">$1</span>'
    );
}

// ─── Copy Button ────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all ${
        copied
          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
          : "bg-gray-800/50 border-gray-700 text-gray-300 hover:border-violet-500/50 hover:text-violet-300"
      }`}
    >
      {copied ? (
        <>
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          복사됨!
        </>
      ) : (
        <>
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
            <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

// ─── Code Block ─────────────────────────────────────────────────────────────

function CodeBlock({ title, code, badge }: { title: string; code: string; badge?: string }) {
  const highlighted = highlightJson(code);

  return (
    <div className="bg-gray-900/80 border border-gray-700/50 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/50 bg-gray-800/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{title}</span>
          {badge && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
              {badge}
            </span>
          )}
        </div>
        <CopyButton text={code} label="코드 복사" />
      </div>
      <div className="p-5 overflow-x-auto">
        <pre className="text-sm leading-relaxed font-mono">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    </div>
  );
}

// ─── Install Guide ──────────────────────────────────────────────────────────

function InstallGuide() {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800 bg-gradient-to-r from-emerald-900/20 to-teal-900/20">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <span className="text-lg">📖</span>
          설치 가이드
        </h3>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-violet-500/20 text-violet-300 text-xs flex items-center justify-center font-bold">1</span>
            HTML 직접 설치
          </h4>
          <p className="text-sm text-gray-400 pl-8">
            위에서 생성된 JSON-LD 코드를 복사하여 웹사이트의{" "}
            <code className="px-1.5 py-0.5 bg-gray-800 rounded text-violet-300 text-xs">&lt;/head&gt;</code> 태그 직전에 붙여넣기 하세요.
          </p>
          <div className="pl-8 bg-gray-800/30 border border-gray-700/50 rounded-lg p-3">
            <code className="text-xs text-gray-300 font-mono whitespace-pre">{`<script type="application/ld+json">
  { ... 복사한 JSON-LD 코드 ... }
</script>`}</code>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-violet-500/20 text-violet-300 text-xs flex items-center justify-center font-bold">2</span>
            워드프레스 설치
          </h4>
          <p className="text-sm text-gray-400 pl-8">
            [테마 설정] → [헤더 스크립트] 또는 [외모] → [테마 편집기] → header.php 에 붙여넣기 하세요.
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-violet-500/20 text-violet-300 text-xs flex items-center justify-center font-bold">3</span>
            검증
          </h4>
          <a
            href="https://search.google.com/test/rich-results"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 ml-8 px-4 py-2.5 text-sm rounded-xl border border-gray-700 text-gray-300 hover:border-emerald-500/50 hover:text-emerald-300 transition-all group"
          >
            <svg className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16 8 8 0 000-16zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.56-.5-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.56.5.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.497-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.03 11H4.083a6.004 6.004 0 002.783 4.118z" clipRule="evenodd" />
            </svg>
            Google Rich Results Test로 검증하기
            <svg className="w-3 h-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function SchemaPreview({ output }: SchemaPreviewProps) {
  if (!output) return null;

  const businessJson = JSON.stringify(output.businessSchema, null, 2);
  const faqJson = output.faqSchema
    ? JSON.stringify(output.faqSchema, null, 2)
    : null;

  // Full code for clipboard (wrapped in script tags)
  const fullCode = [
    `<script type="application/ld+json">\n${businessJson}\n</script>`,
    faqJson
      ? `\n<script type="application/ld+json">\n${faqJson}\n</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Success Header */}
      <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <span className="text-xl">✅</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Schema 생성 완료!</h3>
              <p className="text-sm text-gray-400">
                {faqJson ? "2개의 JSON-LD 블록이 생성되었습니다." : "1개의 JSON-LD 블록이 생성되었습니다."}
              </p>
            </div>
          </div>
          <CopyButton text={fullCode} label="전체 복사" />
        </div>
      </div>

      {/* Business Schema */}
      <CodeBlock
        title="LocalBusiness Schema"
        code={businessJson}
        badge={output.businessSchema["@type"] as string}
      />

      {/* FAQ Schema */}
      {faqJson && (
        <CodeBlock title="FAQ Schema" code={faqJson} badge="FAQPage" />
      )}

      {/* Install Guide */}
      <InstallGuide />
    </div>
  );
}
