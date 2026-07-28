import baseConfig from "@repo/eslint-config";

export default [
  ...baseConfig,

  // Lite-web-specific ignores
  {
    name: "langfuse/lite-web/ignores",
    ignores: [
      // Vite build output.
      "dist/**",
    ],
  },
];
