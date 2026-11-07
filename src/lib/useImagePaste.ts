import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { api } from "./api";
import { useToast } from "../components/Toasts";

interface UseImagePasteOptions {
  /** Paste handling is only wired while true (e.g. an edit mode is open). */
  active: boolean;
  /** Persists one already-saved temp image onto the entity. */
  addImage: (tempPath: string) => Promise<void>;
  /** Runs after the batch (reload the entity so new images show up). */
  afterAdd: () => Promise<unknown>;
  /** +/- spinner counter, mirroring the file-picker's busy indicator. */
  onBusy?: (delta: number) => void;
}

/**
 * While active, ⌘V/Ctrl+V pastes clipboard images onto an existing entity.
 * Image files in the DOM paste event go through saveTempImage; an empty-text
 * paste (screenshots) and a bare ⌘V with no field focused fall back to the
 * native clipboard reader. Text pastes into fields are never intercepted.
 */
export function useImagePaste({ active, addImage, afterAdd, onBusy }: UseImagePasteOptions) {
  const { t } = useI18n();
  const { toast } = useToast();

  const addRef = useRef(addImage);
  addRef.current = addImage;
  const afterRef = useRef(afterAdd);
  afterRef.current = afterAdd;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    const importPaths = async (paths: string[]) => {
      onBusy?.(paths.length);
      try {
        let failed = 0;
        for (const p of paths) {
          try {
            await addRef.current(p);
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) toast(t("toast.error"), "error");
        await afterRef.current();
      } finally {
        onBusy?.(-paths.length);
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) {
        e.preventDefault();
        busyRef.current = true;
        try {
          const paths: string[] = [];
          for (const f of files) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            const res = await api.saveTempImage(bytes);
            if (res) paths.push(res.temp_path);
          }
          if (paths.length > 0) await importPaths(paths);
        } catch {
          toast(t("toast.error"), "error");
        } finally {
          busyRef.current = false;
        }
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      // empty text with an editable target usually means a screenshot paste
      if (!text && !busyRef.current) {
        e.preventDefault();
        try {
          const res = await api.pasteImageFromClipboard();
          if (res) await importPaths([res.temp_path]);
        } catch {
          toast(t("toast.error"), "error");
        }
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "v") return;
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable;
      // inside a field the DOM paste event handles it (and text must keep working)
      if (inField) return;
      // no field focused: the DOM paste event never fires here, so read the
      // native clipboard; stopPropagation keeps App's global ⌘V (which stages
      // a NEW card) from firing on top of it
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        try {
          const res = await api.pasteImageFromClipboard();
          if (res) {
            await importPaths([res.temp_path]);
          } else {
            toast(t("toast.imageCopied"), "info");
          }
        } catch {
          toast(t("toast.error"), "error");
        }
      })();
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, t, toast]);
}
