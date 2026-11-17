import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@aws-sdk/client-bedrock-runtime",
    "@aws-sdk/lib-dynamodb",
    "typescript",
  ],
  outputFileTracingIncludes: {
    "/api/*": [
      "./sandbox/worker.mjs",
      "./sandbox/module-worker.mjs",
      "./node_modules/typescript/lib/**",
    ],
  },
};
export default config;
