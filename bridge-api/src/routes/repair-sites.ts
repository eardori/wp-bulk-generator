import { spawn } from "child_process";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";

const REPAIR_SCRIPT_PATH =
  process.env.REPAIR_SCRIPT_PATH ||
  "/home/ubuntu/wp-bulk-generator/scripts/backfill-existing-sites.sh";

function normalizeSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((slug) => (typeof slug === "string" ? slug.trim().toLowerCase() : ""))
    .filter((slug) => /^[a-z0-9-]{2,40}$/.test(slug));
}

export async function repairSitesRoutes(app: FastifyInstance) {
  app.post("/repair-sites", async (req, reply) => {
    const body = (req.body || {}) as { slugs?: unknown };
    const slugs = normalizeSlugs(body.slugs);

    const { send, close } = setupSSE(reply);

    try {
      const args = ["bash", REPAIR_SCRIPT_PATH];
      if (slugs.length > 0) {
        args.push("--slugs", slugs.join(","));
      }

      send({
        type: "progress",
        message:
          slugs.length > 0
            ? `선택한 ${slugs.length}개 사이트 복구 시작...`
            : "전체 사이트 복구 시작...",
      });

      const child = spawn("sudo", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      child.stdout?.on("data", (chunk: string) => {
        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          send({ type: "log", message: line });
        }
      });

      child.stderr?.on("data", (chunk: string) => {
        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          send({ type: "log", message: `[stderr] ${line}` });
        }
      });

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`복구 스크립트 종료 코드: ${code}`));
        });
        child.on("error", reject);
      });

      send({
        type: "done",
        status: "done",
        message: slugs.length > 0 ? "선택 사이트 복구 완료" : "전체 사이트 복구 완료",
      });
    } catch (error) {
      send({
        type: "error",
        status: "error",
        message: error instanceof Error ? error.message : "복구 중 알 수 없는 오류",
      });
    } finally {
      close();
    }
  });
}
