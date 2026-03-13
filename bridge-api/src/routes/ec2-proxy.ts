import type { FastifyInstance, FastifyReply } from "fastify";
import { ec2Fetch } from "../lib/ec2-client.js";

async function relayJson(reply: FastifyReply, response: Response) {
  const contentType =
    response.headers.get("content-type") || "application/json; charset=utf-8";
  const bodyText = await response.text();

  reply.code(response.status);
  reply.header("content-type", contentType);

  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export async function ec2ProxyRoutes(app: FastifyInstance) {
  app.get("/credentials", async (_req, reply) => {
    const response = await ec2Fetch("/credentials");
    return relayJson(reply, response);
  });

  app.get("/credentials/config", async (_req, reply) => {
    const response = await ec2Fetch("/credentials/config");
    return relayJson(reply, response);
  });

  app.post("/credentials/delete-sites", async (req, reply) => {
    const response = await ec2Fetch("/credentials/delete-sites", {
      method: "POST",
      body: JSON.stringify(req.body || {}),
    });

    return relayJson(reply, response);
  });

  app.get("/groups", async (_req, reply) => {
    const response = await ec2Fetch("/groups");
    return relayJson(reply, response);
  });

  app.post("/groups", async (req, reply) => {
    const response = await ec2Fetch("/groups", {
      method: "POST",
      body: JSON.stringify(req.body || {}),
    });

    return relayJson(reply, response);
  });

  app.post("/reserved-slugs", async (req, reply) => {
    const response = await ec2Fetch("/reserved-slugs", {
      method: "POST",
      body: JSON.stringify(req.body || {}),
    });

    return relayJson(reply, response);
  });
}
