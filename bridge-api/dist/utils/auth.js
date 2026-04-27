import jwt from "jsonwebtoken";
const API_KEY = process.env.BRIDGE_API_KEY || "";
const JWT_SECRET = process.env.BRIDGE_JWT_SECRET || "";
function getJwtSecrets() {
    return [...new Set([JWT_SECRET, API_KEY].filter(Boolean))];
}
function verifyJwtWithFallback(token) {
    let lastError;
    for (const secret of getJwtSecrets()) {
        try {
            return jwt.verify(token, secret);
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new Error("JWT secret is not configured");
}
function signJwtWithFallback(payload, expiresIn = "15m") {
    const [secret] = getJwtSecrets();
    if (!secret) {
        throw new Error("JWT secret is not configured");
    }
    return jwt.sign(payload, secret, { expiresIn });
}
const PUBLIC_PATHS = ["/health"];
const JWT_ROUTE_PREFIXES = {
    dashboard: ["/dashboard"],
    deploy: ["/deploy"],
    "generate-configs": ["/generate-configs"],
    reviews: ["/reviews/"],
    "generate-articles": ["/generate-articles"],
    "seo-optimize": ["/seo-optimize"],
    "publish-articles": ["/publish-articles"],
    "repair-sites": ["/repair-sites"],
    schema: ["/schema"],
    "schema-status": ["/schema/status"],
    "schema-install": ["/schema/install"],
    "ai-test": ["/ai-test"],
    "ai-test-run": ["/ai-test/run"],
    "score-checker": ["/score-checker"],
    "score-checker-analyze": ["/score-checker/analyze"],
};
function isJwtRouteAllowed(pathname, route) {
    const prefixes = JWT_ROUTE_PREFIXES[route];
    if (!prefixes)
        return false;
    return prefixes.some((prefix) => pathname.startsWith(prefix));
}
export function verifyApiKey(req, reply, done) {
    if (PUBLIC_PATHS.includes(req.url.split("?")[0]))
        return done();
    const key = req.headers["x-bridge-api-key"];
    if (key === API_KEY)
        return done();
    // JWT 토큰 (클라이언트 직접 SSE용)
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const queryToken = req.query?.token ?? null;
    const jwtToken = token || queryToken;
    if (jwtToken) {
        try {
            const decoded = verifyJwtWithFallback(jwtToken);
            const pathname = req.url.split("?")[0];
            const route = decoded && typeof decoded === "object" && "route" in decoded
                ? decoded.route
                : "";
            if (!isJwtRouteAllowed(pathname, route)) {
                reply.code(403).send({ error: "Token route mismatch" });
                done();
                return;
            }
            req.bridgeUser = decoded;
            return done();
        }
        catch {
            reply.code(401).send({ error: "Invalid token" });
            done();
            return;
        }
    }
    reply.code(401).send({ error: "Unauthorized" });
    done();
}
export function signToken(payload, expiresIn = "15m") {
    return signJwtWithFallback(payload, expiresIn);
}
export function verifyToken(token) {
    return verifyJwtWithFallback(token);
}
//# sourceMappingURL=auth.js.map