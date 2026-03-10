"use client";

import { useState } from "react";
import type { GeneratedArticle, ReviewCollection } from "@/app/content/types";

type Props = {
  articles: GeneratedArticle[];
  reviewCollection?: ReviewCollection | null;
  onArticlesChange: (articles: GeneratedArticle[]) => void;
  onPublish: (articles: GeneratedArticle[]) => void;
  onBack: () => void;
};

/** Replace <!-- REVIEW_IMG:N:M --> placeholders with actual preview images */
function renderPreviewHtml(
  article: GeneratedArticle,
  html: string,
  reviewCollection: ReviewCollection | null | undefined
): string {
  return html.replace(/<!--\s*REVIEW_IMG:(\d+):(\d+)\s*-->/g, (match, rIdxStr, iIdxStr) => {
    const reviewIdx = parseInt(rIdxStr);
    const imgIdx = parseInt(iIdxStr);
    const articleImageIdx = article.usedReviewImageIndices?.findIndex(
      ([usedReviewIdx, usedImageIdx]) => usedReviewIdx === reviewIdx && usedImageIdx === imgIdx
    );
    const articleImg =
      articleImageIdx != null && articleImageIdx >= 0
        ? article.reviewImages?.[articleImageIdx]
        : undefined;
    const img = articleImg || reviewCollection?.reviews[reviewIdx]?.images?.[imgIdx];
    if (!img) return "";
    const src = img.thumbnailUrl || img.originalUrl;
    return `<figure style="margin:12px 0;"><img src="${src}" alt="리뷰 사진" style="max-width:100%;border-radius:8px;" loading="lazy" /><figcaption style="font-size:12px;color:#9ca3af;margin-top:4px;">실제 구매자 리뷰 사진</figcaption></figure>`;
  });
}

export default function ArticlePreviewList({
  articles,
  reviewCollection,
  onArticlesChange,
  onPublish,
  onBack,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  const toggleExpand = (id: string) => {
    setExpanded(expanded === id ? null : id);
    setEditingId(null);
  };

  const startEdit = (article: GeneratedArticle) => {
    setEditingId(article.id);
    setEditTitle(article.title);
    setEditContent(article.htmlContent);
  };

  const saveEdit = (articleId: string) => {
    const idx = articles.findIndex((a) => a.id === articleId);
    if (idx >= 0) {
      const nextArticles = [...articles];
      nextArticles[idx] = {
        ...nextArticles[idx],
        title: editTitle,
        htmlContent: editContent,
      };
      onArticlesChange(nextArticles);
    }
    setEditingId(null);
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">
            생성된 글 미리보기 ({articles.length}개)
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            각 글을 확인하고 수정할 수 있습니다. 준비되면 발행하세요.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            이전
          </button>
          <button
            onClick={() => onPublish(articles)}
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 transition-all shadow-lg shadow-emerald-500/20"
          >
            {articles.length}개 글 발행
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {articles.map((article) => (
          <div
            key={article.id}
            className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
          >
            {/* Header */}
            <div
              className="p-5 cursor-pointer hover:bg-gray-800/30 transition-colors"
              onClick={() => toggleExpand(article.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      {article.personaName}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-700/50 text-gray-400">
                      {article.siteSlug}
                    </span>
                    <span className="text-xs text-gray-500">{article.wordCount}단어</span>
                    {article.reviewImages && article.reviewImages.length > 0 && (
                      <span className="px-2 py-0.5 text-xs rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        리뷰사진 {article.reviewImages.length}장
                      </span>
                    )}
                  </div>
                  <h4 className="text-white font-medium">{article.title}</h4>
                  <p className="text-gray-400 text-sm mt-1 line-clamp-2">
                    {article.excerpt}
                  </p>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-500 transition-transform flex-shrink-0 ${
                    expanded === article.id ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <span className="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-400">
                  {article.category}
                </span>
                {article.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded bg-gray-700/50 text-gray-500"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Expanded content */}
            {expanded === article.id && (
              <div className="border-t border-gray-800 p-5 space-y-4">
                {/* Meta info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Meta Title:</span>
                    <p className="text-gray-300">{article.metaTitle}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Meta Description:</span>
                    <p className="text-gray-300">{article.metaDescription}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Slug:</span>
                    <p className="text-gray-300">{article.slug}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">FAQ:</span>
                    <p className="text-gray-300">{article.faqSchema.length}개 질문</p>
                  </div>
                </div>

                {/* Review images preview */}
                {article.reviewImages && article.reviewImages.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">포함된 리뷰 사진 ({article.reviewImages.length}장):</p>
                    <div className="flex gap-2 flex-wrap">
                      {article.reviewImages.map((img, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={img.thumbnailUrl || img.originalUrl}
                          alt="리뷰 사진"
                          className="w-20 h-20 object-cover rounded-lg bg-gray-800"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Edit mode */}
                {editingId === article.id ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={15}
                      className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(article.id)}
                        className="px-4 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(article);
                        }}
                        className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        수정
                      </button>
                    </div>
                    <div
                      className="prose prose-invert prose-sm max-w-none bg-gray-800/50 rounded-xl p-6 overflow-y-auto max-h-[500px]"
                      dangerouslySetInnerHTML={{
                        __html: renderPreviewHtml(article, article.htmlContent, reviewCollection),
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
