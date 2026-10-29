import { useCallback, useEffect, useRef, useState } from "react";
import { ImageDown } from "lucide-react";
import { I18nProvider, useI18n } from "./i18n";
import { api } from "./lib/api";
import type {
  AppSettings,
  CardDetail as CardDetailData,
  CardSummary,
  CivitaiImport,
  GroupInfo,
  Lang,
  LibraryPaths,
  ListFilter,
  Sort,
  StagedImage,
  TagCount
} from "./lib/types";
import { TopBar } from "./components/TopBar";
import { FilterBar } from "./components/FilterBar";
import { CardGrid, GridSkeleton, CARD_DRAG_TYPE } from "./components/Grid";
import { EmptyState } from "./components/EmptyState";
import { CardDetail } from "./components/CardDetail";
import { Editor } from "./components/Editor";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { GroupsPanel } from "./components/GroupsPanel";
import { TagsDialog } from "./components/TagsDialog";
import { ToastProvider, useToast } from "./components/Toasts";
import { CornerDownRight, ListChecks, X } from "lucide-react";

function Shell() {
  const { t, lang, setLang } = useI18n();
  const { toast } = useToast();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [paths, setPaths] = useState<LibraryPaths | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("newest");

  // ---------------------------------------------------------------- groups

  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [groupsReady, setGroupsReady] = useState(false);
  const [groupId, setGroupId] = useState<string>(() => window.localStorage.getItem("ps-group") ?? "");
  const [groupsOpen, setGroupsOpen] = useState(false);

  // ---------------------------------------------------------------- selection

  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CardDetailData | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCard, setEditorCard] = useState<CardDetailData | null>(null);
  const [staged, setStaged] = useState<StagedImage[]>([]);

  const [importOpen, setImportOpen] = useState(false);
  // prefill for the editor after a CivitAI fetch (prompt/author/…)
  const [civImport, setCivImport] = useState<Omit<CivitaiImport, "image"> | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // refs for stable listeners
  const editorOpenRef = useRef(false);
  const stagedRef = useRef<StagedImage[]>([]);
  const detailOpenRef = useRef(false);
  const detailIdRef = useRef<string | null>(null);
  const cardsRef = useRef<CardSummary[]>([]);
  const filterEmptyRef = useRef(false);
  const groupsOpenRef = useRef(false);
  const selectModeRef = useRef(false);

  useEffect(() => {
    editorOpenRef.current = editorOpen;
  }, [editorOpen]);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  useEffect(() => {
    detailOpenRef.current = detailId !== null;
    detailIdRef.current = detailId;
  }, [detailId]);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    groupsOpenRef.current = groupsOpen;
  }, [groupsOpen]);
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);

  const anyFilter = debouncedQ.trim() !== "" || selectedTags.length > 0;

  // ---------------------------------------------------------------- load

  const loadMeta = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.getSettings(), api.getLibraryPaths()]);
      setSettings(s);
      setPaths(p);
      setLang(s.lang);
      window.localStorage.setItem("ps-lang", s.lang);
    } catch {
      setLoadError(true);
    }
  }, [setLang]);

  const loadCards = useCallback(async () => {
    const filter: ListFilter = {
      q: debouncedQ.trim() || null,
      tags: selectedTags,
      min_rating: 0,
      sort,
      group_id: groupId || null
    };
    try {
      const [list, tagList] = await Promise.all([api.listCards(filter), api.listTags()]);
      setCards(list);
      setTags(tagList);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, groupId, selectedTags, sort]);

  const loadGroups = useCallback(async () => {
    try {
      const list = await api.listGroups();
      setGroups(list);
      setGroupsReady(true);
    } catch {
      /* the grid will surface library errors */
    }
  }, []);

  // keep groupId valid (e.g. the group was deleted or the library was replaced)
  useEffect(() => {
    if (!groupsReady || groups.length === 0) return;
    if (groups.some((g) => g.id === groupId)) return;
    const def = groups.find((g) => g.is_default) ?? groups[0];
    setGroupId(def.id);
    window.localStorage.setItem("ps-group", def.id);
  }, [groups, groupsReady, groupId]);

  const [tagsOpen, setTagsOpen] = useState(false);

  useEffect(() => {
    void loadMeta();
    void loadGroups();
  }, [loadMeta, loadGroups]);

  useEffect(() => {
    if (groupsReady) void loadCards();
  }, [groupsReady, loadCards]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(query), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  // ---------------------------------------------------------------- detail

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    let alive = true;
    api
      .getCard(detailId)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => {
        if (alive) setDetailId(null);
      });
    return () => {
      alive = false;
    };
  }, [detailId]);

  const openDetail = useCallback((id: string) => setDetailId(id), []);

  const navDetail = useCallback(
    (dir: 1 | -1) => {
      const list = cardsRef.current;
      const idx = list.findIndex((c) => c.id === detailIdRef.current);
      if (idx === -1) return;
      const next = idx + dir;
      if (next >= 0 && next < list.length) setDetailId(list[next].id);
    },
    []
  );

  const copyPromptText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        await api.copyText(text).catch(() => undefined);
      }
      toast(t("toast.copied"));
    },
    [t, toast]
  );

  // ---------------------------------------------------------------- groups & selection

  const currentGroup = groups.find((g) => g.id === groupId) ?? groups.find((g) => g.is_default) ?? null;

  const toggleTags = useCallback(() => {
    setTagsOpen((on) => !on);
  }, []);

  const switchGroup = useCallback(
    (id: string) => {
      setGroupId(id);
      window.localStorage.setItem("ps-group", id);
      setSelection([]);
      setSelectMode(false);
      setGroupsOpen(false);
    },
    []
  );

  const toggleSelectMode = useCallback(() => {
    setSelectMode((on) => {
      if (on) setSelection([]);
      return !on;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const moveSelection = useCallback(
    async (toGroup: GroupInfo, ids: string[]) => {
      if (ids.length === 0) return;
      try {
        await api.moveCards(ids, toGroup.id);
        toast(t("toast.moved", { name: toGroup.name }));
        setSelection([]);
        setSelectMode(false);
        setGroupsOpen(false);
        await Promise.all([loadCards(), loadGroups()]);
      } catch {
        toast(t("toast.error"), "error");
      }
    },
    [loadCards, loadGroups, t, toast]
  );

  // ---------------------------------------------------------------- editor

  const clearStaged = useCallback(() => {
    for (const img of stagedRef.current) {
      void api.discardTemp(img.path).catch(() => undefined);
    }
    setStaged([]);
    stagedRef.current = [];
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorCard(null);
    setCivImport(null);
    clearStaged();
  }, [clearStaged]);

  const openEditorNew = useCallback(() => {
    setEditorCard(null);
    setCivImport(null);
    setEditorOpen(true);
  }, []);

  const onEditorSaved = useCallback(
    async (fresh: CardDetailData) => {
      setEditorOpen(false);
      setEditorCard(null);
      setStaged([]);
      stagedRef.current = [];
      setCivImport(null);
      await loadCards();
      setDetailId(fresh.id);
      void loadMeta();
    },
    [loadCards, loadMeta]
  );

  const appendStagedPaths = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      try {
        const preview = await api.previewImage(p);
        setStaged((prev) => {
          if (prev.some((s) => s.path === p)) return prev;
          const next = [...prev, { path: p, preview }];
          stagedRef.current = next;
          return next;
        });
      } catch {
        /* skip unreadable file */
      }
    }
  }, []);

  // CivitAI import flow: fetch in the backend, stage the downloaded photo
  // like a paste, then prefill the editor with prompt/author/LoRAs/tags/meta.
  const runCivitaiImport = useCallback(async (url: string) => {
    const res = await api.civitaiImport(url);
    const entry = { path: res.image.temp_path, preview: res.image.preview };
    setStaged([entry]);
    stagedRef.current = [entry];
    setCivImport({
      prompt: res.prompt,
      author: res.author,
      checkpoint: res.checkpoint,
      loras: res.loras,
      tags: res.tags,
      meta: res.meta
    });
    setImportOpen(false);
    setEditorCard(null);
    setEditorOpen(true);
  }, []);

  const pasteGlobally = useCallback(async () => {    try {
      const res = await api.pasteImageFromClipboard();
      if (!res) {
        toast(t("toast.imageCopied"), "info");
        return;
      }
      setStaged((prev) => {
        const next = [...prev, { path: res.temp_path, preview: res.preview }];
        stagedRef.current = next;
        return next;
      });
      setEditorCard(null);
      setCivImport(null);
      setEditorOpen(true);
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [t, toast]);

  const handleDeleteCard = useCallback(async () => {
    setDetailId(null);
    await loadCards();
  }, [loadCards]);

  const onDetailChanged = useCallback(
    (fresh: CardDetailData) => {
      setDetail(fresh);
      void loadCards();
    },
    [loadCards]
  );

  const onImported = useCallback(() => {
    setDetailId(null);
    setSelection([]);
    setSelectMode(false);
    setGroupsOpen(false);
    void (async () => {
      await loadGroups();
      await loadCards();
    })();
    void loadMeta();
  }, [loadCards, loadGroups, loadMeta]);

  // ---------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable;

      if (meta && key === "n" && !e.shiftKey) {
        e.preventDefault();
        if (!editorOpenRef.current) openEditorNew();
      } else if (meta && key === "f") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      } else if (meta && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (meta && key === "c") {
        if (detailOpenRef.current && !editorOpenRef.current && !inField && !window.getSelection()?.toString()) {
          const d = detail;
          if (d) {
            e.preventDefault();
            void copyPromptText(d.prompt);
          }
        }
      } else if (meta && key === "v") {
        if (!inField && !editorOpenRef.current) {
          e.preventDefault();
          void pasteGlobally();
        }
      } else if (!meta && e.key === "Escape") {
        if (groupsOpenRef.current) {
          setGroupsOpen(false);
        } else if (detailOpenRef.current && !editorOpenRef.current && !settingsOpen) {
          setDetailId(null);
        }
      } else if (!meta && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (detailOpenRef.current && !editorOpenRef.current && !inField) {
          navDetail(e.key === "ArrowLeft" ? -1 : 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copyPromptText, detail, navDetail, openEditorNew, pasteGlobally, settingsOpen]);

  // ---------------------------------------------------------------- drag & drop

  // grabbing a card slides the groups panel in, so the drop targets are
  // visible before the drag even starts
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes(CARD_DRAG_TYPE)) {
        setGroupsOpen((v) => v || true);
      }
    };
    window.addEventListener("dragstart", onDragStart);
    return () => window.removeEventListener("dragstart", onDragStart);
  }, []);

  // HTML5 dnd only: the native Tauri drag-drop handler is disabled
  // (dragDropEnabled: false) because it hijacks internal card drags on macOS.
  // Card drags carry no "Files" type, so they never trigger the import overlay.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void (async () => {
        const results = await Promise.allSettled(
          files.map(async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            // chunked btoa keeps large images off the JS engine's call limits
            let bin = "";
            const CH = 0x8000;
            for (let i = 0; i < bytes.length; i += CH) {
              bin += String.fromCharCode(...bytes.subarray(i, i + CH));
            }
            return api.importDroppedFile(file.name || "image", btoa(bin));
          })
        );
        const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        setStaged((prev) => {
          const next = [...prev];
          for (const r of ok) {
            if (!next.some((s) => s.path === r.temp_path)) next.push({ path: r.temp_path, preview: r.preview });
          }
          stagedRef.current = next;
          return next;
        });
        if (ok.length > 0 && !editorOpenRef.current) {
          setEditorCard(null);
          setCivImport(null);
          setEditorOpen(true);
        }
      })();
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // ---------------------------------------------------------------- lang

  const switchLang = useCallback(
    (l: Lang) => {
      setLang(l);
      window.localStorage.setItem("ps-lang", l);
      void api.setSettings({ lang: l }).then((s) => setSettings(s)).catch(() => undefined);
    },
    [setLang]
  );

  // ---------------------------------------------------------------- render

  const filterEmpty = !anyFilter && cards.length === 0 && !loading && !loadError;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        lang={lang}
        onLang={switchLang}
        onNew={openEditorNew}
        onImportCivitai={() => setImportOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <FilterBar
        tags={tags}
        selected={selectedTags}
        onToggle={(tag) => setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))}
        onClear={() => {
          setSelectedTags([]);
          setQuery("");
          setDebouncedQ("");
        }}
        shown={cards.length}
        filtering={anyFilter}
        group={currentGroup}
        onOpenGroups={() => setGroupsOpen((v) => !v)}
        onOpenTags={toggleTags}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
      />

      <main className="relative min-h-0 flex-1 overflow-y-auto">
        {loading && cards.length === 0 ? (
          <GridSkeleton />
        ) : loadError && cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 pb-16">
            <p className="text-[14px] text-muted">{t("state.error")}</p>
            <button
              type="button"
              className="btn-ghost press cursor-pointer"
              onClick={() => {
                setLoading(true);
                void loadCards();
              }}
            >
              {t("action.retry")}
            </button>
          </div>
        ) : filterEmpty ? (
          <EmptyState
            hasFilters={false}
            onNew={openEditorNew}
            onPaste={() => void pasteGlobally()}
            onClear={() => undefined}
          />
        ) : cards.length === 0 && anyFilter ? (
          <EmptyState hasFilters onNew={openEditorNew} onPaste={() => undefined} onClear={() => {
            setSelectedTags([]);
            setQuery("");
            setDebouncedQ("");
          }} />
        ) : (
          <CardGrid
            cards={cards}
            onOpen={openDetail}
            selectMode={selectMode}
            selection={selection}
            onToggleSelect={toggleSelect}
          />
        )}
      </main>

      <GroupsPanel
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        groups={groups}
        currentGroupId={currentGroup?.id ?? ""}
        selection={selection}
        onSwitch={switchGroup}
        onChanged={() => void loadGroups()}
        onMoved={(toGroup, ids) => void moveSelection(toGroup, ids)}
      />

      <TagsDialog
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        tags={tags}
        selected={selectedTags}
        onToggle={(tag) =>
          setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
        }
        onClear={() => {
          setSelectedTags([]);
          setQuery("");
          setDebouncedQ("");
        }}
      />

      {selectMode && (
        <div className="anim-panel fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink py-2 pr-2 pl-5 text-white shadow-panel">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <ListChecks size={14.5} className="opacity-80" />
            {t("groups.selected", { n: selection.length })}
          </span>
          <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />
          <button
            type="button"
            data-groups-trigger
            onClick={() => setGroupsOpen(true)}
            disabled={selection.length === 0}
            className="press flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-white/25 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/15"
          >
            <CornerDownRight size={13.5} />
            {t("select.move")}
          </button>
          <button
            type="button"
            onClick={() => setSelection([])}
            className="press flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] font-medium text-white/75 transition-colors hover:text-white"
          >
            {t("select.clear")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelection([]);
              setSelectMode(false);
            }}
            className="press flex h-8 cursor-pointer items-center gap-1 rounded-full bg-white px-3.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-zinc-200"
          >
            <X size={13} />
            {t("select.done")}
          </button>
        </div>
      )}

      {detail && detailId && (
        <CardDetail
          card={detail}
          hasPrev={cards.findIndex((c) => c.id === detailId) > 0}
          hasNext={cards.findIndex((c) => c.id === detailId) < cards.length - 1}
          onPrev={() => navDetail(-1)}
          onNext={() => navDetail(1)}
          onClose={() => setDetailId(null)}
          onChanged={onDetailChanged}
          onDeleted={() => void handleDeleteCard()}
        />
      )}

      {editorOpen && (
        <Editor
          card={editorCard}
          staged={staged}
          onStaged={setStaged}
          settings={settings}
          groupId={groupId}
          imported={civImport}
          onClose={closeEditor}
          onSaved={(d) => void onEditorSaved(d)}
        />
      )}

      {settings && (
        <SettingsDialog
          open={settingsOpen}
          settings={settings}
          paths={paths}
          onClose={() => setSettingsOpen(false)}
          onSaved={setSettings}
          onImported={onImported}
        />
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={runCivitaiImport}
      />

      {dragging && (
        <div className="anim-fade pointer-events-none fixed inset-0 z-[150] flex items-center justify-center bg-canvas/70 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-panel border-2 border-dashed border-zinc-400 bg-card px-8 py-7 shadow-panel">
            <ImageDown size={26} strokeWidth={1.4} className="text-ink" />
            <div>
              <p className="t-display text-[16px] text-ink">{t("editor.images")}</p>
              <p className="text-[12.5px] text-muted">{t("editor.dropHint")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = window.localStorage.getItem("ps-lang");
    return stored === "ru" ? "ru" : "en";
  });

  return (
    <I18nProvider lang={lang} setLang={setLang}>
      <Shell />
    </I18nProvider>
  );
}

