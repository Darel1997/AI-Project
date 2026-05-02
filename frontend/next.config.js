/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // Hide the Next.js dev indicator overlay (the "N" circle)
  // Covers all Next.js 14 config variants
  devIndicators: false,
};

module.exports = nextConfig;
