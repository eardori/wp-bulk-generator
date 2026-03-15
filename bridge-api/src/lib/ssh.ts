import { execFileSync, spawn, type ChildProcess } from "child_process";
import type { ServerTarget } from "./server-targets.js";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function ensureRemoteTarget(target: ServerTarget) {
  if (target.mode !== "ssh" || !target.host || !target.user || !target.keyPath) {
    throw new Error(`원격 SSH 설정이 완전하지 않습니다: ${target.id}`);
  }
}

function buildSshBaseArgs(target: ServerTarget): string[] {
  ensureRemoteTarget(target);
  return [
    "-i",
    target.keyPath!,
    "-o",
    "StrictHostKeyChecking=no",
    `${target.user}@${target.host}`,
  ];
}

export function execSsh(
  target: ServerTarget,
  command: string,
  timeout = 60000
): string {
  return execFileSync("ssh", [...buildSshBaseArgs(target), command], {
    encoding: "utf8",
    timeout,
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

export function spawnSsh(
  target: ServerTarget,
  command: string
): ChildProcess {
  return spawn("ssh", [...buildSshBaseArgs(target), command], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function scpToTarget(
  target: ServerTarget,
  localPath: string,
  remotePath: string,
  timeout = 60000
) {
  ensureRemoteTarget(target);
  execFileSync(
    "scp",
    [
      "-i",
      target.keyPath!,
      "-o",
      "StrictHostKeyChecking=no",
      localPath,
      `${target.user}@${target.host}:${remotePath}`,
    ],
    {
      timeout,
      maxBuffer: 50 * 1024 * 1024,
    }
  );
}
