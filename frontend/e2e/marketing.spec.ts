import { test, expect } from "@playwright/test";

test.describe("Pricing page", () => {
  test("renders all three plans", async ({ page }) => {
    await page.goto("/pricing");
    // Plan names are h3 headings inside their plan cards.
    await expect(page.getByRole("heading", { name: /^free$/i, level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^pro$/i,  level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^team$/i, level: 3 })).toBeVisible();
  });

  test("Pro plan is marked as most popular", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText(/most popular/i)).toBeVisible();
  });

  test("billing toggle switches between monthly and annual", async ({ page }) => {
    await page.goto("/pricing");
    // Default is annual — Pro shows $15
    await expect(page.getByText("$15").first()).toBeVisible();

    await page.getByRole("radio", { name: /monthly/i }).click();
    // Monthly — Pro shows $19
    await expect(page.getByText("$19").first()).toBeVisible();

    await page.getByRole("radio", { name: /annual/i }).click();
    await expect(page.getByText("$15").first()).toBeVisible();
  });

  test("comparison table is rendered", async ({ page }) => {
    await page.goto("/pricing");
    // The comparison table is a <table> with Free / Pro / Team / Feature
    // column headers. We pin to the table by role and verify all four columns
    // exist as <th> elements.
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    // Column headers are plain <th> (no scope attr), but Playwright still
    // resolves them as columnheader because they're inside <thead>.
    await expect(table.getByRole("columnheader", { name: /^feature$/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /^free$/i    })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /^pro$/i     })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /^team$/i    })).toBeVisible();
  });

  test("FAQ entries expand on click", async ({ page }) => {
    await page.goto("/pricing");
    const firstQ = page.getByText(/do i really need to pay/i);
    await expect(firstQ).toBeVisible();
    await firstQ.click();
    await expect(page.getByText(/the free plan is fully featured/i)).toBeVisible();
  });

  test("final CTA links to register", async ({ page }) => {
    await page.goto("/pricing");
    // The final CTA copy was updated to "Create an Account for Free".
    // Match by partial regex so future copy tweaks don't break the test.
    const cta = page.getByRole("link", { name: /create an account/i });
    // Two links match this regex (final CTA + maybe nav). Click the LAST one
    // (final CTA at the bottom of the page) to be specific.
    await cta.last().click();
    await expect(page).toHaveURL(/mode=register/);
  });
});

test.describe("Changelog page", () => {
  test("renders the page heading", async ({ page }) => {
    await page.goto("/changelog");
    await expect(page.getByRole("heading", { name: /what.?s new/i, level: 1 })).toBeVisible();
  });

  test("renders timeline entries", async ({ page }) => {
    await page.goto("/changelog");
    // Entries are <li> children of an <ol> (semantic chronological list).
    // Pin to the role 'listitem' inside the timeline list.
    const entries = page.locator("ol > li");
    await expect(entries.first()).toBeVisible();
    expect(await entries.count()).toBeGreaterThanOrEqual(3);
  });

  test("each entry has a date and version anchor", async ({ page }) => {
    await page.goto("/changelog");
    const firstEntry = page.locator("ol > li").first();
    // Each entry header has a <time dateTime=...> and a version link.
    await expect(firstEntry.locator("time")).toBeVisible();
    // Version anchor — `<a href="#vX.Y.Z">` inside the entry header
    await expect(firstEntry.locator('a[href^="#"]').first()).toBeVisible();
  });

  test("footer link to pricing navigates correctly", async ({ page }) => {
    await page.goto("/changelog");
    // Footer is the compact MarketingFooter — has a "Pricing" link.
    // Use the LAST match to skip any nav-bar Pricing link at the top.
    const pricingLinks = page.getByRole("link", { name: /^pricing$/i });
    await pricingLinks.last().click();
    await expect(page).toHaveURL(/\/pricing/);
  });
});
