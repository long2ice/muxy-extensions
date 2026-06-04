import { ExternalLink, GitMerge, Loader2, Trash2, XCircle } from "lucide-react";
import { confirm_action, open_url } from "@/lib/git";
import { pr_state, type MergeMethod } from "@/lib/git-prs";
import { PrStateIcon } from "./pr-state-icon";

export type PrAction = MergeMethod | "close" | "cleanup";

interface CurrentPrContentProps {
  pr: MuxyGitPR;
  branch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
  pending: PrAction | null;
  refreshing?: boolean;
  onMerge: (method: MergeMethod, deleteBranch: boolean) => Promise<boolean>;
  onClose: (number: number) => Promise<boolean>;
  onCleanup: () => Promise<boolean>;
  onDone?: () => void;
}

export function CurrentPrContent({
  pr,
  branch,
  defaultBranch,
  dirty,
  pending,
  refreshing,
  onMerge,
  onClose,
  onCleanup,
  onDone,
}: CurrentPrContentProps) {
  const busy = pending !== null;

  async function run(action: Promise<boolean>) {
    const ok = await action;
    if (ok) onDone?.();
  }

  async function confirm_close() {
    const ok = await confirm_action({
      title: `Close PR #${pr.number}?`,
      message: `This closes pull request #${pr.number} without merging it.`,
      confirmLabel: "Close PR",
    });
    if (ok) void run(onClose(pr.number));
  }

  async function confirm_cleanup() {
    const ok = await confirm_action({
      title: `Clean up branch "${branch}"?`,
      message: `This switches to ${defaultBranch ?? "the default branch"} and deletes branch "${
        branch ?? ""
      }".${dirty ? " Uncommitted changes will no longer belong to any branch." : ""}`,
      confirmLabel: "Clean Up",
      critical: dirty,
    });
    if (ok) void run(onCleanup());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <PrStateIcon pr={pr} size={13} />
        <span className="font-mono text-[12px] font-semibold text-foreground">#{pr.number}</span>
        <span className="text-[11px] text-muted-foreground">{state_label(pr)}</span>
        {refreshing && (
          <Loader2 size={11} className="animate-spin text-muted-foreground" aria-label="Refreshing" />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction
            icon={XCircle}
            title="Close PR"
            disabled={busy || pr_state(pr) !== "open"}
            loading={pending === "close"}
            tone="danger"
            onClick={() => void confirm_close()}
          />
          <IconAction
            icon={Trash2}
            title="Clean up branch"
            disabled={busy || !branch}
            loading={pending === "cleanup"}
            onClick={() => void confirm_cleanup()}
          />
          <IconAction icon={ExternalLink} title="View on GitHub" onClick={() => open_url(pr.url)} />
        </div>
      </div>
      <Row label="Base" value={pr.baseBranch} />
      <Row label="Mergeable" value={mergeable_label(pr)} tone={mergeable_tone(pr)} />
      <ChecksRow checks={pr.checks} />

      <Actions pr={pr} pending={pending} onMerge={(method) => void run(onMerge(method, true))} />
    </div>
  );
}

function IconAction({
  icon: Icon,
  title,
  disabled,
  loading,
  tone = "default",
  onClick,
}: {
  icon: typeof XCircle;
  title: string;
  disabled?: boolean;
  loading?: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  const hover = tone === "danger" ? "hover:text-diff-remove" : "hover:text-foreground";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40 ${hover}`}
    >
      {loading ? (
        <Loader2 size={13} strokeWidth={2} className="animate-spin" />
      ) : (
        <Icon size={13} strokeWidth={2} />
      )}
    </button>
  );
}

function Actions({
  pr,
  pending,
  onMerge,
}: {
  pr: MuxyGitPR;
  pending: PrAction | null;
  onMerge: (method: MergeMethod) => void;
}) {
  const state = pr_state(pr);
  if (state !== "open") {
    return (
      <span className="mt-1 flex h-7 items-center justify-center rounded-md border border-border text-[11px] text-muted-foreground">
        This PR is {state}.
      </span>
    );
  }

  const blockedReason = merge_blocked_reason(pr);
  const busy = pending !== null;
  const merge = (method: MergeMethod, label: string) => (
    <MergeButton
      label={label}
      disabled={!!blockedReason || busy}
      loading={pending === method}
      onClick={() => onMerge(method)}
    />
  );
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {merge("merge", "Merge commit")}
      {merge("squash", "Squash & merge")}
      {merge("rebase", "Rebase & merge")}
      {blockedReason && (
        <span className="text-center text-[10px] text-muted-foreground">{blockedReason}</span>
      )}
    </div>
  );
}

function merge_blocked_reason(pr: MuxyGitPR): string | null {
  if (pr.isDraft) return "Draft PRs can't be merged.";
  if (pr.mergeable === false || pr.mergeStateStatus === "DIRTY") return "Has merge conflicts.";
  if (pr.mergeStateStatus === "BLOCKED") return "Merge is blocked by branch rules.";
  if (pr.mergeStateStatus === "BEHIND") return "Branch is behind the base.";
  return null;
}

function MergeButton({
  label,
  disabled,
  loading,
  onClick,
}: {
  label: string;
  disabled: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-muted text-[11px] font-medium text-foreground outline-none transition-colors hover:border-primary hover:bg-accent disabled:pointer-events-none ${loading ? "" : "disabled:opacity-50"}`}
    >
      {loading ? (
        <Loader2 size={12} strokeWidth={2} className="animate-spin" />
      ) : (
        <GitMerge size={12} strokeWidth={2} />
      )}
      {label}
    </button>
  );
}

function ChecksRow({ checks }: { checks: MuxyGitPRChecks }) {
  if (checks.status === "none" && checks.total === 0) return <Row label="Checks" value="—" />;
  const parts = [
    checks.passing > 0 && `${checks.passing} passing`,
    checks.failing > 0 && `${checks.failing} failing`,
    checks.pending > 0 && `${checks.pending} running`,
  ].filter(Boolean) as string[];
  const tone: Tone =
    checks.failing > 0 ? "negative" : checks.pending > 0 ? "default" : checks.passing > 0 ? "positive" : "default";
  return <Row label="Checks" value={parts.join(" · ") || "—"} tone={tone} />;
}

type Tone = "positive" | "negative" | "muted" | "default";

function Row({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  const color =
    tone === "positive"
      ? "text-diff-add"
      : tone === "negative"
        ? "text-diff-remove"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={`truncate font-mono text-[11px] font-medium ${color}`}>{value}</span>
    </div>
  );
}

function state_label(pr: MuxyGitPR): string {
  const state = pr_state(pr);
  if (state === "open") return pr.isDraft ? "Draft · Open" : "Open";
  if (state === "merged") return "Merged";
  return "Closed";
}

function mergeable_label(pr: MuxyGitPR): string {
  if (pr.mergeable === false) return "Conflicts";
  switch (pr.mergeStateStatus) {
    case "DIRTY":
      return "Conflicts";
    case "BEHIND":
      return "Behind base";
    case "BLOCKED":
      return "Blocked";
    case "DRAFT":
      return "Draft";
    default:
      break;
  }
  if (pr.checks.failing > 0) return "Yes (checks failing)";
  if (pr.checks.pending > 0) return "Yes (checks running)";
  return "Yes";
}

function mergeable_tone(pr: MuxyGitPR): Tone {
  if (pr.mergeable === false) return "negative";
  switch (pr.mergeStateStatus) {
    case "DIRTY":
    case "BEHIND":
    case "BLOCKED":
      return "negative";
    case "DRAFT":
      return "muted";
    default:
      break;
  }
  if (pr.checks.failing > 0) return "negative";
  return "positive";
}
