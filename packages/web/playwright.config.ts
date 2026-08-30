import { defineConfig } from "@playwright/test";

// E2E checks against the mock/fixture-backed client (VITE_USE_MOCK=1) -- no real API process, no
// LuaJIT bridge. See docs/decisions/0015-playwright-chromium-for-frontend-e2e-checks.md and
// docs/LEARNINGS.md "Frontend checks: Playwright + Chromium against the mock API".
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort",
    cwd: __dirname,
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_MOCK: "1" },
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
