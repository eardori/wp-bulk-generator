export function setupSSE(reply) {
    const existingHeaders = reply.getHeaders();
    for (const [name, value] of Object.entries(existingHeaders)) {
        if (value !== undefined) {
            reply.raw.setHeader(name, value);
        }
    }
    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    const send = (data) => {
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
//# sourceMappingURL=sse.js.map