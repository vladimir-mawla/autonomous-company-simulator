// Minimal ESM loader hook, node-builtins only (no new dependency — keeps
// this repo's "npm ci only" constraint intact): falls back from a
// ".js"-suffixed specifier to its sibling ".ts" file when resolution
// fails. This is the plain-`node` analogue of next.config.ts's own
// `experimental.extensionAlias` reconciliation, for the exact same reason:
// lib/** and domains/** use relative imports with an explicit ".js"
// extension pointing at a sibling ".ts" file (the standard
// `moduleResolution: "bundler"` idiom) — vitest resolves this fine because
// esbuild is told to; Next resolves it via webpack's extensionAlias
// (next.config.ts). Plain `node scripts/demo-company.ts`, with no bundler
// in front of it at all, needs the identical fallback taught to Node's own
// ESM resolver, via the public, stable `node:module` customization-hooks
// API (register()) — not a new npm dependency, not an edit to lib/'s own
// import style (lib/ is frozen). Copied verbatim from
// `~/Desktop/agent-control-tower/scripts/ts-loader-hooks.mjs` (which itself
// copied it from `~/Desktop/memory-ledger`) per this account's own house
// rule that shared build tooling is infra, not conceptual code
// (`.genesis/PLAN.md` §7 / §6, "infrastructure to copy vs. the core to
// invent").
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
      return await nextResolve(specifier.slice(0, -3) + ".ts", context);
    }
    throw err;
  }
}
