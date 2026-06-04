import type { FilesTreeOps } from "@/hooks/use-files-tree";
import { parent_dir } from "@/lib/files";

export interface ContextMenuTarget {
  kind: "directory" | "file";
  name: string;
  path: string;
}

interface FileContextMenuProps {
  item: ContextMenuTarget;
  ops: FilesTreeOps;
  close: () => void;
}

interface MenuAction {
  label: string;
  run: () => void;
  critical?: boolean;
}

/**
 * Context-menu body rendered into the @pierre/trees shadow slot. Plain themed
 * buttons; each action runs an op then closes the menu. Actions are gated by
 * whether the target is a directory or a file.
 */
export function FileContextMenu({ item, ops, close }: FileContextMenuProps) {
  const isDir = item.kind === "directory";
  const path = item.path;
  // New file/folder land inside a directory target, or in a file's parent dir.
  const createDir = isDir ? path : parent_dir(path);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const actions: MenuAction[] = [];

  actions.push({ label: "New File", run: run(() => void ops.createFile(createDir)) });
  actions.push({ label: "New Folder", run: run(() => void ops.createFolder(createDir)) });

  actions.push({ label: "Rename", run: run(() => ops.rename(path)) });
  actions.push({ label: "Duplicate", run: run(() => void ops.duplicate(path)) });
  actions.push({ label: "Reveal in Finder", run: run(() => void ops.reveal(path)) });
  actions.push({ label: "Copy Path", run: run(() => void ops.copyPath(path)) });
  actions.push({ label: "Open Externally", run: run(() => void ops.openExternally(path)) });
  actions.push({ label: "Delete", run: run(() => void ops.deletePaths([path])), critical: true });

  return (
    <div className="ctx-menu" data-file-tree-context-menu-root="true">
      {actions.map((a, i) => (
        <button
          key={a.label}
          type="button"
          className={`ctx-item${a.critical ? " ctx-item-critical" : ""}`}
          onClick={a.run}
          // keep the critical action visually separated from the rest
          style={a.critical && i > 0 ? { marginTop: "var(--s2)" } : undefined}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
