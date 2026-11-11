import { useCallback, useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  return {
    path: path.split("/").filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(query),
  };
}

export const href = (...segments: string[]): string =>
  `#/${segments.map(encodeURIComponent).join("/")}`;

export function useRoute(): [Route, (to: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const listener = () => setHash(window.location.hash);
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const go = useCallback((to: string) => {
    window.location.hash = to.startsWith("#") ? to : `#/${to}`;
  }, []);
  return [parse(hash), go];
}
