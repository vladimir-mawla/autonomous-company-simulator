import type { NextConfig } from "next";

/**
 * BUNDLER RECONCILIATION (the same surprise decision-engine, shadow-run,
 * memory-ledger, and agent-control-tower already hit and documented —
 * carried over verbatim as shared build tooling, per this project's own
 * house rule that infra is not conceptual code):
 *
 * lib/ will be frozen from M1 onward and every file in it will use relative
 * imports with an explicit ".js" extension pointing at a sibling ".ts" file
 * (e.g. lib/contracts/index.ts importing "./invariant.js", which is really
 * invariant.ts — the standard TypeScript `moduleResolution: "bundler"`
 * idiom, understood by tsc and by esbuild/Vite, which is why `npm test`
 * (vitest, esbuild-powered) resolves it fine).
 *
 * Next.js's bundlers do NOT resolve that pattern the same way:
 *   - Turbopack (Next 16's default, used by plain `next dev` / `next
 *     build`) fails outright — "Module not found" — for every one of
 *     lib/'s internal ".js"-suffixed imports. No Turbopack option in this
 *     Next version (`turbopack.resolveExtensions`, `resolveAlias`) makes
 *     it treat an explicit ".js" specifier as also matching a ".ts" file;
 *     those options only affect extension-less imports.
 *   - webpack resolves it once told to, via the (experimental, but
 *     verified working end-to-end on the sibling projects) `experimental.
 *     extensionAlias` option, mirroring webpack 5's native
 *     `resolve.extensionAlias`.
 *
 * So this project pins the webpack bundler explicitly (`next dev
 * --webpack`, `next build --webpack` in package.json) rather than
 * Turbopack's default, and declares the alias here. The alternative —
 * editing lib/'s import style to drop the ".js" extensions — is rejected
 * because lib/ will be frozen milestone by milestone: `git diff main --
 * lib/contracts/` must stay empty once M1 lands.
 *
 * Cost of this choice: the app builds one version behind Next's new
 * default bundler until either Turbopack adds an extension-alias
 * equivalent, or a later milestone recompiles lib/ into real .js output as
 * a build step instead of importing the .ts sources directly.
 */
const nextConfig: NextConfig = {
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
};

export default nextConfig;
