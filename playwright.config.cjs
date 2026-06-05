const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 120 * 1000,
  workers: 1,
  expect: {
    timeout: 12 * 1000
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4289",
    reducedMotion: "reduce",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npx http-server . -a 127.0.0.1 -p 4289 -c-1",
    url: "http://127.0.0.1:4289",
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: "desktop-firefox",
      use: {
        browserName: "firefox",
        viewport: { width: 1366, height: 768 }
      }
    },
    {
      name: "desktop-webkit",
      use: {
        browserName: "webkit",
        viewport: { width: 1366, height: 768 }
      }
    },
    {
      name: "mobile-android-chrome",
      use: {
        ...devices["Pixel 7"]
      }
    },
    {
      name: "mobile-android-narrow",
      use: {
        ...devices["Galaxy S8"]
      }
    },
    {
      name: "mobile-ios-safari",
      use: {
        ...devices["iPhone 14"]
      }
    }
  ]
});
