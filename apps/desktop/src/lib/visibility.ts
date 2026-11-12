/** True while the window cannot be seen: minimised, hidden in the tray, on another desktop. */
export const isHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Calls `fn` once, the next time the window becomes visible. Returns a function that cancels it.
 * Background work waits here instead of ticking while nobody is looking: it spares the battery.
 */
export function whenVisible(fn: () => void): () => void {
  if (typeof document === "undefined" || !isHidden()) {
    fn();
    return () => undefined;
  }
  const listener = () => {
    if (isHidden()) return;
    document.removeEventListener("visibilitychange", listener);
    fn();
  };
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

/** Marks <html data-hidden> while the window is hidden, so the CSS can pause every animation. */
export function trackVisibility(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const apply = () => {
    document.documentElement.dataset.hidden = String(isHidden());
  };
  apply();
  document.addEventListener("visibilitychange", apply);
  return () => document.removeEventListener("visibilitychange", apply);
}
