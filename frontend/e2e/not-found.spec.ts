import { test, expect } from "@playwright/test";

test.describe("404 page", () => {
  test("unknown route shows not-found page", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByText(/404/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  });

  test("has primary recovery links", async ({ page }) => {
    await page.goto("/nonexistent");
    await expect(page.getByRole("link", { name: /go home/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open dashboard/i })).toBeVisible();
  });

  test("go-home link routes to landing", async ({ page }) => {
    await page.goto("/nonexistent");
    await page.getByRole("link", { name: /go home/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
