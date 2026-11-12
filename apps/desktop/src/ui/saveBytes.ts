import { invoke } from "@tauri-apps/api/core";

import { inDesktop, pickSavePath } from "../lib/native";

/** Lets the person save a binary file (a ZIP). Returns false if they cancelled. */
export async function saveBytes(
  fileName: string,
  content: Uint8Array,
  mime = "application/zip",
): Promise<boolean> {
  if (inDesktop()) {
    const path = await pickSavePath("Salva file", fileName);
    if (!path) return false;
    await invoke("export_bytes", { dest: path, content: Array.from(content) });
    return true;
  }
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
