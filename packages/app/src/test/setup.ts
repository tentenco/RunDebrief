import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import i18n from "../i18n";

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
  void i18n.changeLanguage("zh-Hant");
});

void i18n.changeLanguage("zh-Hant");

if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
}
