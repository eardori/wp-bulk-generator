import { getJob, updateJob, appendJobLog, listJobs, } from "./job-store.js";
import { fetchCredentials } from "./ec2-client.js";
// ── Configuration ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 12; // articles per bridge API call
const BRIDGE_PORT = Number(process.env.PORT) || 4000;
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";
let isProcessing = false;
let currentJobId = null;
let pollTimer = null;
async function callBridgeSSE(path, body, onEvent, signal) {
    const url = `http://127.0.0.1:${BRIDGE_PORT}${path}`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Bridge-API-Key": BRIDGE_API_KEY,
        },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Bridge API ${path} returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const reader = res.body?.getReader();
    if (!reader)
        throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data: "))
                continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]")
                continue;
            try {
                onEvent(JSON.parse(raw));
            }
            catch {
                // skip malformed JSON
            }
        }
    }
}
// ── Worker logic ────────────────────────────────────────────────────────────
async function processJob(job) {
    const { input } = job;
    currentJobId = job.id;
    updateJob(job.id, {
        status: "running",
        currentTask: "사이트 정보 로딩 중...",
    });
    appendJobLog(job.id, `Job 시작: ${input.siteConfigs.length}개 사이트, ${job.totalArticles}개 글`);
    // 1. Fetch site credentials
    let allSites;
    try {
        allSites = await fetchCredentials();
    }
    catch (err) {
        updateJob(job.id, {
            status: "error",
            currentTask: "사이트 인증 정보 로딩 실패",
        });
        appendJobLog(job.id, `에러: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    const siteMap = new Map();
    for (const s of allSites) {
        siteMap.set(String(s.slug || ""), s);
    }
    // Build siteConfigs with full credential info
    const fullSiteConfigs = input.siteConfigs
        .map((cfg) => {
        const site = siteMap.get(cfg.slug);
        if (!site)
            return null;
        return { site, count: cfg.count };
    })
        .filter(Boolean);
    if (fullSiteConfigs.length === 0) {
        updateJob(job.id, {
            status: "error",
            currentTask: "선택한 사이트를 찾을 수 없습니다.",
        });
        appendJobLog(job.id, "에러: 사이트 인증 정보에서 매칭되는 사이트가 없음");
        return;
    }
    appendJobLog(job.id, `${fullSiteConfigs.length}개 사이트 매칭 완료`);
    // 2. Generate articles in batches
    const allArticles = [];
    const totalTasks = fullSiteConfigs.reduce((s, c) => s + c.count, 0);
    let offset = 0;
    updateJob(job.id, { currentTask: "글 생성 중..." });
    while (offset < totalTasks) {
        // Check cancellation
        const current = getJob(job.id);
        if (!current || current.status === "cancelled") {
            appendJobLog(job.id, "Job이 취소되었습니다.");
            return;
        }
        const limit = Math.min(BATCH_SIZE, totalTasks - offset);
        const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(totalTasks / BATCH_SIZE);
        updateJob(job.id, {
            currentTask: `글 생성 배치 ${batchNum}/${totalBatches} (${offset + 1}~${offset + limit}/${totalTasks})`,
        });
        appendJobLog(job.id, `배치 ${batchNum}/${totalBatches} 시작 (${limit}개)`);
        try {
            const batchArticles = [];
            await callBridgeSSE("/generate-articles", {
                product: input.product,
                contentPrompt: input.contentPrompt,
                siteConfigs: fullSiteConfigs,
                reviewCollection: input.reviewCollection,
                offset,
                limit,
                globalTotal: totalTasks,
                aeoConfig: input.aeoConfig,
                contentStrategy: input.contentStrategy,
            }, (evt) => {
                if (evt.type === "article") {
                    batchArticles.push(evt.article);
                    const genCount = allArticles.length + batchArticles.length;
                    updateJob(job.id, {
                        generatedCount: genCount,
                        currentTask: `글 생성 ${genCount}/${totalTasks}`,
                    });
                }
                else if (evt.type === "progress") {
                    appendJobLog(job.id, String(evt.message || ""));
                }
                else if (evt.type === "error") {
                    appendJobLog(job.id, `생성 에러: ${evt.message}`);
                }
            });
            allArticles.push(...batchArticles);
            appendJobLog(job.id, `배치 ${batchNum} 완료: ${batchArticles.length}개 생성`);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            appendJobLog(job.id, `배치 ${batchNum} 실패: ${errMsg}`);
            // Continue to next batch despite errors
            const failCount = Math.min(limit, totalTasks - offset);
            updateJob(job.id, {
                failedCount: (getJob(job.id)?.failedCount || 0) + failCount,
            });
        }
        offset += limit;
        // Brief pause between batches
        if (offset < totalTasks) {
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    updateJob(job.id, {
        generatedCount: allArticles.length,
        articles: allArticles,
        currentTask: `글 생성 완료: ${allArticles.length}개`,
    });
    appendJobLog(job.id, `전체 생성 완료: ${allArticles.length}/${totalTasks}개`);
    // 3. Auto-publish if enabled
    if (input.autoPublish && allArticles.length > 0) {
        updateJob(job.id, { currentTask: "자동 발행 시작..." });
        appendJobLog(job.id, `자동 발행 시작: ${allArticles.length}개 글`);
        try {
            let publishedCount = 0;
            let pubFailCount = 0;
            const sitesForPublish = fullSiteConfigs.map((c) => c.site);
            await callBridgeSSE("/publish-articles", {
                articles: allArticles,
                sites: sitesForPublish,
            }, (evt) => {
                if (evt.type === "published") {
                    publishedCount++;
                    updateJob(job.id, {
                        publishedCount,
                        currentTask: `발행 ${publishedCount}/${allArticles.length}`,
                    });
                    appendJobLog(job.id, `발행 완료: ${evt.siteSlug} — ${evt.postUrl || ""}`);
                }
                else if (evt.type === "error") {
                    pubFailCount++;
                    const errSlug = String(evt.siteSlug || "unknown");
                    const errMsg = String(evt.message || "발행 실패");
                    updateJob(job.id, { failedCount: (getJob(job.id)?.failedCount || 0) + 1 });
                    appendJobLog(job.id, `발행 실패: ${errSlug} — ${errMsg}`);
                    // Store error
                    const current = getJob(job.id);
                    if (current) {
                        updateJob(job.id, {
                            errors: [...current.errors, { siteSlug: errSlug, message: errMsg }],
                        });
                    }
                }
                else if (evt.type === "progress") {
                    appendJobLog(job.id, String(evt.message || ""));
                }
            });
            updateJob(job.id, {
                publishedCount,
                currentTask: `발행 완료: ${publishedCount}개 성공, ${pubFailCount}개 실패`,
            });
            appendJobLog(job.id, `발행 완료: ${publishedCount}개 성공, ${pubFailCount}개 실패`);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            appendJobLog(job.id, `발행 프로세스 에러: ${errMsg}`);
        }
    }
    // 4. Mark done
    const finalJob = getJob(job.id);
    if (finalJob && finalJob.status !== "cancelled") {
        updateJob(job.id, {
            status: "done",
            currentTask: "완료",
        });
        appendJobLog(job.id, `Job 완료: 생성 ${finalJob.generatedCount}, 발행 ${finalJob.publishedCount}, 실패 ${finalJob.failedCount}`);
    }
}
// ── Poll loop ───────────────────────────────────────────────────────────────
async function pollOnce() {
    if (isProcessing)
        return;
    const jobs = listJobs(100);
    const queued = jobs.find((j) => j.status === "queued");
    if (!queued)
        return;
    // Re-read full job (listJobs returns summary)
    const fullJob = getJob(queued.id);
    if (!fullJob || fullJob.status !== "queued")
        return;
    isProcessing = true;
    try {
        await processJob(fullJob);
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateJob(fullJob.id, {
            status: "error",
            currentTask: `예외 발생: ${errMsg}`,
        });
        appendJobLog(fullJob.id, `치명적 에러: ${errMsg}`);
    }
    finally {
        isProcessing = false;
        currentJobId = null;
    }
}
export function startJobWorker() {
    if (pollTimer)
        return;
    pollTimer = setInterval(() => {
        pollOnce().catch((err) => {
            console.error("[job-worker] Poll error:", err);
        });
    }, POLL_INTERVAL_MS);
    console.log("[job-worker] Started (poll every 5s)");
}
export function stopJobWorker() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
export function getCurrentJobId() {
    return currentJobId;
}
export function isWorkerBusy() {
    return isProcessing;
}
//# sourceMappingURL=job-worker.js.map