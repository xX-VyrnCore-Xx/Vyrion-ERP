import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(async () => {
  cleanup();
  if (typeof localStorage !== "undefined") localStorage.clear();
  // The app preloads its lazy pages when idle. On a slow machine that can still be running
  // when the test ends, and a module loaded after the environment is gone is an error.
  await vi.dynamicImportSettled();
});
