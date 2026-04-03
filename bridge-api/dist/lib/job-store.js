import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
// ── Store ────────────────────────────────────────────────────────────────────
const DATA_DIR = join(process.env.JOB_DATA_DIR || join(process.cwd(), "data"), "jobs");
const MAX_LOG_LINES = 200;
function ensureDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}
function jobPath(id) {
    return join(DATA_DIR, `${id}.json`);
}
export function generateJobId() {
    return randomBytes(8).toString("hex");
}
export function createJob(input) {
    ensureDir();
    const totalArticles = input.siteConfigs.reduce((s, c) => s + c.count, 0);
    const job = {
        id: generateJobId(),
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input,
        totalArticles,
        generatedCount: 0,
        publishedCount: 0,
        failedCount: 0,
        currentTask: "대기 중...",
        log: [],
        articles: [],
        errors: [],
    };
    writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
    return job;
}
export function getJob(id) {
    ensureDir();
    const p = jobPath(id);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, "utf-8"));
    }
    catch {
        return null;
    }
}
export function listJobs(limit = 50) {
    ensureDir();
    const files = readdirSync(DATA_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit);
    return files.map((f) => {
        try {
            const raw = readFileSync(join(DATA_DIR, f), "utf-8");
            const job = JSON.parse(raw);
            // Return summary (no articles/full log for list)
            return {
                ...job,
                articles: [],
                log: job.log.slice(-5),
            };
        }
        catch {
            return null;
        }
    }).filter(Boolean);
}
export function updateJob(id, updates) {
    const job = getJob(id);
    if (!job)
        return null;
    const updated = {
        ...job,
        ...updates,
        updatedAt: new Date().toISOString(),
    };
    // Trim log
    if (updated.log.length > MAX_LOG_LINES) {
        updated.log = updated.log.slice(-MAX_LOG_LINES);
    }
    writeFileSync(jobPath(id), JSON.stringify(updated, null, 2));
    return updated;
}
export function appendJobLog(id, message) {
    const job = getJob(id);
    if (!job)
        return;
    job.log.push(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
    if (job.log.length > MAX_LOG_LINES) {
        job.log = job.log.slice(-MAX_LOG_LINES);
    }
    job.updatedAt = new Date().toISOString();
    writeFileSync(jobPath(id), JSON.stringify(job, null, 2));
}
export function cancelJob(id) {
    const job = getJob(id);
    if (!job)
        return false;
    if (job.status === "done" || job.status === "cancelled")
        return false;
    updateJob(id, {
        status: "cancelled",
        currentTask: "취소됨",
    });
    appendJobLog(id, "Job이 사용자에 의해 취소되었습니다.");
    return true;
}
export function deleteJob(id) {
    const p = jobPath(id);
    if (!existsSync(p))
        return false;
    unlinkSync(p);
    return true;
}
//# sourceMappingURL=job-store.js.map