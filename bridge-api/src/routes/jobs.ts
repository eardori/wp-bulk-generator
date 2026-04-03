import type { FastifyInstance } from "fastify";
import {
  createJob,
  getJob,
  listJobs,
  cancelJob,
  updateJob,
  appendJobLog,
  type ContentJobInput,
} from "../lib/job-store.js";
import { isWorkerBusy, getCurrentJobId } from "../lib/job-worker.js";

export async function jobRoutes(app: FastifyInstance) {
  // ─── POST /jobs/content ── 새 Job 생성
  app.post("/jobs/content", async (req, reply) => {
    const {
      productUrl,
      contentPrompt,
      product,
      reviewCollection,
      siteConfigs,
      aeoConfig,
      contentStrategy,
      autoPublish = true,
    } = req.body as ContentJobInput & { autoPublish?: boolean };

    if (!product || !contentPrompt?.trim() || !siteConfigs?.length) {
      return reply.status(400).send({ error: "필수 데이터가 누락되었습니다." });
    }

    const input: ContentJobInput = {
      productUrl: productUrl || "",
      contentPrompt,
      product,
      reviewCollection: reviewCollection || null,
      siteConfigs,
      aeoConfig,
      contentStrategy,
      autoPublish,
    };

    const job = createJob(input);

    return {
      id: job.id,
      status: job.status,
      totalArticles: job.totalArticles,
      message: `Job 생성 완료. ${job.totalArticles}개 글이 백그라운드에서 처리됩니다.`,
    };
  });

  // ─── GET /jobs ── Job 목록 조회
  app.get("/jobs", async (req) => {
    const { limit, status } = req.query as { limit?: string; status?: string };
    const numLimit = Math.min(Number(limit) || 50, 200);

    let jobs = listJobs(numLimit);

    if (status) {
      jobs = jobs.filter((j) => j.status === status);
    }

    return {
      jobs,
      workerBusy: isWorkerBusy(),
      currentJobId: getCurrentJobId(),
    };
  });

  // ─── GET /jobs/:id ── Job 상세 조회
  app.get("/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);

    if (!job) {
      return reply.status(404).send({ error: "Job을 찾을 수 없습니다." });
    }

    // Return full job but limit articles for response size
    return {
      ...job,
      articles: job.articles.slice(0, 50), // Cap at 50 for response size
      articlesTotal: job.articles.length,
    };
  });

  // ─── POST /jobs/:id/cancel ── Job 취소
  app.post("/jobs/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const success = cancelJob(id);

    if (!success) {
      return reply.status(400).send({ error: "취소할 수 없는 상태입니다." });
    }

    return { message: "Job이 취소되었습니다." };
  });

  // ─── POST /jobs/:id/retry ── Job 재시도
  app.post("/jobs/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);

    if (!job) {
      return reply.status(404).send({ error: "Job을 찾을 수 없습니다." });
    }

    if (job.status !== "error" && job.status !== "cancelled") {
      return reply.status(400).send({ error: "재시도는 error/cancelled 상태에서만 가능합니다." });
    }

    // Reset and re-queue
    updateJob(id, {
      status: "queued",
      generatedCount: 0,
      publishedCount: 0,
      failedCount: 0,
      currentTask: "재시도 대기 중...",
      articles: [],
      errors: [],
    });
    appendJobLog(id, "재시도 요청됨 — 대기열에 추가");

    return { message: "Job이 대기열에 다시 추가되었습니다." };
  });

  // ─── GET /jobs/worker/status ── Worker 상태
  app.get("/jobs/worker/status", async () => {
    return {
      busy: isWorkerBusy(),
      currentJobId: getCurrentJobId(),
    };
  });
}
