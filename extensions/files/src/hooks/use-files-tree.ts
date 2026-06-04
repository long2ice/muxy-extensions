// Core hook that owns the @pierre/trees FileTree model for the files panel.
//
// Design constraints (verified against @pierre/trees source + the Muxy host):
//   - useFileTree() builds the model ONCE; later options.paths are ignored, so
//     we pass paths:[] and drive ALL content imperatively via the handle.
//   - Tree nodes are canonical path strings; directories carry a trailing slash.
//   - muxy.files.* paths are sandboxed to the active worktree root and RELATIVE
//     to it, so the tree paths ARE the muxy.files.* paths (no absolute root).
//     muxy.files.list("") lists the worktree root.
//   - There is no lazy-child-loader callback, so we implement lazy loading by
//     subscribing to model changes and, for each known-but-unloaded directory
//     that is now expanded, listing + adding its children.
//   - DnD/rename mutate the model FIRST then call our callback; the FS op runs
//     after and reverts the model on failure (see file-ops.ts).
//   - The config closures are captured at construction, so they must read the
//     LATEST handlers through refs.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFileTree } from "@pierre/trees/react";
import type {
  FileTree,
  FileTreeBatchOperation,
  FileTreeDirectoryHandle,
  FileTreeDropResult,
  FileTreeItemHandle,
  FileTreeMutationEvent,
  FileTreeRenameEvent,
  GitStatusEntry,
} from "@pierre/trees";

import {
  canonical_dir,
  copy_path,
  entry_to_rel,
  open_externally,
  open_in_editor,
  parent_dir,
  reveal_in_finder,
} from "@/lib/files";
import {
  create_file,
  create_folder,
  delete_paths,
  duplicate as duplicate_op,
  move_fs,
  rename_fs,
} from "@/lib/file-ops";

export type { FileTree };

/** Bound operations the panel invokes with worktree-relative paths. */
export interface FilesTreeOps {
  /** Create a file inside `parentRel` (omit/`""` => root) and inline-rename it. */
  createFile(parentRel?: string): Promise<boolean>;
  /** Create a folder inside `parentRel` (omit/`""` => root) and inline-rename it. */
  createFolder(parentRel?: string): Promise<boolean>;
  /** Confirm + delete (Trash) the given relative paths. */
  deletePaths(rels: string[]): Promise<boolean>;
  /** Duplicate a file/folder next to itself. */
  duplicate(rel: string): Promise<boolean>;
  /** Begin inline rename; the FS rename happens in the renaming.onRename hook. */
  rename(rel: string): void;
  /** Reveal in Finder. */
  reveal(rel: string): Promise<void>;
  /** Open with the default external app. */
  openExternally(rel: string): Promise<void>;
  /** Copy the path to the clipboard. */
  copyPath(rel: string): Promise<void>;
  /** Open the file in the extension's editor tab. */
  openInEditor(rel: string): Promise<void>;
}

export interface UseFilesTreeResult {
  model: FileTree;
  ready: boolean;
  ops: FilesTreeOps;
  /** Force a full re-list of the worktree root. */
  refresh: () => void;
}

const RECONCILE_DEBOUNCE_MS = 250;

/** Collect canonical directory paths touched by a mutation event. */
function collect_dirs(event: FileTreeMutationEvent, sink: (dir: string) => void): void {
  switch (event.operation) {
    case "add":
      if (event.path.endsWith("/")) sink(event.path);
      break;
    case "remove":
      if (event.path.endsWith("/")) sink(event.path);
      break;
    case "move":
      if (event.to.endsWith("/")) sink(event.to);
      break;
    case "batch":
      for (const inner of event.events) collect_dirs(inner, sink);
      break;
    case "reset":
      break;
  }
}

function is_directory_handle(
  handle: FileTreeItemHandle | null,
): handle is FileTreeDirectoryHandle {
  return handle != null && handle.isDirectory() && "isExpanded" in handle;
}

/**
 * @param reloadKey changes whenever the panel wants a fresh root load (e.g. on a
 *   worktree/project switch). Drives the initial + re-root load.
 */
export function useFilesTree(
  reloadKey: number,
  registerOps?: (ops: FilesTreeOps | null) => void,
): UseFilesTreeResult {
  const [ready, setReady] = useState(false);

  // Lazy-loading bookkeeping. Canonical dir rels; "" means the worktree root.
  const loadedDirs = useRef<Set<string>>(new Set());
  const loadingDirs = useRef<Set<string>>(new Set());
  const knownDirs = useRef<Set<string>>(new Set());
  const childSets = useRef<Map<string, Set<string>>>(new Map());

  // Running set of ignored paths so repeated setGitStatus calls stay complete.
  const ignored = useRef<Set<string>>(new Set());

  // Mutable handler refs read by the construction-time config closures.
  const onDropRef = useRef<(event: FileTreeDropResult) => void>(() => {});
  const onRenameRef = useRef<(event: FileTreeRenameEvent) => void>(() => {});
  const onSelectionRef = useRef<(paths: readonly string[]) => void>(() => {});

  const { model } = useFileTree({
    paths: [],
    initialExpansion: "closed",
    search: false,
    density: "compact",
    icons: { set: "standard", colored: false },
    dragAndDrop: {
      canDrag: (paths) => paths.length > 0,
      canDrop: (ctx) => ctx.target.kind === "directory" || ctx.target.kind === "root",
      onDropComplete: (event) => onDropRef.current(event),
      onDropError: (error) => {
        void muxy.toast({ title: "Move", body: error, variant: "error" }).catch(() => undefined);
      },
    },
    renaming: {
      onRename: (event) => onRenameRef.current(event),
      onError: (error) => {
        void muxy.toast({ title: "Rename", body: error, variant: "error" }).catch(() => undefined);
      },
    },
    onSelectionChange: (paths) => onSelectionRef.current(paths),
  });

  // --- Git status (dim ignored files) --------------------------------------

  const pushGitStatus = useCallback(() => {
    const entries: GitStatusEntry[] = [];
    for (const path of ignored.current) entries.push({ path, status: "ignored" });
    model.setGitStatus(entries);
  }, [model]);

  // --- Content loading ------------------------------------------------------

  const recordChildren = useCallback(
    (dirRel: string, rels: string[], ignoredRels: string[]) => {
      childSets.current.set(dirRel, new Set(rels));
      knownDirs.current.add(dirRel);
      for (const r of rels) if (r.endsWith("/")) knownDirs.current.add(r);
      for (const r of ignoredRels) ignored.current.add(r);
    },
    [],
  );

  const loadRoot = useCallback(async () => {
    loadedDirs.current.clear();
    loadingDirs.current.clear();
    knownDirs.current.clear();
    childSets.current.clear();
    ignored.current.clear();

    try {
      const entries = await muxy.files.list("");
      const rels = entries.map((e) => entry_to_rel(e));
      const ignoredRels = entries.filter((e) => e.isIgnored).map((e) => entry_to_rel(e));
      model.resetPaths(rels, { initialExpandedPaths: [] });
      knownDirs.current.add("");
      loadedDirs.current.add("");
      recordChildren("", rels, ignoredRels);
      pushGitStatus();
    } catch (err) {
      void muxy
        .toast({
          title: "Files",
          body: err instanceof Error ? err.message : String(err),
          variant: "error",
        })
        .catch(() => undefined);
      model.resetPaths([]);
    }
    setReady(true);
  }, [model, pushGitStatus, recordChildren]);

  const loadChildren = useCallback(
    async (dirRel: string) => {
      if (loadedDirs.current.has(dirRel) || loadingDirs.current.has(dirRel)) return;
      loadingDirs.current.add(dirRel);
      try {
        const entries = await muxy.files.list(dirRel);
        const rels = entries.map((e) => entry_to_rel(e));
        const ignoredRels = entries.filter((e) => e.isIgnored).map((e) => entry_to_rel(e));
        model.batch(rels.map((path) => ({ type: "add" as const, path })));
        loadedDirs.current.add(dirRel);
        recordChildren(dirRel, rels, ignoredRels);
        pushGitStatus();
      } catch {
        // Leave the dir unloaded; a later expand or file.changed retries it.
      } finally {
        loadingDirs.current.delete(dirRel);
      }
    },
    [model, pushGitStatus, recordChildren],
  );

  // --- Reconcile a single directory after a file.changed event --------------

  const reconcileDir = useCallback(
    async (dirRel: string) => {
      if (!loadedDirs.current.has(dirRel)) return;
      let entries: MuxyFileEntry[];
      try {
        entries = await muxy.files.list(dirRel);
      } catch {
        return;
      }
      const nextRels = entries.map((e) => entry_to_rel(e));
      const nextSet = new Set(nextRels);
      const prevSet = childSets.current.get(dirRel) ?? new Set<string>();

      const batchOps: FileTreeBatchOperation[] = [];
      for (const path of nextRels) if (!prevSet.has(path)) batchOps.push({ type: "add", path });
      for (const path of prevSet)
        if (!nextSet.has(path)) batchOps.push({ type: "remove", path, recursive: true });
      if (batchOps.length > 0) model.batch(batchOps);

      const ignoredRels = entries.filter((e) => e.isIgnored).map((e) => entry_to_rel(e));
      for (const path of prevSet) if (!nextSet.has(path)) ignored.current.delete(path);
      for (const path of ignoredRels) ignored.current.add(path);
      recordChildren(dirRel, nextRels, ignoredRels);
      pushGitStatus();
    },
    [model, pushGitStatus, recordChildren],
  );

  // --- Selection -> open file ----------------------------------------------

  const maybeOpenFile = useCallback((selectedPaths: readonly string[]) => {
    if (selectedPaths.length !== 1) return;
    const path = selectedPaths[0];
    if (path.endsWith("/")) return; // directory
    void open_in_editor(path);
  }, []);

  // --- DnD / rename FS handlers --------------------------------------------

  const handleDrop = useCallback(
    (event: FileTreeDropResult) => {
      const targetDirRel =
        event.target.kind === "root" ? "" : canonical_dir(event.target.directoryPath ?? "");
      void move_fs(model, event.draggedPaths, targetDirRel, () => {
        // FS move failed and was alerted; re-list source + target dirs to repair.
        const dirs = new Set<string>([targetDirRel]);
        for (const p of event.draggedPaths) dirs.add(parent_dir(p));
        for (const d of dirs) if (loadedDirs.current.has(d)) void reconcileDir(d);
      });
    },
    [model, reconcileDir],
  );

  const handleRename = useCallback(
    (event: FileTreeRenameEvent) => {
      void rename_fs(model, event.sourcePath, event.destinationPath, event.isFolder);
    },
    [model],
  );

  // Keep the construction-time config closures pointed at the latest handlers.
  useEffect(() => {
    onDropRef.current = handleDrop;
    onRenameRef.current = handleRename;
    onSelectionRef.current = maybeOpenFile;
  }, [handleDrop, handleRename, maybeOpenFile]);

  // --- Lazy-load on expand + track known dirs -------------------------------

  useEffect(() => {
    const checkExpanded = () => {
      for (const dir of knownDirs.current) {
        if (dir === "") continue;
        if (loadedDirs.current.has(dir) || loadingDirs.current.has(dir)) continue;
        const handle = model.getItem(dir);
        if (is_directory_handle(handle) && handle.isExpanded()) {
          void loadChildren(dir);
        }
      }
    };

    const unsubscribe = model.subscribe(checkExpanded);
    const unsubscribeMutation = model.onMutation("*", (event) => {
      collect_dirs(event, (dir) => knownDirs.current.add(dir));
    });

    return () => {
      unsubscribe();
      unsubscribeMutation();
    };
  }, [model, loadChildren]);

  // --- (Re)load the root whenever the reload key changes --------------------

  useEffect(() => {
    setReady(false);
    void loadRoot();
  }, [reloadKey, loadRoot]);

  // --- Live refresh on file.changed (debounced per directory) ---------------

  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const dirs = Array.from(pending);
      pending.clear();
      for (const dir of dirs) void reconcileDir(dir);
    };

    const unsubscribe = muxy.events.subscribe("file.changed", (payload) => {
      const raw =
        payload && typeof payload === "object" && "path" in payload
          ? (payload as { path?: unknown }).path
          : undefined;
      if (typeof raw !== "string") return;
      // file.changed paths are worktree-relative already.
      const dir = parent_dir(raw.replace(/^\/+/, ""));
      pending.add(dir);
      if (timer === null) timer = setTimeout(flush, RECONCILE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [reconcileDir]);

  // --- Bound ops ------------------------------------------------------------

  const opsRef = useRef<FilesTreeOps>({
    createFile: (parentRel = "") => create_file(model, parentRel),
    createFolder: (parentRel = "") => create_folder(model, parentRel),
    deletePaths: (rels) => delete_paths(model, rels),
    duplicate: (rel) => duplicate_op(model, rel),
    rename: (rel) => {
      model.startRenaming(rel);
    },
    reveal: (rel) => reveal_in_finder(rel),
    openExternally: (rel) => open_externally(rel),
    copyPath: (rel) => copy_path(rel),
    openInEditor: (rel) => open_in_editor(rel),
  });

  const refresh = useCallback(() => {
    setReady(false);
    void loadRoot();
  }, [loadRoot]);

  // Lift ops up for header-button commands. `ops` is stable (stored in a ref),
  // so register once on mount and clear on unmount.
  const registerOpsRef = useRef(registerOps);
  registerOpsRef.current = registerOps;
  useEffect(() => {
    registerOpsRef.current?.(opsRef.current);
    return () => registerOpsRef.current?.(null);
  }, []);

  return { model, ready, ops: opsRef.current, refresh };
}
