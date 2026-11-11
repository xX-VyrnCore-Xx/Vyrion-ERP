import { useEffect } from "react";

import { useWorkspace } from "../app/context";
import { href } from "../app/router";

/** Documents have their own editor: send `e/document/<id>` there. */
export function DocumentRedirect({ id, go }: { id: string; go: (to: string) => void }) {
  const ws = useWorkspace();
  useEffect(() => {
    let current = true;
    void ws.get("document", id).then((doc) => {
      if (current) go(doc ? href("d", String(doc["type"]), id) : "documents");
    });
    return () => {
      current = false;
    };
  }, [id, ws, go]);
  return <p className="text-sm text-muted">Apertura del documento…</p>;
}
