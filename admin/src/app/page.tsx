"use client";

import { useEffect, useRef, useState } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";
import SiteGeneratorForm, {
  type SiteGenerationRequest,
} from "@/components/SiteGeneratorForm";
import SitePreviewTable from "@/components/SitePreviewTable";
import DeployProgress from "@/components/DeployProgress";

const REVEAL_DELAY_MS = 120;

export type SiteConfig = {
  site_slug: string;
  domain: string;
  site_title: string;
  tagline: string;
  persona: {
    name: string;
    age: number;
    concern: string;
    expertise: string;
    tone: string;
    bio: string;
  };
  color_scheme: {
    primary: string;
    secondary: string;
    accent: string;
    style: string;
  };
  categories: string[];
  initial_post_topics: string[];
  layout_preference: {
    homepage: string;
    sidebar: boolean;
    featured_image_style: string;
  };
};

export type DeployStatus = {
  status: "idle" | "generating" | "previewing" | "deploying" | "done" | "error";
  progress: number;
  total: number;
  currentSite: string;
  log: string[];
  successCount?: number;
  failureCount?: number;
  failedSites?: Array<{
    slug: string;
    reason: string;
  }>;
  credentials?: {
    admin_user: string;
    admin_pass: string;
    sites: Array<{
      slug: string;
      domain: string;
      url: string;
    }>;
  };
};

type GenerationState = {
  status: "idle" | "generating" | "previewing";
  requestedCount: number;
  generatedCount: number;
  totalBatches: number;
  doneBatches: number;
  progressMsg: string;
  partialWarning: string;
  error: string;
  streamComplete: boolean;
};

function createInitialDeployStatus(): DeployStatus {
  return {
    status: "idle",
    progress: 0,
    total: 0,
    currentSite: "",
    log: [],
  };
}

function createInitialGenerationState(): GenerationState {
  return {
    status: "idle",
    requestedCount: 0,
    generatedCount: 0,
    totalBatches: 0,
    doneBatches: 0,
    progressMsg: "",
    partialWarning: "",
    error: "",
    streamComplete: false,
  };
}

export default function Home() {
  const [configs, setConfigs] = useState<SiteConfig[]>([]);
  const [pendingConfigs, setPendingConfigs] = useState<SiteConfig[]>([]);
  const [formError, setFormError] = useState("");
  const [generation, setGeneration] = useState<GenerationState>(
    createInitialGenerationState()
  );
  const [deployStatus, setDeployStatus] = useState<DeployStatus>(
    createInitialDeployStatus()
  );
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRunIdRef = useRef(0);

  useEffect(() => {
    if (pendingConfigs.length === 0) return;

    const timer = window.setTimeout(() => {
      setPendingConfigs((prev) => {
        if (prev.length === 0) return prev;

        const [nextConfig, ...rest] = prev;
        if (nextConfig) {
          setConfigs((current) => [...current, nextConfig]);
        }
        return rest;
      });
    }, REVEAL_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pendingConfigs]);

  useEffect(() => {
    if (!generation.streamComplete || pendingConfigs.length > 0) return;
    if (generation.status !== "generating") return;

    if (generation.generatedCount > 0 || configs.length > 0) {
      setGeneration((prev) => ({ ...prev, status: "previewing" }));
      return;
    }

    const nextError =
      generation.error ||
      generation.partialWarning ||
      "사이트 설정을 생성하지 못했습니다.";
    setFormError(nextError);
    setGeneration(createInitialGenerationState());
  }, [
    configs.length,
    generation.error,
    generation.generatedCount,
    generation.partialWarning,
    generation.status,
    generation.streamComplete,
    pendingConfigs.length,
  ]);

  const handleGenerate = async (request: SiteGenerationRequest) => {
    generationAbortRef.current?.abort();
    generationRunIdRef.current += 1;
    const runId = generationRunIdRef.current;
    const abortController = new AbortController();
    generationAbortRef.current = abortController;

    setFormError("");
    setConfigs([]);
    setPendingConfigs([]);
    setDeployStatus(createInitialDeployStatus());
    setGeneration({
      status: "generating",
      requestedCount: request.count,
      generatedCount: 0,
      totalBatches: 0,
      doneBatches: 0,
      progressMsg: "AI가 사이트 설정을 생성하고 있습니다...",
      partialWarning: "",
      error: "",
      streamComplete: false,
    });

    let generatedCount = 0;

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/generate-configs",
        body: request,
        signal: abortController.signal,
      });

      await readSSEStream(reader, (event) => {
        if (generationRunIdRef.current !== runId) return;

        const type = event.type as string;

        if (type === "start") {
          setGeneration((prev) => ({
            ...prev,
            totalBatches: Number(event.totalBatches) || prev.totalBatches,
            progressMsg: "AI가 배치 단위로 사이트를 생성하고 있습니다...",
          }));
          return;
        }

        if (type === "progress") {
          setGeneration((prev) => ({
            ...prev,
            progressMsg: (event.message as string) || prev.progressMsg,
          }));
          return;
        }

        if (type === "batch") {
          const newConfigs = Array.isArray(event.configs)
            ? (event.configs as SiteConfig[])
            : [];
          const collected = Number(event.collected) || generatedCount + newConfigs.length;
          const totalBatches = Number(event.totalBatches) || 0;
          const batchIndex = Number(event.batchIndex) + 1;

          generatedCount = collected;
          setPendingConfigs((prev) => [...prev, ...newConfigs]);
          setGeneration((prev) => ({
            ...prev,
            generatedCount: collected,
            doneBatches: batchIndex,
            totalBatches: totalBatches || prev.totalBatches,
            progressMsg: `배치 ${batchIndex}/${totalBatches || "?"} 완료 - ${collected}개 생성됨`,
          }));
          return;
        }

        if (type === "batch_error") {
          const collected = Number(event.collected) || generatedCount;
          const totalBatches = Number(event.totalBatches) || generation.totalBatches;
          const batchIndex = Number(event.batchIndex) + 1;

          generatedCount = collected;
          setGeneration((prev) => ({
            ...prev,
            generatedCount: collected,
            doneBatches: batchIndex,
            totalBatches: totalBatches || prev.totalBatches,
            progressMsg: "",
            partialWarning: `⚠️ 배치 ${batchIndex}/${totalBatches || "?"}에서 중단됨 - ${collected}개까지 확보했습니다.`,
            streamComplete: true,
          }));
          return;
        }

        if (type === "done") {
          const total = Number(event.total) || generatedCount;
          generatedCount = total;

          setGeneration((prev) => ({
            ...prev,
            generatedCount: total,
            progressMsg:
              total > configs.length
                ? `🎉 생성 완료 - ${total}개를 화면에 순서대로 반영 중입니다.`
                : `🎉 완료! 총 ${total}개 생성됨`,
            streamComplete: true,
          }));
          return;
        }

        if (type === "error") {
          throw new Error(event.message as string);
        }
      });
    } catch (err) {
      if (generationRunIdRef.current !== runId) return;

      const message = err instanceof Error ? err.message : "알 수 없는 오류";

      if (message.toLowerCase().includes("abort")) {
        return;
      }

      if (generatedCount > 0) {
        setGeneration((prev) => ({
          ...prev,
          generatedCount,
          progressMsg: "",
          error: message,
          partialWarning:
            prev.partialWarning ||
            `⚠️ 오류 전까지 ${generatedCount}개는 생성되었습니다.`,
          streamComplete: true,
        }));
      } else {
        setFormError(message);
        setGeneration(createInitialGenerationState());
        setConfigs([]);
        setPendingConfigs([]);
      }
    } finally {
      if (generationAbortRef.current === abortController) {
        generationAbortRef.current = null;
      }
    }
  };

  const handleDeploy = async () => {
    setDeployStatus({
      status: "deploying",
      progress: 0,
      total: configs.length,
      currentSite: "",
      log: ["배포 시작..."],
    });

    try {
      const { reader } = await bridgeSSE({
        vercelEndpoint: "/api/deploy-sites",
        body: { configs },
      });

      await readSSEStream(reader, (data) => {
        setDeployStatus((prev) => ({
          ...prev,
          ...(data as Record<string, unknown>),
          log: data.message
            ? [...prev.log, data.message as string]
            : prev.log,
        }));
      });
    } catch (err) {
      setDeployStatus((prev) => ({
        ...prev,
        status: "error",
        log: [...prev.log, `오류: ${err}`],
      }));
    }
  };

  const handleReset = () => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    generationRunIdRef.current += 1;
    setConfigs([]);
    setPendingConfigs([]);
    setFormError("");
    setGeneration(createInitialGenerationState());
    setDeployStatus(createInitialDeployStatus());
  };

  const isGenerating = generation.status === "generating";
  const showReviewStep =
    deployStatus.status === "idle" && generation.status !== "idle";
  const canDeploy =
    generation.status === "previewing" &&
    pendingConfigs.length === 0 &&
    configs.length > 0;
  const progressPercent =
    generation.requestedCount > 0
      ? Math.round((generation.generatedCount / generation.requestedCount) * 100)
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">사이트 대량 생성</h2>
        <p className="text-gray-400 mt-1">
          니치를 입력하고 수량을 정하면, AI가 자동으로 WordPress 사이트를 생성합니다.
        </p>
      </div>

      {generation.status === "idle" && deployStatus.status === "idle" && (
        <SiteGeneratorForm
          isGenerating={false}
          externalError={formError}
          onGenerate={handleGenerate}
        />
      )}

      {showReviewStep && (
        <div className="space-y-6 animate-slide-in">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      isGenerating
                        ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    }`}
                  >
                    {isGenerating ? "생성 진행 중" : "생성 완료"}
                  </span>
                  <span className="text-sm text-gray-500">
                    {generation.doneBatches}/{generation.totalBatches || "?"} 배치
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-white">
                  {isGenerating
                    ? `${configs.length}/${generation.requestedCount}개가 화면에 추가되었습니다`
                    : `미리보기 — ${configs.length}개 사이트`}
                </h3>
                <p className="text-sm text-gray-400">
                  {isGenerating
                    ? "완료되는 사이트가 아래 목록에 하나씩 추가됩니다. 생성이 끝나면 바로 설치를 진행할 수 있습니다."
                    : "생성 결과를 확인한 뒤 설치를 실행하세요. 개별 항목 삭제는 완료 후 가능합니다."}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  처음으로
                </button>
                <button
                  type="button"
                  onClick={handleDeploy}
                  disabled={!canDeploy}
                  className={`px-6 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                    canDeploy
                      ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 shadow-lg shadow-emerald-500/20"
                      : "bg-gray-800 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {isGenerating
                    ? `생성 중... ${configs.length}/${generation.requestedCount}`
                    : "설치 실행"}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 text-sm text-gray-400 md:flex-row md:items-center md:justify-between">
                <span>{generation.progressMsg || "생성 준비 중..."}</span>
                <span className="text-cyan-300 font-semibold">
                  AI 생성 {generation.generatedCount}/{generation.requestedCount}개
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>목록 반영 {configs.length}개</span>
                <span>{progressPercent}%</span>
              </div>
            </div>

            {generation.partialWarning && (
              <div className="px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm">
                {generation.partialWarning}
              </div>
            )}

            {generation.error && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {generation.error}
              </div>
            )}
          </div>

          <SitePreviewTable
            configs={configs}
            setConfigs={setConfigs}
            disableEditing={isGenerating}
            emptyMessage={
              isGenerating
                ? "첫 번째 사이트를 준비 중입니다. 완료되는 대로 아래에 추가됩니다."
                : "표시할 사이트가 없습니다."
            }
          />
        </div>
      )}

      {(deployStatus.status === "deploying" ||
        deployStatus.status === "done" ||
        deployStatus.status === "error") && (
        <DeployProgress status={deployStatus} onReset={handleReset} />
      )}
    </div>
  );
}
