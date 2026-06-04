import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, Loader2 } from "lucide-react";
import { alert_error } from "@/lib/git";
import { cleanup_branch, remove_worktree_or_branch } from "@/lib/git-cleanup";
import { merge_pr, close_pr, fetch_resolved_status, type MergeMethod } from "@/lib/git-prs";
import { read_pr_cache, write_pr_cache, clear_pr_cache } from "@/lib/pr-cache";
import { CurrentPrContent, type PrAction } from "@/components/current-pr-content";

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; pr: MuxyGitPR; branch: string | null; defaultBranch: string | null; dirty: boolean };

export function PrInfoPanel() {
  const [state, set_state] = useState<State>({ kind: "loading" });
  const [pending, set_pending] = useState<PrAction | null>(null);
  const [refreshing, set_refreshing] = useState(false);

  const load = useCallback(async () => {
    const cached = await read_pr_cache();
    if (cached) set_state({ kind: "ready", ...cached });

    set_refreshing(true);
    try {
      const s = await fetch_resolved_status(true);
      if (s.pullRequest) {
        const info = {
          pr: s.pullRequest,
          branch: s.branch || null,
          defaultBranch: s.defaultBranch,
          dirty: s.stagedFiles.length > 0 || s.unstagedFiles.length > 0,
        };
        await write_pr_cache(info);
        set_state({ kind: "ready", ...info });
      } else {
        await clear_pr_cache();
        set_state({ kind: "none" });
      }
    } catch {
      if (!cached) set_state({ kind: "none" });
    } finally {
      set_refreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const off_project = muxy.events.subscribe("project.switched", () => void load());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void load());
    return () => {
      off_project?.();
      off_worktree?.();
    };
  }, [load]);

  const merge = useCallback(async (number: number, method: MergeMethod, deleteBranch: boolean) => {
    set_pending(method);
    try {
      await merge_pr(number, method, false);
    } catch (err) {
      await alert_error(`Could not merge PR #${number}`, err);
      set_pending(null);
      return false;
    }
    try {
      if (deleteBranch && state.kind === "ready") {
        await remove_worktree_or_branch({
          branch: state.branch,
          defaultBranch: state.defaultBranch,
          dirty: false,
        });
      }
    } catch (err) {
      await alert_error(`PR #${number} merged, but branch cleanup failed`, err);
    } finally {
      await clear_pr_cache();
      set_pending(null);
    }
    return true;
  }, [state]);

  const close = useCallback(async (number: number) => {
    set_pending("close");
    try {
      await close_pr(number);
      await clear_pr_cache();
      return true;
    } catch (err) {
      await alert_error(`Could not close PR #${number}`, err);
      return false;
    } finally {
      set_pending(null);
    }
  }, []);

  const cleanup = useCallback(async () => {
    if (state.kind !== "ready") return false;
    set_pending("cleanup");
    try {
      const ok = await cleanup_branch({
        branch: state.branch,
        defaultBranch: state.defaultBranch,
        dirty: state.dirty,
      });
      if (ok) await clear_pr_cache();
      return ok;
    } finally {
      set_pending(null);
    }
  }, [state]);

  return (
    <div className="flex min-h-[13rem] w-72 flex-col p-3 text-popover-foreground">
      {state.kind === "loading" ? (
        <span className="flex flex-1 items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </span>
      ) : state.kind === "none" ? (
        <span className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <GitPullRequest size={18} strokeWidth={1.5} />
          No pull request for this branch.
        </span>
      ) : (
        <CurrentPrContent
          pr={state.pr}
          branch={state.branch}
          defaultBranch={state.defaultBranch}
          dirty={state.dirty}
          pending={pending}
          refreshing={refreshing}
          onMerge={(method, deleteBranch) => merge(state.pr.number, method, deleteBranch)}
          onClose={close}
          onCleanup={cleanup}
          onDone={() => void muxy.popover.close()}
        />
      )}
    </div>
  );
}
