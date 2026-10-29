import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingExcludes: { '/*': ['./.studyhub/**/*', './.git/**/*'] },
  async redirects() {
    return [
      { source: '/studyhub/index.html', destination: '/', permanent: false },
      { source: '/studyhub', destination: '/', permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
