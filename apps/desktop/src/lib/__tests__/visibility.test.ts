import { afterEach, describe, expect, it, vi } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { isHidden, trackVisibility, whenVisible } from "../visibility";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => setVisibility("visible"));

describe("visibility", () => {
  it("runs at once while the window is visible", () => {
    const fn = vi.fn();
    whenVisible(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits while the window is hidden and runs once when it comes back", () => {
    setVisibility("hidden");
    expect(isHidden()).toBe(true);
    const fn = vi.fn();
    whenVisible(fn);
    expect(fn).not.toHaveBeenCalled();
    setVisibility("visible");
    setVisibility("visible");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled", () => {
    setVisibility("hidden");
    const fn = vi.fn();
    const cancel = whenVisible(fn);
    cancel();
    setVisibility("visible");
    expect(fn).not.toHaveBeenCalled();
  });

  it("marks the page as hidden so the CSS pauses the animations", () => {
    const stop = trackVisibility();
    expect(document.documentElement.dataset.hidden).toBe("false");
    setVisibility("hidden");
    expect(document.documentElement.dataset.hidden).toBe("true");
    stop();
  });
});

describe("workspace notifications", () => {
  it("tells the screens once for many writes made together", async () => {
    const ws = await testWorkspace();
    const listener = vi.fn();
    ws.subscribe(listener);
    await Promise.all([
      ws.create("party", { name: "A", kind: "customer" }),
      ws.create("party", { name: "B", kind: "customer" }),
      ws.create("party", { name: "C", kind: "customer" }),
    ]);
    await new Promise((r) => setTimeout(r, 40));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ws.getRevision()).toBeGreaterThanOrEqual(3);
  });

  it("holds the refresh while the window is hidden", async () => {
    const ws = await testWorkspace();
    const listener = vi.fn();
    ws.subscribe(listener);
    setVisibility("hidden");
    await ws.create("party", { name: "Hidden", kind: "customer" });
    await new Promise((r) => setTimeout(r, 40));
    expect(listener).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
