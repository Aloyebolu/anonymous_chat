/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_WEB_API: process.env.NEXT_PUBLIC_WEB_API,
    NEXT_PUBLIC_ADMIN_API: process.env.NEXT_PUBLIC_ADMIN_API
  }
};
export default nextConfig;