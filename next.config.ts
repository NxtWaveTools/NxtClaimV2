import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "80mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "exceljs",
      "@supabase/supabase-js",
      "zod",
      "react-hook-form",
      "@hookform/resolvers",
      "sonner",
      "next-themes",
    ],
  },
};

export default nextConfig;
