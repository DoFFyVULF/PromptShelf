import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LoraFamilyDialog } from "./components/LoraFamilyDialog";
import {
  detectFamilies,
  isFamilyDismissed,
  readDismissedFamilies,
  readGroupedFamilies,
  writeDismissedFamilies,
  writeGroupedFamilies,
  type FamilyDismiss,
  type FamilyOffer,
} from "./lib/loraFamilies";
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
import { ConfirmDeleteButton } from "./components/ConfirmDeleteButton";
import { TagsDialog } from "./components/TagsDialog";
import { ToastProvider, useToast } from "./components/Toasts";
import { ScrollTopButton } from "./components/ScrollTopButton";
import { DuplicateDialog } from "./components/DuplicateDialog";
import { MissingPromptDialog } from "./components/MissingPromptDialog";
import { CornerDownRight, ListChecks, X } from "lucide-react";
import { applyTheme, onSystemThemeChange, themeFromStorage } from "./lib/theme";
import { shortcutKey } from "./lib/platform";
import { useUpdateCheck } from "./lib/useUpdateCheck";

// CivitAI links for clipboard auto-import, mirroring the Rust link parsers:
// image/post links feed the prompt shelf, model links the lora shelf. The
// whole URL is kept — slug, `?modelVersionId=…` (the exact version the user is
// looking at) and post params — while the digit boundary still keeps trailing
// text ("…/123abc") from matching.
const CIVITAI_ITEM_LINK =
  /(?:https?:\/\/)?(?:www\.)?civitai\.(?:com|red)\/(?:images|posts)\/\d+(?![A-Za-z0-9_])[^\s"'<>]*/i;
const CIVITAI_MODEL_LINK =
  /(?:https?:\/\/)?(?:www\.)?civitai\.(?:com|red)\/models\/\d+(?![A-Za-z0-9_])[^\s"'<>]*/i;

/** A clipboard link may be glued to prose punctuation: "(https://…/123)." */
function matchCivitaiLink(text: string, re: RegExp): string | null {
  return text.match(re)?.[0].replace(/[)\]}>.,;!]+$/, "") ?? null;
}

/** The slot an item occupies when nothing is pinned — where an unpinned item
 * belongs, rather than the row it was floated to. */
type ShelfOrder = Map<string, number>;

function orderOf<T extends { id: string }>(items: T[]): ShelfOrder {
  const order: ShelfOrder = new Map();
  items.forEach((item, i) => order.set(item.id, i));
  return order;
}

/** The shelf a list would have without pins. The backend floats pinned rows to
 * the top, so the indices it returns are *not* home slots: after a reload a
 * pinned item would "return" to the row it was floated to. Every key the query
 * sorts by is on the summary, so the unpinned order is rebuilt here from the
 * active sort. The two "depth" orders read a weight the summary cannot carry on
 * its own (lora version counts are a property of the whole shelf), so callers
 * pass the accessor in — the backend has no SQL order for them and returns the
 * list newest-first, which this rebuild replaces. */
function homeOrder<
  T extends { id: string; rating: number; created_at: string },
>(items: T[], sort: Sort, weight?: (item: T) => number): ShelfOrder {
  const byDate = (a: T, b: T) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  const compare =
    sort === "oldest"
      ? (a: T, b: T) => -byDate(a, b)
      : sort === "rating"
        ? (a: T, b: T) => b.rating - a.rating || byDate(a, b)
        : (sort === "variants" || sort === "versions") && weight
          ? (a: T, b: T) => weight(b) - weight(a) || byDate(a, b)
          : byDate;
  return orderOf([...items].sort(compare));
}

/** A pin flips optimistically and is written in the background. A shelf load
 * that was already in flight when the chip flipped comes back with the old
 * flag, so the pending write is replayed over the fetched list instead of
 * undoing the click. */
type PendingPin = { pinned: boolean; token: number };

function applyPendingPins<T extends { id: string; pinned: boolean }>(
  items: T[],
  pending: Map<string, PendingPin>,
): T[] {
  if (pending.size === 0) return items;
  return items.map((item) => {
    const pin = pending.get(item.id);
    return pin && pin.pinned !== item.pinned
      ? { ...item, pinned: pin.pinned }
      : item;
  });
}

/** Optimistic shelf order: pinned items float to the top while everything else
 * returns to the slot the active sort gives it. Sorting by the remembered slot
 * (and not by the current array) is what lets an unpinned item travel back down
 * to its own place. */
function pinnedFirst<T extends { id: string; pinned: boolean }>(
  items: T[],
  order: ShelfOrder,
): T[] {
  const slot = (item: T) => order.get(item.id) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || slot(a) - slot(b),
  );
}

/** A pin reorders the grid right under the cursor, and two things then pull the
 * shelf up with it: the focused tile (WebKit scrolls a focused node back into
 * view) and Chromium anchoring the scroll to the tile that just left the
 * viewport. Hold the view still across the commit, put keyboard focus back
 * without scrolling, and undo any scroll the engine performed anyway. */
function holdView(container: HTMLElement | null, fn: () => void) {
  const active = document.activeElement;
  const keep =
    active instanceof HTMLElement && active !== document.body ? active : null;
  const top = container?.scrollTop ?? 0;
  keep?.blur();
  fn();
  requestAnimationFrame(() => {
    if (keep?.isConnected) keep.focus({ preventScroll: true });
    if (container && Math.abs(container.scrollTop - top) > 1) {
      container.scrollTop = top;
    }
  });
}

/** A pin is two beats: the tile gilds and lifts where it stands, then it flies
 * to the top. The gap between them is one timeout — never a refetch. */
const PIN_BLOOM_MS = 240;

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
  const [matchAllTags, setMatchAllTags] = useState(false);
  // Each shelf remembers its own order: "most variants" cannot be honoured on
  // the lora shelf (and "most versions" cannot on the prompt shelf), so the two
  // states stay independent instead of being clamped on every mode flip.
  const [promptSort, setPromptSort] = useState<Sort>("newest");
  const [loraSort, setLoraSort] = useState<Sort>("newest");

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
  // armed state for the bulk-delete action in the floating selection bar
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CardDetailData | null>(null);
  // active prompt page in the detail view: 0 = main prompt, n = variant n-1.
  // Shared with CardDetail so both the footer button and ⌘C copy the open page.
  const [detailPromptIdx, setDetailPromptIdx] = useState(0);

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
  // promptless CivitAI pages: the import is parked with just its remote
  // preview — nothing is downloaded until the user keeps the photo
  const [missingPrompt, setMissingPrompt] = useState<CivitaiImport | null>(null);
  const [noPromptSaving, setNoPromptSaving] = useState(false);
  const pendingNoPrompt = useRef<{
    jobId: string;
    url: string;
    pre: CivitaiImport;
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

  // The order on screen belongs to the active shelf; the TopBar reads this pair.
  const sort = mode === "prompt" ? promptSort : loraSort;
  const setSort = mode === "prompt" ? setPromptSort : setLoraSort;

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

  // ------------------------------------------------------- lora families
  // Same lora kept in several versions / for several base models can be
  // folded into a single deck tile. Both decisions live in localStorage, so a
  // group survives a restart and a declined offer stays declined until the
  // set of variants actually changes.
  const [familyGrouped, setFamilyGrouped] =
    useState<string[]>(readGroupedFamilies);
  const [familyDismissed, setFamilyDismissed] =
    useState<FamilyDismiss[]>(readDismissedFamilies);
  const [familyOpenId, setFamilyOpenId] = useState<string | null>(null);

  // Family detection runs on the currently visible loras, so a search or tag
  // filter naturally narrows both the offer and the deck to what's on screen.
  const detectedFamilies = useMemo(
    () => (mode === "lora" ? detectFamilies(loras) : []),
    [loras, mode],
  );
  const groupedFamilies = useMemo(
    () => detectedFamilies.filter((f) => familyGrouped.includes(f.id)),
    [detectedFamilies, familyGrouped],
  );
  const pendingFamilies = useMemo(
    () =>
      detectedFamilies.filter(
        (f) =>
          !familyGrouped.includes(f.id) && !isFamilyDismissed(f, familyDismissed),
      ),
    [detectedFamilies, familyGrouped, familyDismissed],
  );
  const openFamily = groupedFamilies.find((f) => f.id === familyOpenId) ?? null;

  // A declined family keeps its offer on the lora page itself — the header
  // suggestion is gone, but the decision is never buried.
  const declinedFamilies = useMemo(
    () =>
      detectedFamilies.filter(
        (f) =>
          !familyGrouped.includes(f.id) && isFamilyDismissed(f, familyDismissed),
      ),
    [detectedFamilies, familyGrouped, familyDismissed],
  );
  const detailFamilyOffer: FamilyOffer | null = useMemo(() => {
    if (!loraDetailId) return null;
    const family = declinedFamilies.find((f) =>
      f.members.some((m) => m.id === loraDetailId),
    );
    if (!family) return null;
    return {
      id: family.id,
      count: family.members.length,
      reason: family.reason,
    };
  }, [declinedFamilies, loraDetailId]);

  // refs for stable listeners
  const scrollRef = useRef<HTMLElement | null>(null);
  // the shelf's unpinned ordering, kept as the home slot of every card and lora
  const cardOrderRef = useRef<ShelfOrder>(new Map());
  const loraOrderRef = useRef<ShelfOrder>(new Map());
  // pin writes that have not settled yet, so a list response cannot undo them
  const pendingCardPins = useRef<Map<string, PendingPin>>(new Map());
  const pendingLoraPins = useRef<Map<string, PendingPin>>(new Map());
  const pinToken = useRef(0);
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
      match_all_tags: matchAllTags,
      min_rating: 0,
      sort: promptSort,
      group_id: groupId || null,
    };
    try {
      const [fetched, tagList] = await Promise.all([
        api.listCards(filter),
        api.listTags(),
      ]);
      const list = applyPendingPins(fetched, pendingCardPins.current);
      const order = homeOrder(list, promptSort, (card) => card.variant_count);
      cardOrderRef.current = order;
      setCards(pinnedFirst(list, order));
      setTags(tagList);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, groupId, selectedTags, matchAllTags, promptSort]);

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
      match_all_tags: matchAllTags,
      min_rating: 0,
      sort: loraSort,
      group_id: loraGroupId || null,
    };
    try {
      const [fetched, tagList] = await Promise.all([
        api.listLoras(filter),
        api.listLoraTags(),
      ]);
      const list = applyPendingPins(fetched, pendingLoraPins.current);
      // "Most versions" is a property of the whole shelf, not of one row: a
      // lora's weight is the number of distinct variants of that model, the
      // same set the family deck is folded from. A lone lora counts as one.
      const versions =
        loraSort === "versions" ? new Map<string, number>() : null;
      if (versions) {
        for (const family of detectFamilies(list)) {
          for (const member of family.members) {
            versions.set(member.id, family.members.length);
          }
        }
      }
      const order = homeOrder(list, loraSort, (lora) => versions?.get(lora.id) ?? 1);
      loraOrderRef.current = order;
      setLoras(pinnedFirst(list, order));
      setLoraTags(tagList);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, loraGroupId, selectedTags, matchAllTags, loraSort]);

  /** Pinning never touches the shelf data: the tile flips its gild state, the
   * grid slides it into the new slot with a layout spring, and the write goes
   * out in the background. No refetch means no re-mount, no lost images and no
   * scroll jump; a failed write simply puts the tile back. */
  const toggleCardPin = useCallback((id: string, pinned: boolean) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, pinned } : c)));
    // unpinning needs no bloom — the card can slide back right away
    const settle = () =>
      holdView(scrollRef.current, () =>
        setCards((prev) => pinnedFirst(prev, cardOrderRef.current)),
      );
    if (pinned) window.setTimeout(settle, PIN_BLOOM_MS);
    else settle();
    const token = ++pinToken.current;
    pendingCardPins.current.set(id, { pinned, token });
    const release = () => {
      if (pendingCardPins.current.get(id)?.token === token) {
        pendingCardPins.current.delete(id);
      }
    };
    void api.setCardPinned(id, pinned).then(release, () => {
      release();
      holdView(scrollRef.current, () =>
        setCards((prev) =>
          pinnedFirst(
            prev.map((c) => (c.id === id ? { ...c, pinned: !pinned } : c)),
            cardOrderRef.current,
          ),
        ),
      );
    });
  }, []);

  const toggleLoraPin = useCallback((id: string, pinned: boolean) => {
    setLoras((prev) => prev.map((l) => (l.id === id ? { ...l, pinned } : l)));
    const settle = () =>
      holdView(scrollRef.current, () =>
        setLoras((prev) => pinnedFirst(prev, loraOrderRef.current)),
      );
    if (pinned) window.setTimeout(settle, PIN_BLOOM_MS);
    else settle();
    const token = ++pinToken.current;
    pendingLoraPins.current.set(id, { pinned, token });
    const release = () => {
      if (pendingLoraPins.current.get(id)?.token === token) {
        pendingLoraPins.current.delete(id);
      }
    };
    void api.setLoraPinned(id, pinned).then(release, () => {
      release();
      holdView(scrollRef.current, () =>
        setLoras((prev) =>
          pinnedFirst(
            prev.map((l) => (l.id === id ? { ...l, pinned: !pinned } : l)),
            loraOrderRef.current,
          ),
        ),
      );
    });
  }, []);

  /** A family is one shelf entry, so pinning it pins every variant: the deck
   * tile then floats to the top exactly like a single pinned lora. */
  const toggleFamilyPin = useCallback(
    (memberIds: string[], pinned: boolean) => {
      const ids = new Set(memberIds);
      const token = ++pinToken.current;
      for (const id of memberIds) {
        pendingLoraPins.current.set(id, { pinned, token });
      }
      const release = () => {
        for (const id of memberIds) {
          if (pendingLoraPins.current.get(id)?.token === token) {
            pendingLoraPins.current.delete(id);
          }
        }
      };
      holdView(scrollRef.current, () => {
        setLoras((prev) =>
          pinnedFirst(
            prev.map((l) => (ids.has(l.id) ? { ...l, pinned } : l)),
            loraOrderRef.current,
          ),
        );
      });
      void Promise.all(
        memberIds.map((id) => api.setLoraPinned(id, pinned)),
      ).then(release, () => {
        release();
        holdView(scrollRef.current, () => {
          setLoras((prev) =>
            pinnedFirst(
              prev.map((l) => (ids.has(l.id) ? { ...l, pinned: !pinned } : l)),
              loraOrderRef.current,
            ),
          );
        });
      });
    },
    [],
  );

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
    setFamilyOpenId(null);
  }, [mode]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(query), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  // a different card always opens on its main prompt
  useEffect(() => {
    setDetailPromptIdx(0);
  }, [detailId]);

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

  // any change to the selection (or a shelf switch) disarms a pending delete
  useEffect(() => {
    setConfirmBulkDelete(false);
  }, [selection, selectMode, mode]);

  const deleteSelection = useCallback(async () => {
    if (selection.length === 0) return;
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      window.setTimeout(() => setConfirmBulkDelete(false), 3200);
      return;
    }

    const ids = [...selection];
    setConfirmBulkDelete(false);
    const results = await Promise.allSettled(
      ids.map((id) =>
        mode === "prompt" ? api.deleteCard(id) : api.deleteLora(id),
      ),
    );
    const failed = ids.filter((_, i) => results[i].status === "rejected");
    const deleted = ids.length - failed.length;

    if (deleted > 0) {
      setSelection(failed);
      setDetailId((cur) => (cur && ids.includes(cur) ? null : cur));
      setLoraDetailId((cur) => (cur && ids.includes(cur) ? null : cur));
    }
    if (deleted === 0) {
      toast(t("toast.error"), "error");
    } else if (failed.length > 0) {
      toast(t("toast.error"), "error");
    } else {
      toast(t("toast.deletedMany", { n: deleted }));
    }

    await Promise.all([
      mode === "prompt" ? loadCards() : loadLoras(),
      mode === "prompt" ? loadGroups() : loadLoraGroups(),
    ]);
  }, [
    confirmBulkDelete,
    loadCards,
    loadGroups,
    loadLoraGroups,
    loadLoras,
    mode,
    selection,
    t,
    toast,
  ]);

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

  // ------------------------------------------------------- lora families

  const groupPendingFamilies = useCallback(() => {
    if (pendingFamilies.length === 0) return;
    const next = Array.from(
      new Set([...familyGrouped, ...pendingFamilies.map((f) => f.id)]),
    );
    setFamilyGrouped(next);
    writeGroupedFamilies(next);
    toast(t("family.grouped", { n: pendingFamilies.length }));
  }, [familyGrouped, pendingFamilies, t, toast]);

  const dismissPendingFamilies = useCallback(() => {
    if (pendingFamilies.length === 0) return;
    const next = [...familyDismissed];
    for (const family of pendingFamilies) {
      const record: FamilyDismiss = {
        id: family.id,
        signature: family.signature,
      };
      const at = next.findIndex((d) => d.id === family.id);
      if (at === -1) next.push(record);
      else next[at] = record;
    }
    setFamilyDismissed(next);
    writeDismissedFamilies(next);
  }, [familyDismissed, pendingFamilies]);

  const splitFamily = useCallback(
    (id: string) => {
      const next = familyGrouped.filter((x) => x !== id);
      setFamilyGrouped(next);
      writeGroupedFamilies(next);
      setFamilyOpenId(null);
      toast(t("family.splitToast"));
    },
    [familyGrouped, t, toast],
  );

  /** Grouping from a lora page also clears that family's decline, so a later
   *  split can bring the header offer back for a fresh decision. */
  const groupFamilyFromDetail = useCallback(
    (id: string) => {
      const nextDismissed = familyDismissed.filter((d) => d.id !== id);
      setFamilyDismissed(nextDismissed);
      writeDismissedFamilies(nextDismissed);
      const nextGrouped = Array.from(new Set([...familyGrouped, id]));
      setFamilyGrouped(nextGrouped);
      writeGroupedFamilies(nextGrouped);
      setLoraDetailId(null);
      toast(t("family.groupedOne"));
    },
    [familyDismissed, familyGrouped, t, toast],
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
    async (res: CivitaiImport, allowEmptyPrompt = false) => {
      const image = res.image;
      if (!image) throw new Error("CIVITAI_NO_IMAGE");
      try {
        const created = await api.createCard({
          prompt: res.prompt,
          variants: [],
          negative_prompt: res.negative_prompt,
          note: "",
          rating: 0,
          tags: res.tags,
          images: [image.temp_path],
          loras: res.loras,
          group_id: groupId,
          author: res.author || null,
          checkpoint: res.checkpoint || null,
          meta: res.meta,
          workflow: res.workflow ?? null,
          source_key: res.source_key,
          allow_empty_prompt: allowEmptyPrompt,
        });
        pushReceipt({
          id: created.id,
          thumb: image.preview,
          prompt: res.prompt,
        });
        await loadCards();
      } catch (e) {
        // the image was staged into the temp dir but never landed on a card —
        // don't leave the file behind
        void api.discardTemp(image.temp_path).catch(() => undefined);
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
        // The page published no generation data: there is no prompt to match
        // or save. Park the job with only the remote photo and let the user
        // decide whether the image itself is worth keeping.
        if (res.no_prompt || !res.prompt.trim()) {
          updateJob(id, { status: "noprompt", pre: res, hits: undefined });
          return;
        }
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

  // Parked imports that need a decision queue behind whichever dialog is up.
  // One effect owns both kinds so two dialogs can never open in one commit:
  // duplicates first (they may still be saved), then promptless pages.
  useEffect(() => {
    if (dupHits !== null || missingPrompt !== null) return;
    const dupJob = jobs.find(
      (j) => j.status === "dup" && j.hits && j.hits.length > 0,
    );
    if (dupJob?.hits) {
      pendingDup.current = {
        jobId: dupJob.id,
        url: dupJob.url,
        pre: dupJob.pre ?? null,
      };
      setDupHits(dupJob.hits);
      return;
    }
    const noPromptJob = jobs.find((j) => j.status === "noprompt" && j.pre);
    if (!noPromptJob?.pre) return;
    pendingNoPrompt.current = {
      jobId: noPromptJob.id,
      url: noPromptJob.url,
      pre: noPromptJob.pre,
    };
    setMissingPrompt(noPromptJob.pre);
  }, [dupHits, jobs, missingPrompt]);

  /** Keep the photo of a promptless page: only now is it downloaded. */
  const saveWithoutPrompt = useCallback(() => {
    const p = pendingNoPrompt.current;
    if (!p || noPromptSaving) return;
    setNoPromptSaving(true);
    updateJob(p.jobId, { status: "running", hits: undefined, pre: undefined });
    void (async () => {
      const previewUrl = p.pre.preview_url;
      if (!previewUrl) throw new Error("CIVITAI_NO_IMAGE");
      const image = await api.civitaiDownload(previewUrl);
      await createFromImport({ ...p.pre, image }, true);
      updateJob(p.jobId, { status: "done" });
      window.setTimeout(() => removeJob(p.jobId), 900);
    })()
      .catch((e) =>
        updateJob(p.jobId, {
          status: "error",
          error: importErrorToKey(String(e)),
        }),
      )
      .finally(() => {
        setNoPromptSaving(false);
        setMissingPrompt(null);
        pendingNoPrompt.current = null;
      });
  }, [createFromImport, noPromptSaving, removeJob, updateJob]);

  const cancelWithoutPrompt = useCallback(() => {
    const p = pendingNoPrompt.current;
    if (noPromptSaving) return;
    setMissingPrompt(null);
    pendingNoPrompt.current = null;
    // nothing was downloaded, so the parked job simply disappears
    if (p) removeJob(p.jobId);
  }, [noPromptSaving, removeJob]);

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

  // ------------------------------------------------ clipboard paste router

  /** ⌘V router: a CivitAI link on the clipboard imports straight into the
   * active shelf (image/post link → prompt import, model link → lora
   * import); everything else keeps the image-paste flow. Never fires while
   * any dialog is up — field pastes inside the import dialog and the
   * editors stay native, nothing intercepts them. */
  const pasteFromClipboard = useCallback(async () => {
    const modalOpen =
      importOpen ||
      settingsOpen ||
      tagsOpen ||
      updateOpen ||
      groupsOpenRef.current ||
      detailOpenRef.current ||
      loraDetailOpenRef.current ||
      dupHits !== null ||
      missingPrompt !== null ||
      loraDupHits !== null ||
      familyOpenId !== null;
    const text = modalOpen
      ? null
      : await api.pasteTextFromClipboard().catch(() => null);
    const link = text?.trim() ?? "";
    if (link) {
      if (modeRef.current === "prompt") {
        const hit = matchCivitaiLink(link, CIVITAI_ITEM_LINK);
        if (hit) {
          void startCivitaiImport(hit);
          return;
        }
      } else {
        const hit = matchCivitaiLink(link, CIVITAI_MODEL_LINK);
        if (hit) {
          void startLoraImport(hit);
          return;
        }
      }
    }
    void (modeRef.current === "prompt"
      ? pasteGlobally()
      : pasteLoraGlobally());
  }, [
    dupHits,
    familyOpenId,
    importOpen,
    loraDupHits,
    missingPrompt,
    pasteGlobally,
    pasteLoraGlobally,
    settingsOpen,
    startCivitaiImport,
    startLoraImport,
    tagsOpen,
    updateOpen,
  ]);

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
      const key = shortcutKey(e);
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
      } else if (meta && key === ",") {
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
              const prompt = [d.prompt, ...d.variants][detailPromptIdx];
              if (prompt?.trim()) {
                e.preventDefault();
                void copyPromptText(prompt);
              }
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
          void pasteFromClipboard();
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
    detailPromptIdx,
    loraDetail,
    navDetail,
    navLoraDetail,
    openEditorNew,
    openLoraEditorNew,
    pasteFromClipboard,
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
    updateOpen ||
    familyOpenId !== null;

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
        familyCount={pendingFamilies.length}
        onGroupFamilies={groupPendingFamilies}
        onDismissFamilies={dismissPendingFamilies}
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

      <main
        ref={scrollRef}
        style={{ overflowAnchor: "none" }}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
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
                  onTogglePin={toggleCardPin}
                  scrollRef={scrollRef}
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
                  onTogglePin={toggleLoraPin}
                  families={groupedFamilies}
                  onOpenFamily={setFamilyOpenId}
                  onToggleFamilyPin={toggleFamilyPin}
                  scrollRef={scrollRef}
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
        matchAll={matchAllTags}
        onMatchAllChange={setMatchAllTags}
        onClose={() => setTagsOpen(false)}
        tags={mode === "prompt" ? tags : loraTags}
        selected={selectedTags}
        onToggle={(tag) =>
          setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
          )
        }
        onClear={() => setSelectedTags([])}
      />

      {openFamily && (
        <LoraFamilyDialog
          family={openFamily}
          onClose={() => setFamilyOpenId(null)}
          onSplit={splitFamily}
          onOpenLora={(id) => {
            setFamilyOpenId(null);
            setLoraDetailId(id);
          }}
        />
      )}

      {selectMode && (
        <div className="anim-panel fixed bottom-5 left-1/2 z-[80] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink py-2 pr-2 pl-5 text-on-ink shadow-panel">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <ListChecks size={14.5} className="shrink-0 opacity-80" />
            {t("groups.selected", { n: selection.length })}
          </span>
          <span className="mx-1 h-4 w-px bg-on-ink/20" aria-hidden />
          <button
            type="button"
            data-groups-trigger
            aria-label={t("select.move")}
            onClick={() => setGroupsOpen(true)}
            disabled={selection.length === 0}
            className="press flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-on-ink/15 px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-on-ink/25 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-on-ink/15"
          >
            <CornerDownRight size={13.5} />
            <span className="hidden sm:inline">{t("select.move")}</span>
          </button>
          {selection.length > 0 && (
            <ConfirmDeleteButton
              compact
              tone="on-dark"
              armed={confirmBulkDelete}
              title={t("select.delete")}
              onClick={() => void deleteSelection()}
            />
          )}
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
          promptIdx={detailPromptIdx}
          onPromptIdxChange={setDetailPromptIdx}
          suggestions={tags}
          onImportLora={(url) => {
            // jump to the lora shelf so the background job tile is in view
            setMode("lora");
            window.localStorage.setItem("ps-mode", "lora");
            void startLoraImport(url);
          }}
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
          groupOffer={detailFamilyOffer}
          onGroupFamily={groupFamilyFromDetail}
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
              // data can change between the warning and the refetch; a page
              // that lost its prompt falls back to the save-anyway dialog
              if (res.no_prompt || !res.prompt.trim()) {
                updateJob(p.jobId, {
                  status: "noprompt",
                  pre: res,
                  hits: undefined,
                });
                return;
              }
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
            if (p?.pre?.image)
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
            if (p?.pre?.image)
              void api
                .discardTemp(p.pre.image.temp_path)
                .catch(() => undefined);
            setDupHits(null);
            pendingDup.current = null;
            if (p) removeJob(p.jobId);
          }}
        />
      )}
      {mode === "prompt" && (
        <MissingPromptDialog
          open={missingPrompt !== null}
          previewUrl={missingPrompt?.preview_url ?? null}
          author={missingPrompt?.author}
          checkpoint={missingPrompt?.checkpoint}
          saving={noPromptSaving}
          onSave={saveWithoutPrompt}
          onCancel={cancelWithoutPrompt}
        />
      )}
      {mode === "lora" && (
        <DuplicateDialog
          open={loraDupHits !== null}
          hits={loraDupHits ?? []}
          proceedKey="dup.proceed"
          lora
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
