import js from "@eslint/js";

/**
 * Deliberately minimal, and deliberately NOT TypeScript-aware yet.
 *
 * `typescript-eslint` (and therefore `eslint-config-next`, which bundles
 * it) hard-refuses to run against TypeScript 7.x — its own compiled guard
 * throws "typescript-eslint does not support TS 7.0." at require time, not
 * a lint-time warning (github.com/typescript-eslint/typescript-eslint/
 * issues/10940). Its peerDependencies pin `typescript: ">=4.8.4 <6.1.0"`.
 * This project pins `typescript@7.0.2` (copied verbatim from
 * agent-control-tower's own skeleton, the current house standard), so no
 * version of typescript-eslint currently installs cleanly here, discovered
 * by trying eslint-config-next directly and hitting exactly that throw.
 *
 * Rather than downgrade TypeScript to get TS-aware lint rules, or ship a
 * `lint` script pinned to a dependency that cannot actually run, this
 * config lints plain JS/config files for real and explicitly excludes
 * `.ts`/`.tsx` sources — `npm run typecheck` (tsc, not eslint) is what
 * actually checks those today. Revisit once typescript-eslint supports
 * TS 7 (tracked in the issue above), or add it back per-file if a
 * milestone specifically needs TS-aware lint rules before then.
 */
export default [
  js.configs.recommended,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      ".genesis/**",
      "**/*.ts",
      "**/*.tsx",
    ],
  },
];
