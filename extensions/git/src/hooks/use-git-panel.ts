import { useCallback, useEffect, useRef, useState } from "react";
import { try_action, to_view_status, active_worktree_path } from "@/lib/git";
import type { GitStatus } from "@/lib/git-status";

export type RepoState =
  | { kind: "loading" }
  | { kind: "no_repo" }
  | { kind: "ready"; status: GitStatus };

export function use_git_panel() {
  const [state, set_state] = useState<RepoState>({ kind: "loading" });
  const [switching, set_switching] = useState(false);
  const refresh_id = useRef(0);
  const cache = useRef(new Map<string, RepoState>());

  const cache_when_resolved = useCallback((key: Promise<string | undefined>, value: RepoState) => {
    void key.then((k) => {
      if (k) cache.current.set(k, value);
    });
  }, []);

  const refresh = useCallback(
    async (force = true) => {
      const id = ++refresh_id.current;
      const current = () => refresh_id.current === id;
      const key = active_worktree_path();
      let next: RepoState;
      try {
        next = { kind: "ready", status: to_view_status(await muxy.git.status({ fresh: force })) };
      } catch {
        next = { kind: "no_repo" };
      }
      cache_when_resolved(key, next);
      if (current()) {
        set_state(next);
        set_switching(false);
      }
    },
    [cache_when_resolved],
  );

  const switch_scope = useCallback(async () => {
    const id = ++refresh_id.current;
    const current = () => refresh_id.current === id;
    const key = active_worktree_path();

    set_state({ kind: "loading" });
    set_switching(true);

    void key.then((k) => {
      const cached = k ? cache.current.get(k) : undefined;
      if (cached && current()) {
        set_state(cached);
        set_switching(false);
      }
    });

    let next: RepoState;
    try {
      next = { kind: "ready", status: to_view_status(await muxy.git.status()) };
    } catch {
      next = { kind: "no_repo" };
    }
    cache_when_resolved(key, next);
    if (current()) {
      set_state(next);
      set_switching(false);
    }
  }, [cache_when_resolved]);

  const reconcile_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcile = useCallback(() => {
    if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    reconcile_timer.current = setTimeout(async () => {
      reconcile_timer.current = null;
      const id = ++refresh_id.current;
      const key = active_worktree_path();
      let next: RepoState;
      try {
        const [cwd, status] = await Promise.all([
          key,
          muxy.git.status({ local: true }).then(to_view_status),
        ]);
        const prev = cwd ? cache.current.get(cwd) : undefined;
        if (prev?.kind === "ready" && prev.status.branch === status.branch) {
          status.pullRequest = prev.status.pullRequest;
          status.defaultBranch = prev.status.defaultBranch;
        } else if (prev?.kind === "ready") {
          void refresh();
          return;
        }
        next = { kind: "ready", status };
      } catch {
        next = { kind: "no_repo" };
      }
      if (refresh_id.current !== id) return;
      cache_when_resolved(key, next);
      set_state(next);
    }, 250);
  }, [refresh, cache_when_resolved]);

  const move_entry = useCallback(
    (path: string, from: "staged" | "unstaged", to: "staged" | "unstaged") => {
      set_state((prev) => {
        if (prev.kind !== "ready") return prev;
        const src = prev.status[from];
        const entry = src.find((e) => e.path === path);
        if (!entry) return prev;
        const moved =
          to === "staged"
            ? { ...entry, label: entry.label === "?" ? "A" : entry.label }
            : entry;
        return {
          kind: "ready",
          status: {
            ...prev.status,
            [from]: src.filter((e) => e.path !== path),
            [to]: [...prev.status[to], moved].sort((a, b) => a.path.localeCompare(b.path)),
          },
        };
      });
    },
    [],
  );

  const stage = useCallback(
    async (path: string) => {
      move_entry(path, "unstaged", "staged");
      const ok = await try_action(() => muxy.git.stage({ paths: [path] }), "Could not stage file");
      if (ok) reconcile();
      else void refresh();
      return ok;
    },
    [move_entry, reconcile, refresh],
  );

  const unstage = useCallback(
    async (path: string) => {
      move_entry(path, "staged", "unstaged");
      const ok = await try_action(() => muxy.git.unstage({ paths: [path] }), "Could not unstage file");
      if (ok) reconcile();
      else void refresh();
      return ok;
    },
    [move_entry, reconcile, refresh],
  );

  const discard = useCallback(
    async (path: string) => {
      const entry =
        state.kind === "ready" ? state.status.unstaged.find((e) => e.path === path) : undefined;
      const untracked = entry?.label === "?";
      const ok = await try_action(
        () =>
          muxy.git.discard(untracked ? { untrackedPaths: [path] } : { paths: [path] }),
        "Could not discard file",
      );
      await refresh();
      return ok;
    },
    [state, refresh],
  );

  const discard_all = useCallback(async () => {
    if (state.kind !== "ready") return false;
    const paths = state.status.unstaged.filter((e) => e.label !== "?").map((e) => e.path);
    const untrackedPaths = state.status.unstaged.filter((e) => e.label === "?").map((e) => e.path);
    const ok = await try_action(
      () => muxy.git.discard({ paths, untrackedPaths }),
      "Could not discard changes",
    );
    await refresh();
    return ok;
  }, [state, refresh]);

  const stage_all = useCallback(async () => {
    const ok = await try_action(() => muxy.git.stage({ paths: [] }), "Could not stage changes");
    await refresh();
    return ok;
  }, [refresh]);

  const unstage_all = useCallback(async () => {
    const ok = await try_action(() => muxy.git.unstage({ paths: [] }), "Could not unstage changes");
    await refresh();
    return ok;
  }, [refresh]);

  const commit = useCallback(
    async (message: string) => {
      const ok = await try_action(() => muxy.git.commit({ message }), "Commit failed");
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  const sync = useCallback(
    async (op: "push" | "pull") => {
      const ok = await try_action(
        () => (op === "push" ? muxy.git.push() : muxy.git.pull()),
        op === "push" ? "Push failed" : "Pull failed",
      );
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  const initial_load = useCallback(async () => {
    const id = ++refresh_id.current;
    const key = active_worktree_path();
    try {
      const status = to_view_status(await muxy.git.status({ local: true }));
      if (refresh_id.current === id) {
        const next: RepoState = { kind: "ready", status };
        cache_when_resolved(key, next);
        set_state(next);
      }
    } catch {
      /* fall through to full refresh */
    }
    void refresh(false);
  }, [refresh, cache_when_resolved]);

  useEffect(() => {
    void initial_load();
    const off_project = muxy.events.subscribe("project.switched", () => void switch_scope());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void switch_scope());
    const off_file = muxy.events.subscribe("file.changed", () => reconcile());
    return () => {
      off_project?.();
      off_worktree?.();
      off_file?.();
      if (reconcile_timer.current) clearTimeout(reconcile_timer.current);
    };
  }, [initial_load, switch_scope, reconcile]);

  return {
    state,
    switching,
    refresh,
    stage,
    unstage,
    stage_all,
    unstage_all,
    discard,
    discard_all,
    commit,
    sync,
  };
}
