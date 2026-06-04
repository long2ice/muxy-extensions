// Shared helpers for the files extension. Mirrors the structure of the git
// extension's src/lib/git.ts: thin muxy.* wrappers + dialog/error helpers +
// path normalization. Everything that touches muxy.files.* or muxy.exec goes
// through here so the rest of the app stays declarative.
//
// IMPORTANT: muxy.files.* paths are sandboxed to the active worktree root and
// are RELATIVE to it (per the Muxy Files API). So the tree's canonical paths ARE
// the paths we hand to muxy.files.*; there is no separate absolute "root". We
// keep tiny path helpers for the trailing-slash directory convention only.

// --- Path helpers -----------------------------------------------------------

/** Strip a trailing slash (directory paths in the tree are canonicalized with one). */
export function strip_slash(path: string): string {
  return path.replace(/\/+$/, "");
}

/** Ensure a directory path carries the trailing slash @pierre/trees expects. */
export function canonical_dir(rel: string): string {
  const clean = strip_slash(rel);
  return clean ? `${clean}/` : clean;
}

/** Parent directory of a relative path, as a canonical dir (trailing slash), "" for root. */
export function parent_dir(rel: string): string {
  const clean = strip_slash(rel);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? "" : `${clean.slice(0, idx)}/`;
}

/** Basename of a path. */
export function basename(path: string): string {
  const clean = strip_slash(path);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? clean : clean.slice(idx + 1);
}

/**
 * Canonical tree path (relative, trailing slash for dirs) for a muxy file entry.
 * muxy.files.list returns worktree-relative paths already, so we just normalize
 * the directory trailing-slash convention.
 */
export function entry_to_rel(entry: MuxyFileEntry): string {
  const rel = strip_slash(entry.path);
  return entry.isDirectory ? canonical_dir(rel) : rel;
}

// --- Error / dialog helpers (mirrored from git ext) -------------------------

export function error_message(err: unknown): string {
  if (err instanceof Error) return err.message;
  const text = String(err).trim();
  return text || "Unknown error";
}

export async function confirm_action(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  critical?: boolean;
}): Promise<boolean> {
  try {
    const choice = await muxy.dialog.confirm({
      title: opts.title,
      message: opts.message,
      buttons: [opts.confirmLabel, "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
      style: opts.critical ? "critical" : "warning",
    });
    return choice === opts.confirmLabel;
  } catch {
    return false;
  }
}

export async function alert_error(title: string, err: unknown): Promise<void> {
  try {
    await muxy.dialog.alert({ title, message: error_message(err), style: "critical" });
  } catch {
    void 0;
  }
}

export async function try_action(action: () => Promise<unknown>, error_title: string): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    await alert_error(error_title, err);
    return false;
  }
}

// --- Tab / shell actions ----------------------------------------------------
// Shell actions (reveal/open) run with the worktree as cwd (muxy.exec's default
// working directory is the active worktree), so a worktree-relative path works.

export async function open_in_editor(rel: string): Promise<void> {
  try {
    await muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "editor",
        singleton: true,
        data: { filePath: rel },
      },
    });
  } catch {
    void 0;
  }
}

export async function reveal_in_finder(rel: string): Promise<void> {
  await muxy.exec(["open", "-R", strip_slash(rel)]).catch(() => undefined);
}

export async function open_externally(rel: string): Promise<void> {
  await muxy.exec(["open", strip_slash(rel)]).catch(() => undefined);
}

export async function copy_path(rel: string): Promise<void> {
  const path = strip_slash(rel);
  try {
    await navigator.clipboard.writeText(path);
    await muxy.toast({ body: "Path copied", variant: "info" }).catch(() => undefined);
  } catch {
    await muxy.toast({ title: "Copy path", body: path, variant: "info" }).catch(() => undefined);
  }
}
