import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function GET() {
  const sshHost = process.env.SSH_HOST || "108.129.225.228";
  const sshUser = process.env.SSH_USER || "ubuntu";
  const sshKeyPath =
    process.env.SSH_KEY_PATH ||
    "/Users/justinhong/Downloads/aiseo-eu-west-1.pem";
  const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${sshUser}@${sshHost}`;

  try {
    const output = execSync(
      `${sshCmd} "echo 'CONNECTED' && free -m | grep Mem | awk '{print \\$2,\\$3,\\$4}' && df -h / | tail -1 | awk '{print \\$2,\\$3,\\$5}' && ls -d /var/www/*/wp-config.php 2>/dev/null | wc -l"`,
      { timeout: 15000 }
    ).toString();

    const lines = output.trim().split("\n");
    const [totalMem, usedMem, freeMem] = (lines[1] || "0 0 0")
      .split(" ")
      .map(Number);
    const [diskTotal, diskUsed, diskPercent] = (lines[2] || "0 0 0%").split(
      " "
    );
    const siteCount = parseInt(lines[3] || "0");

    return NextResponse.json({
      connected: true,
      host: sshHost,
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percent: Math.round((usedMem / totalMem) * 100),
      },
      disk: {
        total: diskTotal,
        used: diskUsed,
        percent: diskPercent,
      },
      sites: siteCount,
    });
  } catch {
    return NextResponse.json(
      { connected: false, host: sshHost, error: "서버 연결 실패" },
      { status: 503 }
    );
  }
}
