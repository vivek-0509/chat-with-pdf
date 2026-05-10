/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "@langchain/community",
      "@langchain/qdrant",
      "@qdrant/js-client-rest",
    ],
  },
};

export default nextConfig;
