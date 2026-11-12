import { invoke } from "@tauri-apps/api/core";

import { inDesktop, pickSavePath } from "../lib/native";

/** Lets the person save a text file (CSV export). Returns false if they cancelled. */
export async function saveText(
  fileName: string,
  content: string,
  mime = "text/csv;charset=utf-8",
): Promise<boolean> {
  if (inDesktop()) {
    const path = await pickSavePath("Salva file", fileName);
    if (!path) return false;
    await invoke("export_text", { dest: path, content });
    return true;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
