import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake barrel imports from large component libraries so we only ship
  // the components actually used. lucide-react / recharts / date-fns are
  // optimized by Next.js by default; these are the ones that aren't.
  experimental: {
    optimizePackageImports: ["radix-ui", "@base-ui/react", "motion"],
  },
  // Drop dev-only console noise from the production client bundle (keep
  // error/warn for real diagnostics).
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
};

export default nextConfig;
