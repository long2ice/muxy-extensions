// Filesystem-operations layer for the files tree. Each export performs a
// muxy.files.* (or muxy.exec) call together with the matching @pierre/trees
// model mutation, reverting the model when the underlying FS op fails. Pure of
// React; the hook closes over `model` and hands these worktree-relative paths.
//
// All paths are worktree-relative (muxy.files.* is sandboxed/relative). There is
// no absolute "root".

import type { FileTree } from "@pierre/trees";
import {
  alert_error,
  basename,
  canonical_dir,
  confirm_action,
  parent_dir,
  try_action,
} from "@/lib/files";

/** Default base name for a freshly created file (before inline rename). */
const NEW_FILE_NAME = "untitled";
/** Default base name for a freshly created folder (before inline rename). */
const NEW_FOLDER_NAME = "untitled-folder";

/**
 * Split a basename into its stem + extension. A leading dot (dotfiles) is not
 * treated as an extension boundary, and folders never have an extension.
 */
function split_ext(name: string, isFolder: boolean): { stem: string; ext: string } {
  if (isFolder) return { stem: name, ext: "" };
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, idx), ext: name.slice(idx) };
}

/**
 * Create an empty file inside `parentRel`, insert it into the model and start
 * inline rename so the user can name it. Reverts the model on FS failure.
 */
export async function create_file(model: FileTree, parentRel: string): Promise<boolean> {
  const parent = canonical_dir(parentRel);
  const rel = `${parent}${NEW_FILE_NAME}`;
  const ok = await try_action(async () => {
    await muxy.files.write(rel, "");
  }, "Create File");
  if (!ok) return false;
  model.add(rel);
  if (!model.startRenaming(rel, { removeIfCanceled: true })) {
    // Renaming surface unavailable; leave the file in place and focused.
    model.focusPath(rel);
  }
  return true;
}

/**
 * Create a directory inside `parentRel`, insert it into the model and start
 * inline rename. Reverts the model on FS failure.
 */
export async function create_folder(model: FileTree, parentRel: string): Promise<boolean> {
  const parent = canonical_dir(parentRel);
  const rel = canonical_dir(`${parent}${NEW_FOLDER_NAME}`);
  const ok = await try_action(async () => {
    await muxy.files.mkdir(rel);
  }, "Create Folder");
  if (!ok) return false;
  model.add(rel);
  if (!model.startRenaming(rel, { removeIfCanceled: true })) {
    model.focusPath(rel);
  }
  return true;
}

/**
 * Confirm, then move the given relative paths to Trash and remove them from the
 * model. Returns false if cancelled or the FS delete fails.
 */
export async function delete_paths(model: FileTree, rels: readonly string[]): Promise<boolean> {
  if (rels.length === 0) return false;
  const count = rels.length;
  const label = count === 1 ? basename(rels[0]) : `${count} items`;
  const confirmed = await confirm_action({
    critical: true,
    title: "Delete",
    message: `Move ${label} to Trash?`,
    confirmLabel: "Delete",
  });
  if (!confirmed) return false;
  const ok = await try_action(async () => {
    await muxy.files.delete(rels.map((r) => r));
  }, "Delete");
  if (!ok) return false;
  model.batch(rels.map((r) => ({ type: "remove", path: r, recursive: true })));
  return true;
}

/**
 * Duplicate a file or folder next to itself ("name copy", "name copy.ext",
 * incrementing on collision via the FS), then add the result to the model.
 */
export async function duplicate(model: FileTree, rel: string): Promise<boolean> {
  const isFolder = rel.endsWith("/");
  const parent = parent_dir(rel);
  const name = basename(rel);
  const { stem, ext } = split_ext(name, isFolder);

  // Find a free destination basename. We can't see the model's child list here,
  // so probe the filesystem via stat() until we hit a name that doesn't exist.
  let destName = `${stem} copy${ext}`;
  for (let n = 2; ; n++) {
    const candidate = `${parent}${destName}`;
    let exists = true;
    try {
      await muxy.files.stat(candidate);
    } catch {
      exists = false;
    }
    if (!exists) break;
    destName = `${stem} copy ${n}${ext}`;
  }

  const destRelRaw = `${parent}${destName}`;

  // No native copy in the files API; cp -R runs with the worktree as cwd, so
  // worktree-relative paths resolve correctly.
  const ok = await try_action(async () => {
    const result = await muxy.exec(["cp", "-R", strip_slash_local(rel), strip_slash_local(destRelRaw)]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `cp exited ${result.exitCode}`);
    }
  }, "Duplicate");
  if (!ok) return false;

  model.add(isFolder ? canonical_dir(destRelRaw) : destRelRaw);
  return true;
}

function strip_slash_local(p: string): string {
  return p.replace(/\/+$/, "");
}

/**
 * Perform the FS rename AFTER the model has already renamed (called from the
 * renaming config's onRename). muxy.files.rename takes (path, newName) where
 * newName is the new BASENAME, not a full path. On failure, revert the model
 * move + alert.
 */
export async function rename_fs(
  model: FileTree,
  sourceRel: string,
  destRel: string,
  isFolder: boolean,
): Promise<boolean> {
  const sourcePath = isFolder ? canonical_dir(sourceRel) : sourceRel;
  const newName = basename(destRel);
  try {
    await muxy.files.rename(sourcePath, newName);
    return true;
  } catch (err) {
    // Revert the model rename the tree already applied optimistically.
    model.move(destRel, sourceRel);
    await alert_error("Rename", err);
    return false;
  }
}

/**
 * Perform the FS move AFTER the model has already moved (called from the
 * dragAndDrop config's onDropComplete). `targetDirRel` is the destination
 * DIRECTORY ("" for root). muxy.files.move takes (paths, into). On failure,
 * alert and invoke `reconcile` so the caller can re-list affected dirs.
 */
export async function move_fs(
  model: FileTree,
  draggedRels: readonly string[],
  targetDirRel: string,
  reconcile?: () => void,
): Promise<boolean> {
  if (draggedRels.length === 0) return true;
  void model;
  const into = strip_slash_local(targetDirRel);
  try {
    await muxy.files.move(draggedRels.map((r) => strip_slash_local(r)), into);
    return true;
  } catch (err) {
    await alert_error("Move", err);
    reconcile?.();
    return false;
  }
}
