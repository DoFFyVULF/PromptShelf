import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ImageDown } from "lucide-react";
import { I18nProvider, useI18n, type DictKey } from "./i18n";
import { api, setLibraryDir } from "./lib/api";
import type {
  AppSettings,
  CardDetail as CardDetailData,
  CardSummary,
  CivitaiImport,
  CivitaiLoraImport,
  DuplicateHit,
  GroupInfo,
  Lang,
  LibraryPaths,
  ListFilter,
  LoraDetail as LoraDetailData,
  LoraSummary,
  Mode,
  Sort,
  StagedImage,
  TagCount,
  Theme,
} from "./lib/types";
import { TopBar } from "./components/TopBar";
import { FilterBar } from "./components/FilterBar";
import { CardGrid, CARD_DRAG_TYPE } from "./components/Grid";
import { LoraGrid } from "./components/LoraGrid";
import { BootLoader } from "./components/BootLoader";
import { EmptyState } from "./components/EmptyState";
import { CardDetail } from "./components/CardDetail";
import { LoraDetail } from "./components/LoraDetail";
import { LoraShelfEditor } from "./components/LoraShelfEditor";
import { Editor } from "./components/Editor";
import { ImportDialog } from "./components/ImportDialog";
import {
  ImportReceipts,
  type ImportReceipt,
} from "./components/ImportReceipts";
import { importErrorToKey, type ImportJob } from "./components/ImportJobs";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { GroupsPanel } from "./components/GroupsPanel";
import { TagsDialog } from "./components/TagsDialog";
import { ToastProvider, useToast } from "./components/Toasts";
import { ScrollTopButton } from "./components/ScrollTopButton";
import { DuplicateDialog } from "./components/DuplicateDialog";
import { CornerDownRight, ListChecks, X } from "lucide-react";
import { applyTheme, onSystemThemeChange, themeFromStorage } from "./lib/theme";
import { useUpdateCheck } from "./lib/useUpdateCheck";

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

  const [theme, setTheme] = useState<Theme>(themeFromStorage);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem("ps-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    return onSystemThemeChange(() => applyTheme("system"));
  }, [theme]);

  // ---------------------------------------------------------------- groups

  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [groupsReady, setGroupsReady] = useState(false);
  const [groupId, setGroupId] = useState<string>(
    () => window.localStorage.getItem("ps-group") ?? "",
  );
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
  // duplicate warning state for the CivitAI import flow; pendingDup keeps the
  // interrupted import — just the job when the link wasn't fetched yet, or the
  // full fetched result — so "continue" can resume without a second download
  const [dupHits, setDupHits] = useState<DuplicateHit[] | null>(null);
  const pendingDup = useRef<{
    jobId: string;
    url: string;
    pre: CivitaiImport | null;
  } | null>(null);
  // background CivitAI imports: every submitted link parks a placeholder tile
  // in the grid until it lands on a card or fails — several run at once
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const jobSeq = useRef(0);
  // floating confirmations for auto-imported cards (photo + prompt head;
  // undo appears on hover), newest first
  const [receipts, setReceipts] = useState<ImportReceipt[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // ---------------------------------------------------------------- updates

  // One shared availability state: the logo badge and the settings dialog
  // both read from the same hook.
  const update = useUpdateCheck();
  const [updateOpen, setUpdateOpen] = useState(false);

  // The background check runs once per launch, gated on the stored toggle;
  // it defers itself (grace period + idle), so this only decides "if".
  useEffect(() => {
    if (settings) update.runBackgroundCheck(settings.update_auto_check);
    // runBackgroundCheck is stable and self-guards against double runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // ---------------------------------------------------------------- lora shelf

  // The logo toggles between the two shelves. Both have parallel state: grid,
  // tags, groups, detail, editor, imports and receipts — the prompt flows are
  // untouched, the lora flows mirror them.
  const [mode, setMode] = useState<Mode>(() =>
    window.localStorage.getItem("ps-mode") === "lora" ? "lora" : "prompt",
  );

  const [loras, setLoras] = useState<LoraSummary[]>([]);
  const [loraTags, setLoraTags] = useState<TagCount[]>([]);

  const [loraGroups, setLoraGroups] = useState<GroupInfo[]>([]);
  const [loraGroupsReady, setLoraGroupsReady] = useState(false);
  const [loraGroupId, setLoraGroupId] = useState<string>(
    () => window.localStorage.getItem("ps-lora-group") ?? "",
  );

  const [loraDetailId, setLoraDetailId] = useState<string | null>(null);
  const [loraDetail, setLoraDetail] = useState<LoraDetailData | null>(null);

  const [loraEditorOpen, setLoraEditorOpen] = useState(false);
  const [loraStaged, setLoraStaged] = useState<StagedImage[]>([]);

  const [loraJobs, setLoraJobs] = useState<ImportJob[]>([]);
  const loraJobSeq = useRef(0);
  const [loraDupHits, setLoraDupHits] = useState<DuplicateHit[] | null>(null);
  const loraPendingDup = useRef<{
    jobId: string;
    url: string;
    pre: CivitaiLoraImport | null;
  } | null>(null);
  const [loraReceipts, setLoraReceipts] = useState<ImportReceipt[]>([]);

  // refs for stable listeners
  const scrollRef = useRef<HTMLElement | null>(null);
  const editorOpenRef = useRef(false);
  const stagedRef = useRef<StagedImage[]>([]);
  const detailOpenRef = useRef(false);
  const detailIdRef = useRef<string | null>(null);
  const loraDetailOpenRef = useRef(false);
  const cardsRef = useRef<CardSummary[]>([]);
  const filterEmptyRef = useRef(false);
  const groupsOpenRef = useRef(false);
  const selectModeRef = useRef(false);

  const loraStagedRef = useRef<StagedImage[]>([]);
  const loraEditorOpenRef = useRef(false);
  const modeRef = useRef<Mode>(mode);

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
    loraDetailOpenRef.current = loraDetailId !== null;
  }, [loraDetailId]);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  const lorasRef = useRef<LoraSummary[]>([]);
  useEffect(() => {
    lorasRef.current = loras;
  }, [loras]);
  useEffect(() => {
    groupsOpenRef.current = groupsOpen;
  }, [groupsOpen]);
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);

  useEffect(() => {
    loraStagedRef.current = loraStaged;
  }, [loraStaged]);
  useEffect(() => {
    loraEditorOpenRef.current = loraEditorOpen;
  }, [loraEditorOpen]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /** Clicking the Prompt‹Shelf› logo flips the shelf; everything that mode
   * owns is reset so the other shelf comes up clean. */
  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next: Mode = m === "prompt" ? "lora" : "prompt";
      window.localStorage.setItem("ps-mode", next);
      return next;
    });
  }, []);

  const anyFilter = debouncedQ.trim() !== "" || selectedTags.length > 0;

  // ---------------------------------------------------------------- load

  const loadMeta = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        api.getSettings(),
        api.getLibraryPaths(),
      ]);
      setSettings(s);
      setPaths(p);
      setLibraryDir(p.data_dir);
      setLang(s.lang);
      window.localStorage.setItem("ps-lang", s.lang);
      setTheme(s.theme);
      window.localStorage.setItem("ps-theme", s.theme);
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
      group_id: groupId || null,
    };
    try {
      const [list, tagList] = await Promise.all([
        api.listCards(filter),
        api.listTags(),
      ]);
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

  const loadLoraGroups = useCallback(async () => {
    try {
      const list = await api.listLoraGroups();
      setLoraGroups(list);
      setLoraGroupsReady(true);
    } catch {
      /* the grid will surface library errors */
    }
  }, []);

  const loadLoras = useCallback(async () => {
    const filter: ListFilter = {
      q: debouncedQ.trim() || null,
      tags: selectedTags,
      min_rating: 0,
      sort,
      group_id: loraGroupId || null,
    };
    try {
      const [list, tagList] = await Promise.all([
        api.listLoras(filter),
        api.listLoraTags(),
      ]);
      setLoras(list);
      setLoraTags(tagList);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, loraGroupId, selectedTags, sort]);

  // keep groupId valid (e.g. the group was deleted or the library was replaced)
  useEffect(() => {
    if (!groupsReady || groups.length === 0) return;
    if (groups.some((g) => g.id === groupId)) return;
    const def = groups.find((g) => g.is_default) ?? groups[0];
    setGroupId(def.id);
    window.localStorage.setItem("ps-group", def.id);
  }, [groups, groupsReady, groupId]);

  // the same, per shelf: lora groups live separately
  useEffect(() => {
    if (!loraGroupsReady || loraGroups.length === 0) return;
    if (loraGroups.some((g) => g.id === loraGroupId)) return;
    const def = loraGroups.find((g) => g.is_default) ?? loraGroups[0];
    setLoraGroupId(def.id);
    window.localStorage.setItem("ps-lora-group", def.id);
  }, [loraGroups, loraGroupsReady, loraGroupId]);

  const [tagsOpen, setTagsOpen] = useState(false);

  useEffect(() => {
    void loadMeta();
    void loadGroups();
    void loadLoraGroups();
  }, [loadMeta, loadGroups, loadLoraGroups]);

  // only the active shelf hits the grid endpoint on start / filter change
  useEffect(() => {
    if (groupsReady && mode === "prompt") void loadCards();
  }, [groupsReady, mode, loadCards]);

  useEffect(() => {
    if (loraGroupsReady && mode === "lora") void loadLoras();
  }, [loraGroupsReady, mode, loadLoras]);

  // switching the shelf resets what mode owns: filters, selection, overlays
  useEffect(() => {
    setQuery("");
    setDebouncedQ("");
    setSelectedTags([]);
    setSelection([]);
    setSelectMode(false);
    setGroupsOpen(false);
    setTagsOpen(false);
    setDetailId(null);
    setDetail(null);
    setLoraDetailId(null);
    setLoraDetail(null);
  }, [mode]);

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

  const navDetail = useCallback((dir: 1 | -1) => {
    const list = cardsRef.current;
    const idx = list.findIndex((c) => c.id === detailIdRef.current);
    if (idx === -1) return;
    const next = idx + dir;
    if (next >= 0 && next < list.length) setDetailId(list[next].id);
  }, []);

  // ---------------------------------------------------------------- lora detail

  useEffect(() => {
    if (!loraDetailId) {
      setLoraDetail(null);
      return;
    }
    let alive = true;
    api
      .getLora(loraDetailId)
      .then((d) => {
        if (alive) setLoraDetail(d);
      })
      .catch(() => {
        if (alive) setLoraDetailId(null);
      });
    return () => {
      alive = false;
    };
  }, [loraDetailId]);

  const openLoraDetail = useCallback((id: string) => setLoraDetailId(id), []);

  const navLoraDetail = useCallback(
    (dir: 1 | -1) => {
      const list = lorasRef.current;
      const idx = list.findIndex((c) => c.id === loraDetailId);
      if (idx === -1) return;
      const next = idx + dir;
      if (next >= 0 && next < list.length) setLoraDetailId(list[next].id);
    },
    [loraDetailId],
  );

  const handleDeleteLora = useCallback(async () => {
    setLoraDetailId(null);
    await loadLoras();
  }, [loadLoras]);

  const onLoraDetailChanged = useCallback(
    (fresh: LoraDetailData) => {
      setLoraDetail(fresh);
      void loadLoras();
      void loadLoraGroups();
    },
    [loadLoras, loadLoraGroups],
  );

  const copyPromptText = useCallback(
    async (text: string, copiedKey: DictKey = "toast.copied") => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        await api.copyText(text).catch(() => undefined);
      }
      toast(t(copiedKey));
    },
    [t, toast],
  );

  // ---------------------------------------------------------------- groups & selection

  const currentGroup =
    mode === "prompt"
      ? (groups.find((g) => g.id === groupId) ??
        groups.find((g) => g.is_default) ??
        null)
      : (loraGroups.find((g) => g.id === loraGroupId) ??
        loraGroups.find((g) => g.is_default) ??
        null);

  const toggleTags = useCallback(() => {
    setTagsOpen((on) => !on);
  }, []);

  const switchGroup = useCallback(
    (id: string) => {
      if (mode === "prompt") {
        setGroupId(id);
        window.localStorage.setItem("ps-group", id);
      } else {
        setLoraGroupId(id);
        window.localStorage.setItem("ps-lora-group", id);
      }
      setSelection([]);
      setSelectMode(false);
      setGroupsOpen(false);
    },
    [mode],
  );

  const toggleSelectMode = useCallback(() => {
    setSelectMode((on) => {
      if (on) setSelection([]);
      return !on;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const moveSelection = useCallback(
    async (toGroup: GroupInfo, ids: string[]) => {
      if (ids.length === 0) return;
      try {
        if (mode === "prompt") await api.moveCards(ids, toGroup.id);
        else await api.moveLoras(ids, toGroup.id);
        toast(t("toast.moved", { name: toGroup.name }));
        setSelection([]);
        setSelectMode(false);
        setGroupsOpen(false);
        await Promise.all([
          mode === "prompt" ? loadCards() : loadLoras(),
          mode === "prompt" ? loadGroups() : loadLoraGroups(),
        ]);
      } catch {
        toast(t("toast.error"), "error");
      }
    },
    [loadCards, loadGroups, loadLoraGroups, loadLoras, mode, t, toast],
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
    clearStaged();
  }, [clearStaged]);

  const openEditorNew = useCallback(() => {
    setEditorCard(null);
    setEditorOpen(true);
  }, []);

  // ---------------------------------------------------------------- lora editor

  const clearLoraStaged = useCallback(() => {
    for (const img of loraStagedRef.current) {
      void api.discardTemp(img.path).catch(() => undefined);
    }
    setLoraStaged([]);
    loraStagedRef.current = [];
  }, []);

  const closeLoraEditor = useCallback(() => {
    setLoraEditorOpen(false);
    clearLoraStaged();
  }, [clearLoraStaged]);

  const openLoraEditorNew = useCallback(() => {
    setLoraEditorOpen(true);
  }, []);

  const pasteLoraGlobally = useCallback(async () => {
    try {
      const res = await api.pasteImageFromClipboard();
      if (!res) {
        toast(t("toast.imageCopied"), "info");
        return;
      }
      setLoraStaged((prev) => {
        const next = [...prev, { path: res.temp_path, preview: res.preview }];
        loraStagedRef.current = next;
        return next;
      });
      setLoraEditorOpen(true);
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [t, toast]);

  const onEditorSaved = useCallback(
    async (fresh: CardDetailData) => {
      setEditorOpen(false);
      setEditorCard(null);
      setStaged([]);
      stagedRef.current = [];
      await loadCards();
      setDetailId(fresh.id);
      void loadMeta();
    },
    [loadCards, loadMeta],
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

  // ------------------------------------------------- import receipts

  // Floating confirmations for auto-imported cards; the cap keeps a burst of
  // imports from stacking forever (oldest just drops out).
  const pushReceipt = useCallback((r: ImportReceipt) => {
    setReceipts((prev) => [r, ...prev].slice(0, 5));
  }, []);

  const dropReceipt = useCallback((id: string) => {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const undoImport = useCallback(
    async (id: string) => {
      dropReceipt(id);
      setDetailId((cur) => (cur === id ? null : cur));
      setSelection((prev) => prev.filter((x) => x !== id));
      try {
        await api.deleteCard(id);
      } catch {
        toast(t("toast.error"), "error");
      }
      await loadCards();
    },
    [dropReceipt, loadCards, t, toast],
  );

  const openReceipt = useCallback(
    (id: string) => {
      dropReceipt(id);
      setImportOpen(false);
      setDetailId(id);
    },
    [dropReceipt],
  );

  const undoLoraImport = useCallback(
    async (id: string) => {
      setLoraReceipts((prev) => prev.filter((r) => r.id !== id));
      setLoraDetailId((cur) => (cur === id ? null : cur));
      setSelection((prev) => prev.filter((x) => x !== id));
      try {
        await api.deleteLora(id);
      } catch {
        toast(t("toast.error"), "error");
      }
      await loadLoras();
    },
    [loadLoras, t, toast],
  );

  const openLoraReceipt = useCallback((id: string) => {
    setLoraReceipts((prev) => prev.filter((r) => r.id !== id));
    setImportOpen(false);
    setMode("lora");
    setLoraDetailId(id);
  }, []);

  // CivitAI import flow: the link is resolved to its origin key and checked
  // against the library BEFORE anything is downloaded; if clean, the result is
  // saved as a card immediately (no editor popup) and a floating receipt
  // confirms it — the dialog stays open for the next link.
  const createFromImport = useCallback(
    async (res: CivitaiImport) => {
      try {
        const created = await api.createCard({
          prompt: res.prompt,
          variants: [],
          negative_prompt: res.negative_prompt,
          note: "",
          rating: 0,
          tags: res.tags,
          images: [res.image.temp_path],
          loras: res.loras,
          group_id: groupId,
          author: res.author || null,
          checkpoint: res.checkpoint || null,
          meta: res.meta,
          source_key: res.source_key,
        });
        pushReceipt({
          id: created.id,
          thumb: res.image.preview,
          prompt: res.prompt,
        });
        await loadCards();
      } catch (e) {
        // the image was staged into the temp dir but never landed on a card —
        // don't leave the file behind
        void api.discardTemp(res.image.temp_path).catch(() => undefined);
        throw e;
      }
    },
    [groupId, loadCards, pushReceipt],
  );

  // --------------------------------------------------------- import jobs

  const updateJob = useCallback((id: string, patch: Partial<ImportJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  /** Runs the import chain in the background: the caller returns at once, so
   * several links can download concurrently. The link's placeholder tile sits
   * at the top of the grid until the card is saved or the fetch fails. */
  const startCivitaiImport = useCallback(
    async (url: string): Promise<void> => {
      const v = url.trim();
      if (!v) return;
      jobSeq.current += 1;
      const id = `civitai-job-${jobSeq.current}`;
      setJobs((prev) => [...prev, { id, url: v, status: "running" }]);
      try {
        const sk = await api.civitaiSourceKey(v).catch(() => null);
        if (sk) {
          const hits = await api.checkDuplicates({ source_key: sk });
          if (hits.length > 0) {
            // park the job; the duplicate dialog picks it up (or queues it
            // behind one that's already on screen)
            updateJob(id, { status: "dup", hits, pre: null });
            return;
          }
        }
        const res = await api.civitaiImport(v);
        // same-prompt-different-link protection: warn before creating; the
        // job keeps the full result, so "continue" doesn't re-download
        const hits = await api.checkDuplicates({
          prompt: res.prompt,
          source_key: res.source_key ?? null,
        });
        if (hits.length > 0) {
          updateJob(id, { status: "dup", hits, pre: res });
          return;
        }
        await createFromImport(res);
        // stamp "done" for a beat, then dissolve under the freshly loaded card
        updateJob(id, { status: "done", hits: undefined, pre: undefined });
        window.setTimeout(() => removeJob(id), 900);
      } catch (e) {
        updateJob(id, { status: "error", error: importErrorToKey(String(e)) });
      }
    },
    [createFromImport, removeJob, updateJob],
  );

  const retryJob = useCallback(
    (job: ImportJob) => {
      removeJob(job.id);
      void startCivitaiImport(job.url);
    },
    [removeJob, startCivitaiImport],
  );

  const dismissJob = useCallback((id: string) => removeJob(id), [removeJob]);

  // while no duplicate dialog is up, promote the next parked duplicate job to
  // it — several imports can hit duplicates while the dialog answered one
  useEffect(() => {
    if (dupHits !== null) return;
    const queued = jobs.find(
      (j) => j.status === "dup" && j.hits && j.hits.length > 0,
    );
    if (!queued || !queued.hits) return;
    pendingDup.current = {
      jobId: queued.id,
      url: queued.url,
      pre: queued.pre ?? null,
    };
    setDupHits(queued.hits);
  }, [dupHits, jobs]);

  // ------------------------------------------------------- lora import flow

  /** Saves a fetched CivitAI model straight into the lora grid; a floating
   * receipt confirms it, the dialog stays open for the next link. */
  const createLoraFromImport = useCallback(
    async (res: CivitaiLoraImport) => {
      try {
        const created = await api.createLora({
          name: res.name,
          base_model: res.base_model,
          published_at: res.published_at,
          usage_tips: res.usage_tips,
          trigger_words: res.trigger_words,
          description: res.description,
          primary_tag: res.primary_tag,
          tags: res.tags,
          images: res.images.map((img) => img.temp_path),
          group_id: loraGroupId,
          source_key: res.source_key,
        });
        setLoraReceipts((prev) => [
          {
            id: created.id,
            thumb: res.images[0]?.preview ?? "",
            prompt: res.name,
          },
          ...prev.slice(0, 4),
        ]);
        await loadLoras();
      } catch (e) {
        // the previews were staged into the temp dir but never landed on a lora
        for (const img of res.images) {
          void api.discardTemp(img.temp_path).catch(() => undefined);
        }
        throw e;
      }
    },
    [loraGroupId, loadLoras],
  );

  const updateLoraJob = useCallback((id: string, patch: Partial<ImportJob>) => {
    setLoraJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    );
  }, []);

  const removeLoraJob = useCallback((id: string) => {
    setLoraJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const startLoraImport = useCallback(
    async (url: string): Promise<void> => {
      const v = url.trim();
      if (!v) return;
      loraJobSeq.current += 1;
      const id = `lora-job-${loraJobSeq.current}`;
      setLoraJobs((prev) => [...prev, { id, url: v, status: "running" }]);
      try {
        const sk = await api.civitaiLoraSourceKey(v).catch(() => null);
        if (sk) {
          const hits = await api.checkLoraDuplicates({ source_key: sk });
          if (hits.length > 0) {
            updateLoraJob(id, { status: "dup", hits, pre: null });
            return;
          }
        }
        const res = await api.civitaiLoraImport(v);
        const hits = await api.checkLoraDuplicates({
          prompt: res.name,
          source_key: res.source_key ?? null,
        });
        if (hits.length > 0) {
          updateLoraJob(id, {
            status: "dup",
            hits,
            pre: res as unknown as CivitaiImport,
          });
          return;
        }
        await createLoraFromImport(res);
        updateLoraJob(id, { status: "done", hits: undefined, pre: undefined });
        window.setTimeout(() => removeLoraJob(id), 900);
      } catch (e) {
        updateLoraJob(id, {
          status: "error",
          error: importErrorToKey(String(e)),
        });
      }
    },
    [createLoraFromImport, removeLoraJob, updateLoraJob],
  );

  const retryLoraJob = useCallback(
    (job: ImportJob) => {
      removeLoraJob(job.id);
      void startLoraImport(job.url);
    },
    [removeLoraJob, startLoraImport],
  );

  const dismissLoraJob = useCallback(
    (id: string) => removeLoraJob(id),
    [removeLoraJob],
  );

  useEffect(() => {
    if (loraDupHits !== null) return;
    const queued = loraJobs.find(
      (j) => j.status === "dup" && j.hits && j.hits.length > 0,
    );
    if (!queued || !queued.hits) return;
    loraPendingDup.current = {
      jobId: queued.id,
      url: queued.url,
      pre: (queued.pre as unknown as CivitaiLoraImport) ?? null,
    };
    setLoraDupHits(queued.hits);
  }, [loraDupHits, loraJobs]);

  const pasteGlobally = useCallback(async () => {
    try {
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
    [loadCards],
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
      const inField =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable;

      if (meta && key === "n" && !e.shiftKey) {
        e.preventDefault();
        if (modeRef.current === "prompt") {
          if (!editorOpenRef.current) openEditorNew();
        } else if (!loraEditorOpenRef.current) {
          openLoraEditorNew();
        }
      } else if (meta && key === "f") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      } else if (meta && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (meta && key === "c") {
        const sel = window.getSelection()?.toString();
        if (modeRef.current === "prompt") {
          if (
            detailOpenRef.current &&
            !editorOpenRef.current &&
            !inField &&
            !sel
          ) {
            const d = detail;
            if (d) {
              e.preventDefault();
              void copyPromptText(d.prompt);
            }
          }
        } else if (
          loraDetailOpenRef.current &&
          !loraEditorOpenRef.current &&
          !inField &&
          !sel &&
          loraDetail
        ) {
          // ⌘C on a lora copies its trigger words (comma-separated)
          if (loraDetail.trigger_words.length > 0) {
            e.preventDefault();
            void copyPromptText(
              loraDetail.trigger_words.join(", "),
              "lora.triggerCopied",
            );
          }
        }
      } else if (meta && key === "v") {
        const editorBusy =
          modeRef.current === "prompt"
            ? editorOpenRef.current
            : loraEditorOpenRef.current;
        if (!inField && !editorBusy) {
          e.preventDefault();
          void (modeRef.current === "prompt"
            ? pasteGlobally()
            : pasteLoraGlobally());
        }
      } else if (!meta && e.key === "Escape") {
        // detail panels handle their own Esc (zoom / edit mode) and mark the
        // event via preventDefault, so the overlay must not close on top of it
        if (e.defaultPrevented) return;
        if (groupsOpenRef.current) {
          setGroupsOpen(false);
        } else if (
          detailOpenRef.current &&
          !editorOpenRef.current &&
          !settingsOpen
        ) {
          setDetailId(null);
        } else if (
          loraDetailOpenRef.current &&
          !loraEditorOpenRef.current &&
          !settingsOpen
        ) {
          setLoraDetailId(null);
        }
      } else if (!meta && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (
          !inField &&
          loraDetailOpenRef.current &&
          !loraEditorOpenRef.current
        ) {
          navLoraDetail(e.key === "ArrowLeft" ? -1 : 1);
        } else if (
          detailOpenRef.current &&
          !editorOpenRef.current &&
          !inField
        ) {
          navDetail(e.key === "ArrowLeft" ? -1 : 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    copyPromptText,
    detail,
    loraDetail,
    navDetail,
    navLoraDetail,
    openEditorNew,
    openLoraEditorNew,
    pasteGlobally,
    pasteLoraGlobally,
    settingsOpen,
  ]);

  // ---------------------------------------------------------------- drag & drop

  // grabbing a card slides the groups panel in, so the drop targets are
  // visible before the drag even starts
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      if (
        e.dataTransfer &&
        Array.from(e.dataTransfer.types).includes(CARD_DRAG_TYPE)
      ) {
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
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
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
          }),
        );
        const ok = results.flatMap((r) =>
          r.status === "fulfilled" ? [r.value] : [],
        );
        for (const r of ok) {
          // staged paths go to the editor of the active shelf
          if (modeRef.current === "lora") {
            setLoraStaged((prev) => {
              if (prev.some((s) => s.path === r.temp_path)) return prev;
              const next = [...prev, { path: r.temp_path, preview: r.preview }];
              loraStagedRef.current = next;
              return next;
            });
          } else {
            setStaged((prev) => {
              if (prev.some((s) => s.path === r.temp_path)) return prev;
              const next = [...prev, { path: r.temp_path, preview: r.preview }];
              stagedRef.current = next;
              return next;
            });
          }
        }
        const currentEditor =
          modeRef.current === "lora"
            ? loraEditorOpenRef.current
            : editorOpenRef.current;
        if (ok.length > 0 && !currentEditor) {
          if (modeRef.current === "lora") {
            setLoraEditorOpen(true);
          } else {
            setEditorCard(null);
            setEditorOpen(true);
          }
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
      void api
        .setSettings({ lang: l })
        .then((s) => setSettings(s))
        .catch(() => undefined);
    },
    [setLang],
  );

  const switchTheme = useCallback(
    (v: Theme) => {
      setTheme(v);
      window.localStorage.setItem("ps-theme", v);
      void api
        .setSettings({ theme: v })
        .then((s) => setSettings(s))
        .catch(() => undefined);
    },
    [setTheme],
  );

  // ---------------------------------------------------------------- render

  const activeCards = mode === "prompt" ? cards : loras;
  const activeJobs = mode === "prompt" ? jobs : loraJobs;

  const filterEmpty =
    !anyFilter &&
    activeCards.length === 0 &&
    activeJobs.length === 0 &&
    !loading &&
    !loadError;
  const overlayOpen =
    editorOpen ||
    loraEditorOpen ||
    importOpen ||
    settingsOpen ||
    groupsOpen ||
    tagsOpen ||
    updateOpen;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        mode={mode}
        onToggleMode={toggleMode}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        onNew={mode === "prompt" ? openEditorNew : openLoraEditorNew}
        onImportCivitai={() => setImportOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        updateAvailable={update.available !== null}
        onUpdateOpen={() => setUpdateOpen(true)}
      />

      <FilterBar
        tags={mode === "prompt" ? tags : loraTags}
        selected={selectedTags}
        onToggle={(tag) =>
          setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
          )
        }
        onClear={() => {
          setSelectedTags([]);
          setQuery("");
          setDebouncedQ("");
        }}
        shown={activeCards.length}
        filtering={anyFilter}
        group={currentGroup}
        onOpenGroups={() => setGroupsOpen((v) => !v)}
        onOpenTags={toggleTags}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        lora={mode === "lora"}
      />

      <main ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {loading && activeCards.length === 0 ? (
          <BootLoader />
        ) : loadError && activeCards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 pb-16">
            <p className="text-[14px] text-muted">{t("state.error")}</p>
            <button
              type="button"
              className="btn-ghost press cursor-pointer"
              onClick={() => {
                setLoading(true);
                void (mode === "prompt" ? loadCards() : loadLoras());
              }}
            >
              {t("action.retry")}
            </button>
          </div>
        ) : filterEmpty ? (
          <EmptyState
            hasFilters={false}
            lora={mode === "lora"}
            paused={overlayOpen}
            onImport={() => setImportOpen(true)}
            onNew={mode === "prompt" ? openEditorNew : openLoraEditorNew}
            onPaste={() => void pasteGlobally()}
            onClear={() => undefined}
          />
        ) : activeCards.length === 0 && anyFilter && activeJobs.length === 0 ? (
          <EmptyState
            lora={mode === "lora"}
            hasFilters
            onNew={mode === "prompt" ? openEditorNew : openLoraEditorNew}
            onPaste={() => undefined}
            onClear={() => {
              setSelectedTags([]);
              setQuery("");
              setDebouncedQ("");
            }}
          />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {mode === "prompt" ? (
              <motion.div
                key="prompt"
                exit={{ opacity: 0, y: -12, scale: 0.985 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <CardGrid
                  cards={cards}
                  jobs={jobs}
                  onJobRetry={(job) => retryJob(job)}
                  onJobDismiss={dismissJob}
                  onOpen={openDetail}
                  selectMode={selectMode}
                  selection={selection}
                  onToggleSelect={toggleSelect}
                />
              </motion.div>
            ) : (
              <motion.div
                key="lora"
                exit={{ opacity: 0, y: -12, scale: 0.985 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <LoraGrid
                  loras={loras}
                  jobs={loraJobs}
                  onJobRetry={(job) => retryLoraJob(job)}
                  onJobDismiss={dismissLoraJob}
                  onOpen={openLoraDetail}
                  selectMode={selectMode}
                  selection={selection}
                  onToggleSelect={toggleSelect}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      <ScrollTopButton containerRef={scrollRef} />

      <GroupsPanel
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        groups={mode === "prompt" ? groups : loraGroups}
        currentGroupId={currentGroup?.id ?? ""}
        selection={selection}
        lora={mode === "lora"}
        onSwitch={switchGroup}
        onChanged={() =>
          void (mode === "prompt" ? loadGroups() : loadLoraGroups())
        }
        onMoved={(toGroup, ids) => void moveSelection(toGroup, ids)}
      />

      <TagsDialog
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        tags={mode === "prompt" ? tags : loraTags}
        selected={selectedTags}
        onToggle={(tag) =>
          setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
          )
        }
        onClear={() => {
          setSelectedTags([]);
          setQuery("");
          setDebouncedQ("");
        }}
      />

      {selectMode && (
        <div className="anim-panel fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink py-2 pr-2 pl-5 text-on-ink shadow-panel">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <ListChecks size={14.5} className="opacity-80" />
            {t("groups.selected", { n: selection.length })}
          </span>
          <span className="mx-1 h-4 w-px bg-on-ink/20" aria-hidden />
          <button
            type="button"
            data-groups-trigger
            onClick={() => setGroupsOpen(true)}
            disabled={selection.length === 0}
            className="press flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-on-ink/15 px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-on-ink/25 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-on-ink/15"
          >
            <CornerDownRight size={13.5} />
            {t("select.move")}
          </button>
          <button
            type="button"
            onClick={() => setSelection([])}
            className="press flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] font-medium text-on-ink/75 transition-colors hover:text-on-ink"
          >
            {t("select.clear")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelection([]);
              setSelectMode(false);
            }}
            className="press flex h-8 cursor-pointer items-center gap-1 rounded-full bg-on-ink px-3.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-on-ink/80"
          >
            <X size={13} />
            {t("select.done")}
          </button>
        </div>
      )}

      {detail && detailId && mode === "prompt" && (
        <CardDetail
          card={detail}
          suggestions={tags}
          hasPrev={cards.findIndex((c) => c.id === detailId) > 0}
          hasNext={cards.findIndex((c) => c.id === detailId) < cards.length - 1}
          onPrev={() => navDetail(-1)}
          onNext={() => navDetail(1)}
          onClose={() => setDetailId(null)}
          onChanged={onDetailChanged}
          onDeleted={() => void handleDeleteCard()}
        />
      )}

      {loraDetail && loraDetailId && mode === "lora" && (
        <LoraDetail
          lora={loraDetail}
          suggestions={loraTags}
          hasPrev={loras.findIndex((c) => c.id === loraDetailId) > 0}
          hasNext={
            loras.findIndex((c) => c.id === loraDetailId) < loras.length - 1
          }
          onPrev={() => navLoraDetail(-1)}
          onNext={() => navLoraDetail(1)}
          onClose={() => setLoraDetailId(null)}
          onChanged={onLoraDetailChanged}
          onDeleted={() => void handleDeleteLora()}
        />
      )}

      {loraEditorOpen && (
        <LoraShelfEditor
          staged={loraStaged}
          onStaged={setLoraStaged}
          suggestions={loraTags}
          onClose={closeLoraEditor}
          onSaved={(fresh: LoraDetailData) => {
            closeLoraEditor();
            void loadLoras().then(() => setLoraDetailId(fresh.id));
          }}
        />
      )}

      {editorOpen && (
        <Editor
          card={editorCard}
          staged={staged}
          onStaged={setStaged}
          settings={settings}
          groupId={groupId}
          suggestions={tags}
          onClose={closeEditor}
          onSaved={(d) => void onEditorSaved(d)}
          onOpenExisting={(id) => {
            closeEditor();
            setDetailId(id);
          }}
        />
      )}

      {settings && (
        <SettingsDialog
          open={settingsOpen}
          settings={settings}
          paths={paths}
          lang={lang}
          onLang={switchLang}
          theme={theme}
          onTheme={switchTheme}
          onClose={() => setSettingsOpen(false)}
          onSaved={setSettings}
          onImported={onImported}
          updateVersion={update.hasUpdate ? update.version : null}
          onUpdateOpen={() => setUpdateOpen(true)}
          onUpdateDismissed={update.dismiss}
          onUpdateFound={update.adoptFound}
        />
      )}

      {/* logo-badge entry: opens instantly with the already-resolved
          availability; after a dismissal the settings note still opens it
          via `pending`, falling back to a fresh check when unknown */}
      <UpdateDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        known={update.available ?? update.pending}
        onDismissed={update.dismiss}
        onFound={update.adoptFound}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        lora={mode === "lora"}
        onSubmit={(url) =>
          void (mode === "prompt"
            ? startCivitaiImport(url)
            : startLoraImport(url))
        }
      />
      {mode === "prompt" && (
        <DuplicateDialog
          open={dupHits !== null}
          hits={dupHits ?? []}
          proceedKey="dup.proceed"
          onProceed={() => {
            const p = pendingDup.current;
            setDupHits(null);
            pendingDup.current = null;
            if (!p) return;
            updateJob(p.jobId, {
              status: "running",
              hits: undefined,
              pre: undefined,
            });
            void (async () => {
              // the user approved the duplicate — create it without further checks
              const res = p.pre ?? (await api.civitaiImport(p.url));
              await createFromImport(res);
              updateJob(p.jobId, { status: "done" });
              window.setTimeout(() => removeJob(p.jobId), 900);
            })().catch((e) =>
              updateJob(p.jobId, {
                status: "error",
                error: importErrorToKey(String(e)),
              }),
            );
          }}
          onOpen={(id) => {
            const p = pendingDup.current;
            if (p?.pre)
              void api
                .discardTemp(p.pre.image.temp_path)
                .catch(() => undefined);
            setDupHits(null);
            pendingDup.current = null;
            if (p) removeJob(p.jobId);
            setImportOpen(false);
            setDetailId(id);
          }}
          onClose={() => {
            const p = pendingDup.current;
            // leaving two hits without a decision must not leak the staged image
            if (p?.pre)
              void api
                .discardTemp(p.pre.image.temp_path)
                .catch(() => undefined);
            setDupHits(null);
            pendingDup.current = null;
            if (p) removeJob(p.jobId);
          }}
        />
      )}
      {mode === "lora" && (
        <DuplicateDialog
          open={loraDupHits !== null}
          hits={loraDupHits ?? []}
          proceedKey="dup.proceed"
          onProceed={() => {
            const p = loraPendingDup.current;
            setLoraDupHits(null);
            loraPendingDup.current = null;
            if (!p) return;
            updateLoraJob(p.jobId, {
              status: "running",
              hits: undefined,
              pre: undefined,
            });
            void (async () => {
              // the user approved the duplicate — create it without further checks
              const res =
                (p.pre as CivitaiLoraImport | null) ??
                (await api.civitaiLoraImport(p.url));
              await createLoraFromImport(res);
              updateLoraJob(p.jobId, { status: "done" });
              window.setTimeout(() => removeLoraJob(p.jobId), 900);
            })().catch((e) =>
              updateLoraJob(p.jobId, {
                status: "error",
                error: importErrorToKey(String(e)),
              }),
            );
          }}
          onOpen={(id) => {
            const p = loraPendingDup.current;
            if (p?.pre) {
              for (const img of p.pre.images)
                void api.discardTemp(img.temp_path).catch(() => undefined);
            }
            setLoraDupHits(null);
            loraPendingDup.current = null;
            if (p) removeLoraJob(p.jobId);
            setImportOpen(false);
            setLoraDetailId(id);
          }}
          onClose={() => {
            const p = loraPendingDup.current;
            if (p?.pre) {
              for (const img of p.pre.images)
                void api.discardTemp(img.temp_path).catch(() => undefined);
            }
            setLoraDupHits(null);
            loraPendingDup.current = null;
            if (p) removeLoraJob(p.jobId);
          }}
        />
      )}

      <ImportReceipts
        items={receipts}
        onOpen={openReceipt}
        onUndo={(id) => void undoImport(id)}
        onExpire={dropReceipt}
      />
      <ImportReceipts
        items={loraReceipts}
        onOpen={openLoraReceipt}
        onUndo={(id) => void undoLoraImport(id)}
        onExpire={(id) =>
          setLoraReceipts((prev) => prev.filter((r) => r.id !== id))
        }
      />

      {dragging && (
        <div className="anim-fade pointer-events-none fixed inset-0 z-[150] flex items-center justify-center bg-canvas/70 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-panel border-2 border-dashed border-line-active bg-card px-8 py-7 shadow-panel">
            <ImageDown size={26} strokeWidth={1.4} className="text-ink" />
            <div>
              <p className="t-display text-[16px] text-ink">
                {t("editor.images")}
              </p>
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
