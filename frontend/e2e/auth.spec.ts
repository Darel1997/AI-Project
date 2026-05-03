import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Auth page renders the GitHub OAuth button only after a successful probe
 * of /api/auth/github/status — so in the e2e environment (no backend) we
 * intercept that request and return a canned "configured: true" response.
 *
 * Without this mock, the probe falls back to "configured: false" and the
 * GitHub button intentionally hides itself (correct production behaviour:
 * don't show a button that won't work).
 */
async function mockGithubProbe(page: Page, configured = true) {
  await page.route("**/api/auth/github/status", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured }),
    });
  });
}

test.describe("Auth page", () => {
  test("renders login mode by default", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("register mode renders full signup form", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth?mode=register");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
    await expect(page.getByLabel(/^name/i)).toBeVisible();
    await expect(page.getByLabel(/^email/i)).toBeVisible();
    await expect(page.getByLabel(/^password/i)).toBeVisible();
    await expect(page.getByLabel(/^confirm password/i)).toBeVisible();
  });

  test("mode toggle updates URL", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth?mode=login");
    await page.getByRole("button", { name: /create an account/i }).click();
    await expect(page).toHaveURL(/mode=register/);
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  });

  test("show/hide password toggle works", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth?mode=login");
    const pwInput = page.getByLabel(/^password/i);
    await pwInput.fill("secret123");
    await expect(pwInput).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show password/i }).click();
    await expect(pwInput).toHaveAttribute("type", "text");
  });

  test("password strength meter appears in register mode", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth?mode=register");
    await page.getByLabel(/^password/i).fill("weakpw");
    await expect(page.getByText(/weak|too short/i)).toBeVisible();

    await page.getByLabel(/^password/i).fill("StrongPass123!@#");
    await expect(page.getByText(/strong|good/i)).toBeVisible();
  });

  test("register requires matching passwords", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth?mode=register");
    await page.getByLabel(/^name/i).fill("Test User");
    await page.getByLabel(/^email/i).fill("test@example.com");
    await page.getByLabel(/^password/i).fill("password123");
    await page.getByLabel(/^confirm password/i).fill("different123");
    await expect(page.getByText(/don.?t match/i)).toBeVisible();
  });

  test("GitHub OAuth button renders when backend reports it is configured", async ({ page }) => {
    await mockGithubProbe(page, true);
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
  });

  test("GitHub OAuth button is hidden when backend reports it is NOT configured", async ({ page }) => {
    await mockGithubProbe(page, false);
    await page.goto("/auth");
    // Wait for the probe to settle by waiting for a stable element first
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    // Then assert the button is hidden
    await expect(page.getByRole("button", { name: /continue with github/i })).toHaveCount(0);
  });

  test("back-to-home link works", async ({ page }) => {
    await mockGithubProbe(page);
    await page.goto("/auth");
    // Mobile shows "← Back", desktop shows logo wordmark linking home.
    // Either is fine — pick whichever is visible at the test viewport.
    const backLink = page.getByRole("link", { name: /^back|home/i }).first();
    await expect(backLink).toBeVisible();
  });
});
