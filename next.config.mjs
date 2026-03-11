/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['axios', 'cheerio'],
  },
};

export default nextConfig;
