import { GoogleGenerativeAI } from "@google/generative-ai";
import { setupSSE } from "../utils/sse.js";
// ── AI Platform Helpers ──────────────────────────────────────────────────────
function getGeminiClient() {
    const key = process.env.GEMINI_API_KEY;
    return key ? new GoogleGenerativeAI(key) : null;
}
async function callGemini(query) {
    const client = getGeminiClient();
    if (!client)
        throw new Error("GEMINI_API_KEY not set");
    const modelName = process.env.GEMINI_CONFIG_MODEL || "gemini-2.5-flash";
    const model = client.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(query);
    return { text: result.response.text(), model: modelName };
}
async function callOpenAI(query) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error("OPENAI_API_KEY not set");
    const modelName = "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: query }],
            max_tokens: 2000,
            temperature: 0.7,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API error: ${res.status} ${err.slice(0, 200)}`);
    }
    const data = (await res.json());
    return { text: data.choices?.[0]?.message?.content || "", model: modelName };
}
async function callAnthropic(query) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new Error("ANTHROPIC_API_KEY not set");
    const modelName = "claude-sonnet-4-20250514";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modelName,
            max_tokens: 2000,
            messages: [{ role: "user", content: query }],
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error: ${res.status} ${err.slice(0, 200)}`);
    }
    const data = (await res.json());
    return { text: data.content?.[0]?.text || "", model: modelName };
}
// ── Response Analysis ────────────────────────────────────────────────────────
function analyzeResponse(response, businessName) {
    const normalizedResponse = response.toLowerCase();
    const normalizedName = businessName.toLowerCase();
    // Check for mention — also handle partial name matches
    const nameParts = normalizedName.split(/\s+/);
    const mentioned = normalizedResponse.includes(normalizedName) ||
        (nameParts.length > 1 && nameParts.every((p) => normalizedResponse.includes(p)));
    let mentionPosition = null;
    let mentionContext = "";
    if (mentioned) {
        // Find position among recommendation list (look for numbered items)
        const lines = response.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(normalizedName) ||
                (nameParts.length > 1 && nameParts.every((p) => lines[i].toLowerCase().includes(p)))) {
                // Try to extract position from numbered list
                const numMatch = lines[i].match(/^[\s]*(\d+)[.):\s]/);
                mentionPosition = numMatch ? parseInt(numMatch[1]) : i + 1;
                // Extract context: ±2 lines
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length, i + 2);
                mentionContext = lines.slice(start, end).join("\n").trim();
                break;
            }
        }
    }
    // Sentiment analysis (simple keyword-based)
    let sentiment = "none";
    if (mentioned) {
        const positiveWords = ["추천", "좋은", "맛있", "인기", "유명", "최고", "훌륭", "뛰어난", "우수", "만족", "좋아요", "best", "great", "excellent", "popular", "recommend"];
        const negativeWords = ["별로", "나쁜", "실망", "비추", "안좋", "문제", "불만", "worst", "bad", "disappointing"];
        const contextLower = mentionContext.toLowerCase();
        if (positiveWords.some((w) => contextLower.includes(w)))
            sentiment = "positive";
        else if (negativeWords.some((w) => contextLower.includes(w)))
            sentiment = "negative";
        else
            sentiment = "neutral";
    }
    // Extract competitors (other business names mentioned in recommendations)
    const competitors = [];
    const lines = response.split("\n");
    for (const line of lines) {
        // Look for numbered recommendations
        const recMatch = line.match(/^\s*\d+[.):\s]+\**([^*\n(]+)/);
        if (recMatch) {
            const name = recMatch[1].trim().replace(/[:\-–—]/g, "").trim();
            if (name.length > 1 &&
                name.length < 30 &&
                !name.toLowerCase().includes(normalizedName) &&
                !(nameParts.length > 1 && nameParts.every((p) => name.toLowerCase().includes(p)))) {
                competitors.push(name);
            }
        }
    }
    return {
        mentioned,
        mentionPosition,
        mentionContext,
        sentiment,
        competitors: [...new Set(competitors)].slice(0, 10),
    };
}
function getAvailablePlatforms() {
    const platforms = [];
    if (process.env.OPENAI_API_KEY) {
        platforms.push({ id: "chatgpt", label: "ChatGPT", callFn: callOpenAI });
    }
    if (process.env.GEMINI_API_KEY) {
        platforms.push({ id: "gemini", label: "Gemini", callFn: callGemini });
    }
    if (process.env.ANTHROPIC_API_KEY) {
        platforms.push({ id: "claude", label: "Claude", callFn: callAnthropic });
    }
    return platforms;
}
// ── Query Templates ──────────────────────────────────────────────────────────
const QUERY_GENERATION_PROMPT = `당신은 AEO(Answer Engine Optimization) 전문가입니다.
아래 업체 정보를 바탕으로, 사용자가 ChatGPT/Gemini/Claude에게 물어볼 법한 자연스러운 한국어 쿼리를 7~10개 생성해주세요.

요구사항:
1. 일반 추천 쿼리 (예: "{지역} {업종} 추천해줘") 3~4개
2. 특정 서비스/메뉴 관련 (예: "{지역}에서 {서비스} 잘하는 곳") 2~3개  
3. 업체명 직접 언급 쿼리 (예: "{업체명} 어때?") 1~2개
4. 비교/리뷰 쿼리 (예: "{지역} {업종} 비교") 1개

JSON 배열로만 반환하세요. 설명 없이 배열만:
["쿼리1", "쿼리2", ...]`;
// ── Route ────────────────────────────────────────────────────────────────────
export async function aiTestRoutes(app) {
    // ─── POST /ai-test/generate-queries ────────────────────────
    // 업종/지역 기반 쿼리 자동 생성
    app.post("/ai-test/generate-queries", async (req) => {
        const body = req.body;
        if (!body.businessName || !body.location) {
            return { error: "업체명과 지역은 필수입니다." };
        }
        const client = getGeminiClient();
        if (!client) {
            return { error: "GEMINI_API_KEY가 설정되지 않았습니다." };
        }
        try {
            const model = client.getGenerativeModel({
                model: process.env.GEMINI_CONFIG_MODEL || "gemini-2.5-flash",
            });
            const prompt = `${QUERY_GENERATION_PROMPT}

업체 정보:
- 업체명: ${body.businessName}
- 업종: ${body.businessType}
- 지역: ${body.location}
- 상위 지역: ${body.broaderLocation || body.location}
- 서비스/음식 유형: ${body.serviceType || "일반"}`;
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            // Parse JSON array from response
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                return { error: "쿼리 생성 실패 — AI 응답을 파싱할 수 없습니다." };
            }
            const queries = JSON.parse(jsonMatch[0]);
            return {
                success: true,
                queries: queries.map((q) => ({ query: q, enabled: true })),
            };
        }
        catch (error) {
            return {
                error: `쿼리 생성 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
            };
        }
    });
    // ─── POST /ai-test/run ─────────────────────────────────────
    // 멀티 플랫폼 AI 테스트 실행 (SSE)
    app.post("/ai-test/run", async (req, reply) => {
        const body = req.body;
        if (!body.businessName) {
            return reply.status(400).send({ error: "업체명은 필수입니다." });
        }
        const enabledQueries = body.queries.filter((q) => q.enabled);
        if (enabledQueries.length === 0) {
            return reply.status(400).send({ error: "최소 1개 이상의 쿼리를 선택해주세요." });
        }
        const platforms = getAvailablePlatforms();
        if (platforms.length === 0) {
            return reply.status(400).send({
                error: "사용 가능한 AI 플랫폼이 없습니다. .env에 OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY 중 하나 이상을 설정해주세요.",
            });
        }
        const { send, close } = setupSSE(reply);
        try {
            send({
                type: "start",
                businessName: body.businessName,
                totalQueries: enabledQueries.length,
                platforms: platforms.map((p) => p.id),
                message: `${enabledQueries.length}개 쿼리 × ${platforms.length}개 플랫폼 테스트 시작...`,
            });
            const allResults = [];
            const citationCounts = {};
            const competitorMap = {};
            for (const platform of platforms) {
                citationCounts[platform.id] = 0;
            }
            for (let qi = 0; qi < enabledQueries.length; qi++) {
                const queryItem = enabledQueries[qi];
                send({
                    type: "query-start",
                    queryIndex: qi,
                    query: queryItem.query,
                    message: `쿼리 ${qi + 1}/${enabledQueries.length}: "${queryItem.query}"`,
                });
                const queryResult = {
                    query: queryItem.query,
                    platforms: {},
                };
                for (const platform of platforms) {
                    send({
                        type: "platform-start",
                        queryIndex: qi,
                        platform: platform.id,
                        message: `${platform.label} 테스트 중...`,
                    });
                    try {
                        const { text, model } = await platform.callFn(queryItem.query);
                        const analysis = analyzeResponse(text, body.businessName);
                        const result = {
                            platform: platform.id,
                            ...analysis,
                            fullResponse: text,
                            modelVersion: model,
                        };
                        queryResult.platforms[platform.id] = result;
                        if (analysis.mentioned) {
                            citationCounts[platform.id]++;
                        }
                        // Track competitors
                        for (const comp of analysis.competitors) {
                            competitorMap[comp] = (competitorMap[comp] || 0) + 1;
                        }
                        send({
                            type: "platform-result",
                            queryIndex: qi,
                            query: queryItem.query,
                            platform: platform.id,
                            mentioned: analysis.mentioned,
                            mentionPosition: analysis.mentionPosition,
                            sentiment: analysis.sentiment,
                            competitorsCount: analysis.competitors.length,
                            message: analysis.mentioned
                                ? `✅ ${platform.label}: ${analysis.mentionPosition ? analysis.mentionPosition + "위" : "언급됨"}`
                                : `❌ ${platform.label}: 언급 없음`,
                        });
                    }
                    catch (error) {
                        queryResult.platforms[platform.id] = {
                            platform: platform.id,
                            mentioned: false,
                            mentionPosition: null,
                            mentionContext: "",
                            sentiment: "none",
                            competitors: [],
                            fullResponse: "",
                            modelVersion: "",
                            error: error instanceof Error ? error.message : "API 호출 실패",
                        };
                        send({
                            type: "platform-error",
                            queryIndex: qi,
                            platform: platform.id,
                            error: error instanceof Error ? error.message : "API 호출 실패",
                            message: `⚠️ ${platform.label}: ${error instanceof Error ? error.message : "API 호출 실패"}`,
                        });
                    }
                    // Rate limit delay between platforms
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                allResults.push(queryResult);
            }
            // Calculate citation rates
            const citationRates = {};
            for (const platform of platforms) {
                citationRates[platform.id] = Math.round((citationCounts[platform.id] / enabledQueries.length) * 100);
            }
            const avg = Math.round(Object.values(citationRates).reduce((a, b) => a + b, 0) / platforms.length);
            // Sort competitors by frequency
            const topCompetitors = Object.entries(competitorMap)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]) => ({ name, count }));
            send({
                type: "done",
                businessName: body.businessName,
                totalQueries: enabledQueries.length,
                citationRates,
                averageCitationRate: avg,
                topCompetitors,
                results: allResults,
                message: `테스트 완료! 평균 인용률: ${avg}%`,
            });
        }
        catch (error) {
            send({
                type: "error",
                message: `오류: ${error instanceof Error ? error.message : "알 수 없음"}`,
            });
        }
        finally {
            close();
        }
    });
    // ─── GET /ai-test/platforms ────────────────────────────────
    // 사용 가능한 AI 플랫폼 목록
    app.get("/ai-test/platforms", async () => {
        const platforms = getAvailablePlatforms();
        return {
            success: true,
            platforms: platforms.map((p) => ({ id: p.id, label: p.label })),
            allPlatforms: [
                { id: "chatgpt", label: "ChatGPT", available: !!process.env.OPENAI_API_KEY },
                { id: "gemini", label: "Gemini", available: !!process.env.GEMINI_API_KEY },
                { id: "claude", label: "Claude", available: !!process.env.ANTHROPIC_API_KEY },
            ],
        };
    });
}
//# sourceMappingURL=ai-test.js.map