/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_WEB_API: process.env.NEXT_PUBLIC_WEB_API ?? "http://localhost:3000",
    NEXT_PUBLIC_ADMIN_API: process.env.NEXT_PUBLIC_ADMIN_API ?? "http://localhost:3001"
  }
};
export default nextConfig;