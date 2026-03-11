import type { FastifyReply } from "fastify";

export function setupSSE(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (data: Record<string, unknown>) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    send({ type: "heartbeat", timestamp: Date.now() });
  }, 15000);

  const close = () => {
    clearInterval(heartbeat);
    reply.raw.end();
  };

  return { send, close, heartbeat };
}
