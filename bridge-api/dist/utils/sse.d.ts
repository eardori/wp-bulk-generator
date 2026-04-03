import type { FastifyReply } from "fastify";
export declare function setupSSE(reply: FastifyReply): {
    send: (data: Record<string, unknown>) => void;
    close: () => void;
    heartbeat: NodeJS.Timeout;
};
//# sourceMappingURL=sse.d.ts.map