import { active_worktree_path, alert_error } from "@/lib/git";

async function pull_quietly(project: string | undefined): Promise<void> {
  await muxy.git.pull({ project }).catch(() => undefined);
}

interface CleanupTarget {
  branch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
}

export async function active_project_path(): Promise<string | undefined> {
  const projects = await muxy.projects.list().catch(() => [] as MuxyProject[]);
  const fromProjects = projects.find((p) => p.isActive)?.path ?? projects[0]?.path;
  if (fromProjects) return fromProjects;
  const active = await active_worktree();
  return active?.path ?? (await active_worktree_path());
}

export async function active_worktree(project?: string): Promise<MuxyWorktree | undefined> {
  const worktrees = await muxy.worktrees.list(project).catch(() => [] as MuxyWorktree[]);
  const info = await muxy.git.repoInfo({ project }).catch(() => null);
  const toplevel = info?.root;
  return (
    (toplevel ? worktrees.find((w) => w.path === toplevel) : undefined) ??
    worktrees.find((w) => w.isActive) ??
    worktrees.find((w) => w.isPrimary)
  );
}

export async function is_on_worktree(project?: string): Promise<boolean> {
  const info = await muxy.git.repoInfo({ project }).catch(() => null);
  if (info) return info.isWorktree;

  const active = await active_worktree(project);
  return !!active && !active.isPrimary;
}

export async function remove_active_worktree(
  branch: string | null,
  force: boolean,
  project: string | undefined,
): Promise<void> {
  const worktrees = await muxy.worktrees.list(project).catch(() => [] as MuxyWorktree[]);
  const active = await active_worktree(project);
  if (!active || active.isPrimary) {
    throw new Error("No active worktree to remove.");
  }

  const replacement =
    worktrees.find((w) => w.isPrimary && w.id !== active.id) ??
    worktrees.find((w) => w.id !== active.id);
  if (replacement) {
    await muxy.git.worktree
      .switchTo({ project, identifier: replacement.path })
      .catch(() => muxy.worktrees.switchTo(replacement.path, project));
  }
  await muxy.git.worktree.remove({ project, path: active.path, force });
  if (branch) await muxy.git.branch.deleteRemote({ project, branch }).catch(() => undefined);
  if (replacement) await pull_quietly(project);
  await muxy.worktrees.refresh(project);
}

export async function remove_worktree_or_branch({
  branch,
  defaultBranch,
  dirty,
}: CleanupTarget): Promise<void> {
  const project = await active_project_path();

  if (await is_on_worktree(project)) {
    await remove_active_worktree(branch, dirty, project);
    return;
  }

  if (!branch) {
    throw new Error("No branch to clean up.");
  }
  if (branch === defaultBranch) {
    throw new Error(`"${branch}" is the default branch and won't be deleted.`);
  }

  const target = defaultBranch ?? "main";

  await muxy.git.branch.switchTo({ project, branch: target });

  const { currentBranch } = await muxy.git.repoInfo({ project });
  if (currentBranch === branch) {
    throw new Error(`Still on "${branch}" after switching to ${target}.`);
  }

  await muxy.git.branch.delete({ project, name: branch, force: true });

  await muxy.git.branch.deleteRemote({ project, branch }).catch(() => undefined);
  await pull_quietly(project);
  await muxy.worktrees.refresh(project);
}

export async function cleanup_branch(target: CleanupTarget): Promise<boolean> {
  if (!target.branch) return false;
  try {
    await remove_worktree_or_branch(target);
    return true;
  } catch (err) {
    await alert_error("Cleanup failed", err);
    return false;
  }
}
