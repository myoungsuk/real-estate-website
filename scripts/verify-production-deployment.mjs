import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deploymentMarkerScopes } from "./deployment-marker.mjs";

const DEFAULT_MARKER_URL = "https://leaderscityhappy.com/deployment-marker.json";

function validateOptions({ scope, expected, markerUrl, attempts, intervalMs }) {
  if (!Object.hasOwn(deploymentMarkerScopes, scope)) throw new Error(`알 수 없는 배포 marker scope입니다: ${scope}`);
  if (!/^[a-f0-9]{64}$/u.test(expected ?? "")) throw new Error("expected marker는 SHA-256 64자리 소문자여야 합니다.");
  const url = new URL(markerUrl);
  if (url.protocol !== "https:") throw new Error("Production marker URL은 HTTPS여야 합니다.");
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("attempts는 1 이상의 정수여야 합니다.");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) throw new Error("interval-ms는 0 이상의 정수여야 합니다.");
}

export async function waitForProductionDeployment({
  scope,
  expected,
  markerUrl = DEFAULT_MARKER_URL,
  attempts = 40,
  intervalMs = 10_000,
  fetcher = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  logger = console,
} = {}) {
  validateOptions({ scope, expected, markerUrl, attempts, intervalMs });
  let lastObservation = "응답 없음";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = new URL(markerUrl);
    url.searchParams.set("deployment_check", `${expected.slice(0, 12)}-${attempt}`);
    try {
      const response = await fetcher(url, {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          "User-Agent": "leaders-city-happy-deployment-check/1.0",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        lastObservation = `HTTP ${response.status}`;
      } else {
        const marker = await response.json();
        const observed = marker?.schemaVersion === 1 ? marker?.scopes?.[scope] : undefined;
        if (observed === expected) {
          logger.log(`Production 배포 marker 확인 완료: ${scope} ${expected}`);
          return marker;
        }
        lastObservation = typeof observed === "string" ? observed : "잘못된 marker 형식";
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }

    logger.log(`Production 배포 대기 ${attempt}/${attempts}: ${scope}, 현재 ${lastObservation}`);
    if (attempt < attempts) await sleep(intervalMs);
  }

  throw new Error(`Production 배포 marker가 제한 시간 안에 일치하지 않았습니다. scope=${scope}, expected=${expected}, last=${lastObservation}`);
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("모든 옵션은 --이름 값 형식이어야 합니다.");
    options[key.slice(2)] = value;
  }
  return {
    scope: options.scope,
    expected: options.expected,
    markerUrl: options.url ?? DEFAULT_MARKER_URL,
    attempts: options.attempts === undefined ? 40 : Number(options.attempts),
    intervalMs: options["interval-ms"] === undefined ? 10_000 : Number(options["interval-ms"]),
  };
}

async function main() {
  await waitForProductionDeployment(parseArguments(process.argv.slice(2)));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Production 배포 확인 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
