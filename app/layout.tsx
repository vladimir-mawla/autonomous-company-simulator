import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autonomous Company Simulator",
  description:
    "Who answers for what an organisation of autonomous agents has done: authority is conserved when delegated, revoked only forward, and every commitment is ruled binding, inherited or void.",
};

/**
 * Minimal App Router shell: infrastructure only. No project-specific UI
 * exists yet (that is M8's job). This file's only reason to exist at genesis
 * is so app/ has at least one real entry point for `npm run typecheck`
 * (tsconfig.json) and `npm run build` to check, ahead of M1's contracts and
 * M2's deployed health endpoint.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
