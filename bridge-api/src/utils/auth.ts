import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";

const API_KEY = process.env.BRIDGE_API_KEY || "";
const JWT_SECRET = process.env.BRIDGE_JWT_SECRET || "";

export function verifyApiKey(
  req: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) {
  const key = req.headers["x-bridge-api-key"];
  if (key === API_KEY) return done();

  // JWT 토큰 (클라이언트 직접 SSE용)
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const queryToken =
    (req.query as Record<string, string>)?.token ?? null;
  const jwtToken = token || queryToken;

  if (jwtToken) {
    try {
      const decoded = jwt.verify(jwtToken, JWT_SECRET);
      (req as Record<string, unknown>).bridgeUser = decoded;
      return done();
    } catch {
      reply.code(401).send({ error: "Invalid token" });
      return;
    }
  }

  reply.code(401).send({ error: "Unauthorized" });
}

export function signToken(payload: object, expiresIn = "15m"): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET);
}
