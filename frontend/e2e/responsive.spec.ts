import { test, expect } from "@playwright/test";

test.describe("Responsive behavior", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("landing page nav hides Features/Pricing/Changelog on narrow screens", async ({ page }) => {
    await page.goto("/");
    // The auth/login button should still be visible
    await expect(page.getByRole("link", { name: /log in/i }).first()).toBeVisible();
    // Features link is md+ only — should be hidden on mobile
    const featuresLink = page.getByRole("link", { name: /^features$/i }).first();
    await expect(featuresLink).toBeHidden();
  });

  test("auth page hides left brand panel on mobile", async ({ page }) => {
    await page.goto("/auth");
    // Email label still visible
    await expect(page.getByLabel(/^email/i)).toBeVisible();
    // Brand blockquote with the aside should be hidden
    const aside = page.locator("aside").first();
    await expect(aside).toBeHidden();
  });
});

test.describe("Responsive behavior — desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("landing page shows nav links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^pricing$/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^changelog$/i }).first()).toBeVisible();
  });

  test("auth page shows brand panel with testimonial", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.locator("blockquote")).toBeVisible();
    await expect(page.getByText(/10×/)).toBeVisible();
  });
});
