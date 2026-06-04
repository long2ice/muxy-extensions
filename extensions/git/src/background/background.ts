let last_branch: string | null = null;

async function sync_items(fresh = false): Promise<void> {
  let currentBranch: string | null = null;
  try {
    currentBranch = (await muxy.git.repoInfo({ fresh })).currentBranch;
  } catch {
    currentBranch = null;
  }

  last_branch = currentBranch;

  if (!currentBranch) {
    muxy.statusbar.hide("branch");
    muxy.statusbar.hide("pr-info");
    return;
  }

  muxy.statusbar.set({ id: "branch", text: currentBranch, visible: true });

  let pr: number | null = null;
  try {
    pr = await muxy.git.pr.number({ fresh });
  } catch {
    pr = null;
  }
  if (pr) muxy.statusbar.set({ id: "pr-info", text: `#${pr}`, visible: true });
  else muxy.statusbar.hide("pr-info");
}

function is_ref_change(payload: unknown): boolean {
  const path = (payload as { path?: string } | null)?.path ?? "";
  return /\/\.git\/(HEAD|packed-refs|refs\/)/.test(path);
}

async function on_ref_change(payload: unknown): Promise<void> {
  if (!is_ref_change(payload)) return;
  let branch: string | null = null;
  try {
    branch = (await muxy.git.repoInfo({ fresh: true })).currentBranch;
  } catch {
    return;
  }
  if (branch !== last_branch) void sync_items(true);
}

void sync_items();
muxy.events.subscribe("project.switched", () => void sync_items(true));
muxy.events.subscribe("worktree.switched", () => void sync_items(true));
muxy.events.subscribe("file.changed", (payload) => void on_ref_change(payload));
