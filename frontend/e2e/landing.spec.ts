import { test, expect } from "@playwright/test";

test.describe("Landing page — smoke", () => {
  test("loads with correct title + metadata", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/RepoInsight AI/);
    // OG image present
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveCount(1);
  });

  test("renders the hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /understand any codebase/i })).toBeVisible();
    await expect(page.getByText(/powered by anthropic claude/i)).toBeVisible();
  });

  test("has primary CTAs", async ({ page }) => {
    await page.goto("/");
    const startFree = page.getByRole("link", { name: /start free/i }).first();
    const login = page.getByRole("link", { name: /log in/i }).first();
    await expect(startFree).toBeVisible();
    await expect(login).toBeVisible();
  });

  test("trust row displays 3 commitments", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/no credit card required/i)).toBeVisible();
    await expect(page.getByText(/free for public repositories/i)).toBeVisible();
  });

  test("feature grid renders all 9 features", async ({ page }) => {
    await page.goto("/");
    const features = page.getByRole("article");
    await expect(features).toHaveCount(9);
  });

  test("footer links work", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /pricing/i }).first().click();
    await expect(page).toHaveURL(/\/pricing/);
  });
});

test.describe("Landing page — accessibility", () => {
  test("skip-to-content link is keyboard-focusable", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: /skip to main content/i });
    await expect(skipLink).toBeFocused();
  });

  test("main landmark is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();
  });

  test("all images have alt text", async ({ page }) => {
    await page.goto("/");
    const imgs = page.locator("img");
    const count = await imgs.count();
    for (let i = 0; i < count; i++) {
      const alt = await imgs.nth(i).getAttribute("alt");
      expect(alt).not.toBeNull();
    }
  });
});
