import { test, expect } from "@playwright/test";

test.describe("Responsive behavior — mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("landing page nav hides Features link on narrow screens", async ({ page }) => {
    await page.goto("/");
    // Scope to the top-level nav landmark — the footer also has "Features"
    // and "Pricing" links that would otherwise match these queries.
    const nav = page.getByRole("navigation").first();

    // Features is `hidden sm:inline-flex` — hidden below 640px viewport.
    const featuresLink = nav.getByRole("link", { name: /^features$/i });
    await expect(featuresLink).toBeHidden();

    // Sanity check: the auth/register CTA in the nav is always visible.
    // We use the AuthNavButton — it always renders something (Sign in or
    // user avatar) regardless of viewport.
    await expect(nav.locator("a, button")).not.toHaveCount(0);
  });

  test("auth page hides left brand panel on mobile", async ({ page }) => {
    // Mock the GitHub probe so layout is stable for the visibility check
    await page.route("**/api/auth/github/status", route =>
      route.fulfill({ status: 200, body: JSON.stringify({ configured: true }) })
    );
    await page.goto("/auth");
    await expect(page.getByLabel(/^email/i)).toBeVisible();
    // Brand panel is `hidden lg:flex` — hidden below 1024px.
    const aside = page.locator("aside").first();
    await expect(aside).toBeHidden();
  });
});

test.describe("Responsive behavior — desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("landing page nav shows expected links", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: /^pricing$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^changelog$/i })).toBeVisible();
  });

  test("auth page shows brand panel with testimonial", async ({ page }) => {
    await page.route("**/api/auth/github/status", route =>
      route.fulfill({ status: 200, body: JSON.stringify({ configured: true }) })
    );
    await page.goto("/auth");
    // The brand panel is on the left at lg+ widths. We verify the structural
    // contract: a <blockquote> testimonial AND the stats grid below it.
    // Specific copy intentionally not asserted — marketing tweaks the
    // testimonial content periodically.
    await expect(page.locator("blockquote")).toBeVisible();
    // The stats grid below the blockquote shows three Stat blocks; the
    // "AI features" label is one of them and is a stable structural marker.
    await expect(page.getByText(/AI features/i)).toBeVisible();
  });
});
