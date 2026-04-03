import { execFileSync, spawn } from "child_process";
export function shellQuote(value) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
function ensureRemoteTarget(target) {
    if (target.mode !== "ssh" || !target.host || !target.user || !target.keyPath) {
        throw new Error(`원격 SSH 설정이 완전하지 않습니다: ${target.id}`);
    }
}
function buildSshBaseArgs(target) {
    ensureRemoteTarget(target);
    return [
        "-i",
        target.keyPath,
        "-o",
        "StrictHostKeyChecking=no",
        `${target.user}@${target.host}`,
    ];
}
export function execSsh(target, command, timeout = 60000) {
    return execFileSync("ssh", [...buildSshBaseArgs(target), command], {
        encoding: "utf8",
        timeout,
        maxBuffer: 50 * 1024 * 1024,
    }).trim();
}
export function spawnSsh(target, command) {
    return spawn("ssh", [...buildSshBaseArgs(target), command], {
        stdio: ["ignore", "pipe", "pipe"],
    });
}
export function scpToTarget(target, localPath, remotePath, timeout = 60000) {
    ensureRemoteTarget(target);
    execFileSync("scp", [
        "-i",
        target.keyPath,
        "-o",
        "StrictHostKeyChecking=no",
        localPath,
        `${target.user}@${target.host}:${remotePath}`,
    ], {
        timeout,
        maxBuffer: 50 * 1024 * 1024,
    });
}
//# sourceMappingURL=ssh.js.map