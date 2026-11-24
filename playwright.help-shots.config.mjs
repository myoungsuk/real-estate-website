// 관리자 '사용 안내' 단계 그림 찍기 전용 설정(npm run help:shots → scripts/help-shots.mjs가 부름). 평소 e2e 설정(playwright.config.mjs)은 이 파일들을 돌리지 않는다.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/help-shots",
  testMatch: "**/*.shot.mjs",
  outputDir: "test-results/help-shots",
  fullyParallel: true,
  workers: 3,
  reporter: "line",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4395",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
