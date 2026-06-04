import { try_action } from "@/lib/git";

export async function has_pending_changes(): Promise<boolean> {
  const s = await muxy.git.status({ local: true }).catch(() => null);
  if (!s) return false;
  return s.stagedFiles.length > 0 || s.unstagedFiles.length > 0;
}

export async function commit_all(message: string): Promise<boolean> {
  return try_action(
    () => muxy.git.commit({ message, stageAll: true }),
    "Could not commit changes",
  );
}
