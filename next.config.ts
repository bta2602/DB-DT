import type { NextConfig } from 'next';

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
    root: process.cwd(),
  },
};

export default nextConfig;
