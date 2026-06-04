import { useCallback } from "react";
import { alert_error } from "@/lib/git";
import { commit_all, has_pending_changes } from "@/lib/git-commit";
import { create_pr } from "@/lib/git-prs";

export interface CreatePrInput {
  title: string;
  body: string;
  baseBranch?: string;
  newBranch?: string;
  draft?: boolean;
}

export function use_create_pr(refreshGit: () => Promise<void>) {
  return useCallback(
    async (input: CreatePrInput) => {
      try {
        if (input.newBranch) {
          await muxy.git.branch.create({ name: input.newBranch });
        }

        if (await has_pending_changes()) {
          const committed = await commit_all(input.title);
          if (!committed) return false;
        }

        await muxy.git.push({ setUpstream: true });

        await create_pr(input.title, input.body, input.baseBranch, input.draft ?? false);
        await refreshGit();
        return true;
      } catch (err) {
        await alert_error("Could not create pull request", err);
        return false;
      }
    },
    [refreshGit],
  );
}
