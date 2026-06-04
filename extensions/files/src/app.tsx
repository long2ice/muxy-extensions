import { useCallback, useEffect, useRef, useState } from "react";
import { FileTreePanel } from "@/components/file-tree-panel";
import type { FilesTreeOps } from "@/hooks/use-files-tree";

export function App() {
  // Bumped on workspace changes to trigger a fresh root load in the tree hook.
  const [reloadKey, setReloadKey] = useState(0);
  const opsRef = useRef<FilesTreeOps | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Re-root on workspace changes.
  useEffect(() => {
    const offWorktree = muxy.events.subscribe("worktree.switched", reload);
    const offProject = muxy.events.subscribe("project.switched", reload);
    return () => {
      offWorktree?.();
      offProject?.();
    };
  }, [reload]);

  // Header-button commands operate on the active tree ops (create at root "").
  useEffect(() => {
    const offNewFile = muxy.events.subscribe("command.files-new-file", () => {
      void opsRef.current?.createFile("");
    });
    const offNewFolder = muxy.events.subscribe("command.files-new-folder", () => {
      void opsRef.current?.createFolder("");
    });
    const offRefresh = muxy.events.subscribe("command.files-refresh", reload);
    return () => {
      offNewFile?.();
      offNewFolder?.();
      offRefresh?.();
    };
  }, [reload]);

  const registerOps = useCallback((ops: FilesTreeOps | null) => {
    opsRef.current = ops;
  }, []);

  return (
    <div className="files-panel">
      <FileTreePanel reloadKey={reloadKey} registerOps={registerOps} />
    </div>
  );
}
