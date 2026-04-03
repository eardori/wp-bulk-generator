import { type ChildProcess } from "child_process";
import type { ServerTarget } from "./server-targets.js";
export declare function shellQuote(value: string): string;
export declare function execSsh(target: ServerTarget, command: string, timeout?: number): string;
export declare function spawnSsh(target: ServerTarget, command: string): ChildProcess;
export declare function scpToTarget(target: ServerTarget, localPath: string, remotePath: string, timeout?: number): void;
//# sourceMappingURL=ssh.d.ts.map