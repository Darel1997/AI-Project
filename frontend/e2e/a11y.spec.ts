/**
 * Automated accessibility scans across the main public surfaces.
 *
 * Add to your CI alongside the existing Playwright suite. Catches ~40% of
 * common a11y issues automatically (missing labels, contrast, ARIA
 * misuse, focus order, landmark structure).
 *
 * Setup:
 *   npm install -D @axe-core/playwright
 *
 * Then drop this file in frontend/e2e/. Playwright will pick it up
 * automatically via its existing config.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Pages worth scanning. Skip authenticated routes for now — they need a
// logged-in fixture and that's a bigger setup. Once you have a test user,
// extend this list to /dashboard, /chat, /settings, etc.
const PUBLIC_PAGES: Array<{ name: string; path: string }> = [
  { name: "landing", path: "/" },
  { name: "pricing", path: "/pricing" },
  { name: "auth", path: "/auth?mode=login" },
  { name: "auth register", path: "/auth?mode=register" },
  { name: "changelog", path: "/changelog" },
];

for (const { name, path } of PUBLIC_PAGES) {
  test.describe(`a11y — ${name}`, () => {
    test(`has no axe-detectable violations`, async ({ page }) => {
      await page.goto(path);
      // Wait for the page to settle. axe runs against the live DOM, so
      // streaming content needs a beat. Replace this with a specific
      // wait if a page does lazy work.
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        // Scope to WCAG 2.1 AA + best-practice rules. The "experimental"
        // tag includes color-contrast which is high-value.
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        // Disable rules that are genuinely noisy on Next.js apps without
        // signaling real bugs. Re-enable individually as the codebase grows.
        .disableRules([
          // Next.js dev injects its overlay; can produce false positives
          // for "elements not in landmarks" until a build runs.
          "region",
        ])
        .analyze();

      if (results.violations.length > 0) {
        // Print a readable summary so the finding is easy to spot in CI logs.
        const summary = results.violations
          .map(
            (v) =>
              `  • [${v.impact}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n    ${v.nodes
                .slice(0, 3)
                .map((n) => "        " + n.target.join(" "))
                .join("\n")}`,
          )
          .join("\n");
        // eslint-disable-next-line no-console
        console.log(`\n[a11y/${name}] ${results.violations.length} violation(s):\n${summary}\n`);
      }

      // Strict gate: any axe-detectable violation on a public page fails CI.
      // If you hit this in a PR, the violation is in the log above. Fix the
      // CSS / markup; don't loosen this check without good reason — it's
      // the only thing keeping the public surface accessible over time.
      expect(results.violations).toEqual([]);
    });
  });
}

// Mobile breakpoint sweep — the marketing nav was completely unusable on
// phones before A1. Keep a smoke test in place so it doesn't regress.
test.describe("a11y — mobile marketing nav", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("hamburger menu opens and shows nav links", async ({ page }) => {
    await page.goto("/");
    const hamburger = page.getByRole("button", { name: /open menu/i });
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    const drawer = page.getByRole("dialog", { name: /site navigation/i });
    await expect(drawer).toBeVisible();

    // All canonical links should be reachable inside the drawer.
    await expect(drawer.getByRole("link", { name: /features/i })).toBeVisible();
    await expect(drawer.getByRole("link", { name: /pricing/i })).toBeVisible();
    await expect(drawer.getByRole("link", { name: /security/i })).toBeVisible();

    // Escape closes the drawer.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});
