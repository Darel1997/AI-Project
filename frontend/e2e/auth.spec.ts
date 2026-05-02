import { test, expect } from "@playwright/test";

test.describe("Auth page", () => {
  test("renders login mode by default", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("register mode renders full signup form", async ({ page }) => {
    await page.goto("/auth?mode=register");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
    await expect(page.getByLabel(/^name/i)).toBeVisible();
    await expect(page.getByLabel(/^email/i)).toBeVisible();
    await expect(page.getByLabel(/^password/i)).toBeVisible();
    await expect(page.getByLabel(/^confirm password/i)).toBeVisible();
  });

  test("mode toggle updates URL", async ({ page }) => {
    await page.goto("/auth?mode=login");
    await page.getByRole("button", { name: /create an account/i }).click();
    await expect(page).toHaveURL(/mode=register/);
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  });

  test("show/hide password toggle works", async ({ page }) => {
    await page.goto("/auth?mode=login");
    const pwInput = page.getByLabel(/^password/i);
    await pwInput.fill("secret123");
    await expect(pwInput).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show password/i }).click();
    await expect(pwInput).toHaveAttribute("type", "text");
  });

  test("password strength meter appears in register mode", async ({ page }) => {
    await page.goto("/auth?mode=register");
    await page.getByLabel(/^password/i).fill("weakpw");
    await expect(page.getByText(/weak|too short/i)).toBeVisible();

    await page.getByLabel(/^password/i).fill("StrongPass123!@#");
    await expect(page.getByText(/strong|good/i)).toBeVisible();
  });

  test("register requires matching passwords", async ({ page }) => {
    await page.goto("/auth?mode=register");
    await page.getByLabel(/^name/i).fill("Test User");
    await page.getByLabel(/^email/i).fill("test@example.com");
    await page.getByLabel(/^password/i).fill("password123");
    await page.getByLabel(/^confirm password/i).fill("different123");
    await expect(page.getByText(/don.?t match/i)).toBeVisible();
  });

  test("GitHub OAuth button is present", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
  });

  test("back-to-home link works", async ({ page }) => {
    await page.goto("/auth");
    // Mobile might show "← Back", desktop doesn't (uses logo link)
    const backLink = page.getByRole("link", { name: /^back|home/i }).first();
    await expect(backLink).toBeVisible();
  });
});
