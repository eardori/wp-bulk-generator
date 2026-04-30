// Codex AEO 리뷰 (2026-04-21/22) 반영: WordPress user 의 display_name/description/slug 를
// persona 기반으로 동기화. publish 시점(publish-articles.ts)과 수동 트리거(/deploy/refresh-aeo)
// 둘 다에서 재사용되는 공용 로직. AEO 목표: AI 답변 엔진(ChatGPT/Gemini/Claude)에서 인용 시
// 작성자 identity 가 모든 신호(meta author, Yoast Person, author archive URL) 에서 일관되어야 함.
export async function syncWpAuthorFromPersona(site, baseUrl, wpHeaders, timeoutMs = 20000) {
    try {
        const meRes = await fetch(`${baseUrl}/wp-json/wp/v2/users/me?context=edit`, {
            headers: wpHeaders,
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!meRes.ok) {
            return { updated: false, error: `GET /users/me ${meRes.status}` };
        }
        const me = await meRes.json();
        const userId = Number(me?.id);
        if (!Number.isFinite(userId) || userId <= 0) {
            return { updated: false, error: "no userId from /users/me" };
        }
        const persona = site.persona;
        if (!persona?.name) {
            return { userId, updated: false, error: "no persona.name configured" };
        }
        const currentName = String(me?.name || "").trim();
        const currentDesc = String(me?.description || "").trim();
        const currentSlug = String(me?.slug || "").trim();
        const desiredName = persona.name.trim();
        const desiredDesc = (persona.bio || "").trim();
        const rawSlug = (persona.slug || site.slug || "").toLowerCase().trim();
        const desiredSlug = rawSlug.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        const nameNeedsSync = currentName !== desiredName;
        const descNeedsSync = !!desiredDesc && currentDesc !== desiredDesc;
        const slugNeedsSync = !!desiredSlug && currentSlug !== desiredSlug;
        if (!nameNeedsSync && !descNeedsSync && !slugNeedsSync) {
            return { userId, updated: false };
        }
        const updateRes = await fetch(`${baseUrl}/wp-json/wp/v2/users/${userId}`, {
            method: "POST",
            headers: wpHeaders,
            body: JSON.stringify({
                name: desiredName,
                first_name: desiredName,
                ...(desiredDesc ? { description: desiredDesc } : {}),
                ...(desiredSlug ? { slug: desiredSlug } : {}),
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!updateRes.ok) {
            const errText = await updateRes.text().catch(() => "");
            return {
                userId,
                updated: false,
                error: `POST /users/${userId} ${updateRes.status}: ${errText.slice(0, 200)}`,
            };
        }
        return {
            userId,
            updated: true,
            newName: desiredName,
            ...(desiredSlug ? { newSlug: desiredSlug } : {}),
            ...(desiredDesc ? { newDescription: desiredDesc } : {}),
        };
    }
    catch (e) {
        return { updated: false, error: e instanceof Error ? e.message : String(e) };
    }
}
//# sourceMappingURL=author-sync.js.map