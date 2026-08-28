import { spawn } from "node:child_process";

const host = "127.0.0.1";
const port = 4321;
const origin = `http://${host}:${port}`;

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer(child) {
  const timeoutAt = Date.now() + 30_000;
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) throw new Error(`E2E 서버가 일찍 종료되었습니다.\n${output}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // 서버가 포트를 열 때까지 짧게 재시도합니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`E2E 서버 시작 시간을 초과했습니다.\n${output}`);
}

const server = spawn(process.execPath, ["scripts/serve-dist.mjs", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(server);
  const runner = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
    stdio: "inherit",
    env: { ...process.env, E2E_BASE_URL: origin },
  });
  const result = await waitForExit(runner);
  if (result.signal) throw new Error(`Playwright가 ${result.signal} 신호로 종료되었습니다.`);
  process.exitCode = result.code ?? 1;
} finally {
  server.kill();
}
