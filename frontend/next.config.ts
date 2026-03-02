import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ftnwpvqmksaolgwuljbe.supabase.co",
      },
    ],
  },
};

export default nextConfig;
