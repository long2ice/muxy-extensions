// Remembers the file-tree's expanded directories and selected file per
// worktree, so reopening the panel (or restarting Muxy) restores the same view
// the user left. Scoped by the absolute worktree root path: switching projects
// or worktrees swaps to that scope's own snapshot. Persisted in localStorage,
// mirroring the icon-theme store.

import { worktree_root } from "@/lib/worktree-root";

const STORAGE_PREFIX = "muxy.files.tree-memory:";
// Cap stored expanded paths so a deeply-explored tree can't grow the entry
// without bound; the most recently expanded dirs are the ones worth keeping.
const MAX_EXPANDED = 500;

function storage_key(root) {
  return `${STORAGE_PREFIX}${root || ""}`;
}

// Returns { expanded: string[], selected: string|null } for the active
// worktree, or empty defaults when nothing is stored or storage is unavailable.
export async function load_tree_memory() {
  const root = await worktree_root();
  try {
    const raw = localStorage.getItem(storage_key(root));
    if (!raw) return { expanded: [], selected: null };
    const parsed = JSON.parse(raw);
    const expanded = Array.isArray(parsed?.expanded)
      ? parsed.expanded.filter((p) => typeof p === "string")
      : [];
    const selected = typeof parsed?.selected === "string" ? parsed.selected : null;
    return { expanded, selected };
  } catch {
    return { expanded: [], selected: null };
  }
}

// Persists the current expanded set and selection for the active worktree.
// `expandedDirs` is a Set; `selected` may be null.
export async function save_tree_memory(expandedDirs, selected) {
  const root = await worktree_root();
  const expanded = Array.from(expandedDirs).slice(-MAX_EXPANDED);
  try {
    localStorage.setItem(
      storage_key(root),
      JSON.stringify({ expanded, selected: selected ?? null }),
    );
  } catch {
    // Persistence is best-effort; a full or disabled store just means no memory.
  }
}
