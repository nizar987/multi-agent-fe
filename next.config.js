/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@modelcontextprotocol/sdk"],
    workerThreads: false,
    cpus: 1,
    // MCP server di-spawn dinamis — pastikan ikut ke output standalone
    outputFileTracingIncludes: {
      "/api/tools/status/route": [
        "./node_modules/@modelcontextprotocol/server-filesystem/**",
        "./node_modules/@modelcontextprotocol/server-gitlab/**",
      ],
    },
  },
};

module.exports = nextConfig;
