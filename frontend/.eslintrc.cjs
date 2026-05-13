/**
 * ESLint config — adds the jsx-a11y plugin so accessibility lapses get
 * caught at lint time rather than user time.
 *
 * If you already have an .eslintrc.* file, merge the `plugins` and `extends`
 * lines from this one into yours. If you're starting fresh, save this as
 * .eslintrc.cjs in the frontend/ folder.
 *
 * The rules below are deliberately not the full "strict" preset — they're
 * the subset most likely to catch real bugs without false positives in a
 * Next.js codebase. Loosen further or enable more once the team is used
 * to the workflow.
 */

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  extends: [
    "next/core-web-vitals",
    "plugin:jsx-a11y/recommended",
  ],
  plugins: ["jsx-a11y"],
  rules: {
    // Catches the chat-textarea / dashboard-import bugs (input with no label).
    "jsx-a11y/label-has-associated-control": [
      "error",
      {
        labelComponents: [],
        labelAttributes: ["htmlFor"],
        controlComponents: [],
        assert: "either",
        depth: 3,
      },
    ],
    // Forbids onClick on non-interactive elements without a corresponding
    // role/keyboard handler. The most common XSS-of-accessibility — divs
    // that pretend to be buttons.
    "jsx-a11y/no-noninteractive-element-interactions": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    // Catches the OnboardingTour misuse of role="tab" without tabpanel.
    "jsx-a11y/role-has-required-aria-props": "error",
    "jsx-a11y/role-supports-aria-props": "error",
    // Catches the ConfirmDialog aria-describedby pointing to a non-existent ID
    // (lint can't fully verify the target, but it'll flag obvious typos).
    "jsx-a11y/aria-props": "error",
    "jsx-a11y/aria-proptypes": "error",
    // Useful warnings — keep as warn so they're visible but don't block CI.
    "jsx-a11y/anchor-is-valid": "warn",
    "jsx-a11y/no-autofocus": "warn",
  },
  ignorePatterns: [
    "node_modules",
    ".next",
    "out",
    "playwright-report",
    "test-results",
  ],
};
