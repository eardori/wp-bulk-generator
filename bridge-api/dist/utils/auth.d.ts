import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";
export declare function verifyApiKey(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void;
export declare function signToken(payload: object, expiresIn?: string): string;
export declare function verifyToken(token: string): string | jwt.JwtPayload;
//# sourceMappingURL=auth.d.ts.map