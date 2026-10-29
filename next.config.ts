import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pre-rename addresses keep working: profile links people already shared,
  // and Persuna's page in older desktop installs. Remove after a release or two.
  async redirects() {
    return [
      { source: "/personas/:handle", destination: "/persunas/:handle", permanent: true },
      { source: "/persona", destination: "/persuna", permanent: true },
    ];
  },
  // Screen walkthroughs send up to 24 frames (2.5 MB each, usually ~150 KB) plus ~6 minutes of WAV narration.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Voice recording and screen walkthroughs need the mic and screen capture, on this site only.
            value: "camera=(), geolocation=(), microphone=(self), display-capture=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
