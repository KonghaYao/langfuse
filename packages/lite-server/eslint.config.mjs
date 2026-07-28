import baseConfig from "@repo/eslint-config";

export default [
  ...baseConfig,

  // Lite-server-specific ignores
  {
    name: "langfuse/lite-server/ignores",
    ignores: [
      // Test files are excluded from tsconfig (typed lint cannot parse them).
      "**/__tests__/**",
      "vitest.config.ts",
      // Generated protobufjs bundle copied from web (carries @ts-nocheck).
      "**/otel-proto/**",
    ],
  },
];
