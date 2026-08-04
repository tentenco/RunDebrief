import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "\"SF Pro Text\"",
          "sans-serif",
        ],
        mono: ["\"SF Mono\"", "ui-monospace", "monospace"],
      },
      screens: {
        compact: { max: "1180px" },
      },
    },
  },
  plugins: [],
} satisfies Config;
