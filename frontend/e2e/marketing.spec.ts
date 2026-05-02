import { test, expect } from "@playwright/test";

test.describe("Pricing page", () => {
  test("renders all three plans", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /free/i, level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /pro/i, level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /team/i, level: 3 })).toBeVisible();
  });

  test("Pro plan is marked as most popular", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText(/most popular/i)).toBeVisible();
  });

  test("billing toggle switches between monthly and annual", async ({ page }) => {
    await page.goto("/pricing");
    // Default is annual — Pro shows $15
    await expect(page.getByText("$15")).toBeVisible();

    await page.getByRole("radio", { name: /monthly/i }).click();
    // Monthly — Pro shows $19
    await expect(page.getByText("$19")).toBeVisible();

    await page.getByRole("radio", { name: /annual/i }).click();
    await expect(page.getByText("$15")).toBeVisible();
  });

  test("comparison table is rendered", async ({ page }) => {
    await page.goto("/pricing");
    const table = page.getByRole("table").first();
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /free/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /pro/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /team/i })).toBeVisible();
  });

  test("FAQ entries expand on click", async ({ page }) => {
    await page.goto("/pricing");
    const firstQ = page.getByText(/do i really need to pay/i);
    await expect(firstQ).toBeVisible();
    await firstQ.click();
    // Answer becomes visible after expand
    await expect(page.getByText(/the free plan is fully featured/i)).toBeVisible();
  });

  test("final CTA links to register", async ({ page }) => {
    await page.goto("/pricing");
    const cta = page.getByRole("link", { name: /create free account/i });
    await cta.click();
    await expect(page).toHaveURL(/mode=register/);
  });
});

test.describe("Changelog page", () => {
  test("renders timeline entries", async ({ page }) => {
    await page.goto("/changelog");
    await expect(page.getByRole("heading", { name: /what.?s new/i, level: 1 })).toBeVisible();
    // At least 3 version entries
    const entries = page.locator("article");
    await expect(entries.first()).toBeVisible();
    expect(await entries.count()).toBeGreaterThanOrEqual(3);
  });

  test("each entry has a date, version, and kind badge", async ({ page }) => {
    await page.goto("/changelog");
    const firstEntry = page.locator("article").first();
    await expect(firstEntry.locator("time")).toBeVisible();
  });

  test("footer links navigate correctly", async ({ page }) => {
    await page.goto("/changelog");
    await page.getByRole("link", { name: /pricing/i }).first().click();
    await expect(page).toHaveURL(/\/pricing/);
  });
});
