import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, Loader2, RefreshCw } from "lucide-react";
import { alert_error, confirm_action } from "@/lib/git";
import { close_pr } from "@/lib/git-prs";
import { checkout_pr, checkout_pr_worktree } from "@/lib/pr-checkout";
import { use_persistent_value } from "@/hooks/use-persistent-value";
import { PrFilterTabs, type PrFilter } from "@/components/pr-filter-tabs";
import { PrRow } from "@/components/pr-row";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; prs: MuxyGitPRListItem[] };

export function PullRequestsPanel() {
  const [filter, set_filter] = use_persistent_value<PrFilter>("muxy.git.prs.filter", "open");
  const [state, set_state] = useState<State>({ kind: "loading" });
  const [refreshing, set_refreshing] = useState(false);

  const load = useCallback(
    async (showSpinner: boolean, fresh = false) => {
      if (showSpinner) set_state({ kind: "loading" });
      set_refreshing(true);
      try {
        const prs = await muxy.git.pr.list({ filter, limit: 50, fresh });
        set_state({ kind: "ready", prs });
      } catch (err) {
        set_state({ kind: "error", message: error_text(err) });
      } finally {
        set_refreshing(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const refresh = () => void load(false);
    const off_project = muxy.events.subscribe("project.switched", refresh);
    const off_worktree = muxy.events.subscribe("worktree.switched", refresh);
    return () => {
      off_project?.();
      off_worktree?.();
    };
  }, [load]);

  const checkout = useCallback(
    async (number: number) => {
      const ok = await confirm_action({
        title: `Checkout PR #${number}?`,
        message: `This checks out the branch for pull request #${number} in the current worktree.`,
        confirmLabel: "Checkout",
      });
      if (!ok) return;
      try {
        await checkout_pr(number);
        await muxy.worktrees.refresh().catch(() => undefined);
        await muxy.toast({ body: `Checked out PR #${number}`, variant: "success" });
      } catch (err) {
        await alert_error(`Could not checkout PR #${number}`, err);
      }
    },
    [],
  );

  const checkout_worktree = useCallback(async (number: number) => {
    const ok = await confirm_action({
      title: `Checkout PR #${number} to worktree?`,
      message: `This creates a new worktree for pull request #${number} and switches to it.`,
      confirmLabel: "Continue",
    });
    if (!ok) return;
    try {
      const branch = await checkout_pr_worktree(number);
      if (branch) await muxy.toast({ body: `PR #${number} in worktree (${branch})`, variant: "success" });
    } catch (err) {
      await alert_error(`Could not create worktree for PR #${number}`, err);
    }
  }, []);

  const close = useCallback(
    async (number: number) => {
      const ok = await confirm_action({
        title: `Close PR #${number}?`,
        message: `This closes pull request #${number} without merging it.`,
        confirmLabel: "Close PR",
      });
      if (!ok) return;
      try {
        await close_pr(number);
        await load(false, true);
      } catch (err) {
        await alert_error(`Could not close PR #${number}`, err);
      }
    },
    [load],
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 px-3 py-2">
        <GitPullRequest size={14} strokeWidth={2} className="text-foreground" />
        <h1 className="text-[12px] font-semibold">Pull Requests</h1>
        <button
          type="button"
          title="Refresh"
          onClick={() => void load(false, true)}
          disabled={refreshing}
          className="ml-auto flex size-6 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RefreshCw size={13} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
        </button>
      </header>

      <PrFilterTabs value={filter} onChange={set_filter} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.kind === "loading" ? (
          <Centered>
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </Centered>
        ) : state.kind === "error" ? (
          <Centered>
            <span className="max-w-[80%] text-center">{state.message}</span>
          </Centered>
        ) : state.prs.length === 0 ? (
          <Centered>
            <GitPullRequest size={20} strokeWidth={1.5} />
            No {filter === "all" ? "" : filter} pull requests.
          </Centered>
        ) : (
          <ul>
            {state.prs.map((pr) => (
              <PrRow
                key={pr.number}
                pr={pr}
                onCheckout={checkout}
                onCheckoutWorktree={checkout_worktree}
                onClose={close}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

function error_text(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.trim() || "Could not load pull requests.";
}
