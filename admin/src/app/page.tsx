"use client";

import { useState } from "react";
import { bridgeSSE, readSSEStream } from "@/lib/bridge-sse";
import SiteGeneratorForm from "@/components/SiteGeneratorForm";
import SitePreviewTable from "@/components/SitePreviewTable";
import DeployProgress from "@/components/DeployProgress";

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

export default function Home() {
  const [configs, setConfigs] = useState<SiteConfig[]>([]);
  const [deployStatus, setDeployStatus] = useState<DeployStatus>({
    status: "idle",
    progress: 0,
    total: 0,
    currentSite: "",
    log: [],
  });

  const handleConfigsGenerated = (newConfigs: SiteConfig[]) => {
    setConfigs(newConfigs);
    setDeployStatus((prev) => ({ ...prev, status: "previewing" }));
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
    setConfigs([]);
    setDeployStatus({
      status: "idle",
      progress: 0,
      total: 0,
      currentSite: "",
      log: [],
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">사이트 대량 생성</h2>
        <p className="text-gray-400 mt-1">
          니치를 입력하고 수량을 정하면, AI가 자동으로 WordPress 사이트를 생성합니다.
        </p>
      </div>

      {/* Step 1: Generate Configs */}
      {(deployStatus.status === "idle" || deployStatus.status === "generating") && (
        <SiteGeneratorForm
          onGenerated={handleConfigsGenerated}
          onStatusChange={(s) =>
            setDeployStatus((prev) => ({ ...prev, status: s }))
          }
        />
      )}

      {/* Step 2: Preview & Edit */}
      {deployStatus.status === "previewing" && configs.length > 0 && (
        <div className="space-y-6 animate-slide-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">
                미리보기 — {configs.length}개 사이트
              </h3>
              <p className="text-gray-400 text-sm mt-1">
                확인 후 &quot;설치 실행&quot;을 클릭하세요. 개별 항목 수정도 가능합니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
              >
                처음으로
              </button>
              <button
                onClick={handleDeploy}
                className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 transition-all shadow-lg shadow-emerald-500/20"
              >
                설치 실행
              </button>
            </div>
          </div>
          <SitePreviewTable configs={configs} setConfigs={setConfigs} />
        </div>
      )}

      {/* Step 3: Deploy Progress */}
      {(deployStatus.status === "deploying" || deployStatus.status === "done" || deployStatus.status === "error") && (
        <DeployProgress status={deployStatus} onReset={handleReset} />
      )}
    </div>
  );
}
