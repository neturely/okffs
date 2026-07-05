export const name = "address_pr_review";

export const description =
  "Read a pull request's review comments, fix the valid ones, reply to each, and post a summary.";

export const argumentDefs = [
  {
    name: "pr_number",
    description: "The pull request number to address review comments for",
    required: true,
  },
];

export function build(args: Record<string, string | undefined>) {
  const pr = args.pr_number ?? "<pr_number>";
  const text = [
    `Address the review feedback on PR #${pr}. Work through these steps:`,
    ``,
    `1. Call \`list_pr_review_comments\` for PR #${pr} to read the inline threads and review summaries.`,
    `2. Triage: decide which comments are valid and in scope. Use your judgment — you don't have to act on every comment, but explain any you intentionally skip.`,
    `3. Work out WHERE the fixes must land. Normally you commit them straight onto the reviewed PR's own head branch. But if that head is a long-lived, protected integration branch you can't push to directly — the typical case being a promotion / release-gate PR (e.g. \`develop → main\`, head \`develop\`) — \`commit_and_update\` can't push there, so fixes must route through a follow-up PR into the head branch.`,
    `4. Fix the code (build/verify if the project supports it):`,
    `   - Normal PR (head is a feature branch): fix on the head branch, then \`commit_and_update\` to commit + push.`,
    `   - Protected head (promotion/gate PR): create a follow-up issue with \`create_issue\` (it branches off the integration branch), check out that branch, fix there, \`commit_and_update\`, then \`create_pull_request\` to open a PR INTO the head branch — and then MERGE that follow-up PR so the reviewed PR's diff actually contains the fix. The follow-up PR merges into the integration branch (the head), which is allowed; NEVER merge into \`OKFFS_PROTECTED_BRANCH\` autonomously. Don't stop and leave a dangling PR for the user to babysit — complete the loop.`,
    `5. Reply to each addressed thread with \`reply_to_review_comment\` (use the comment id from step 1), briefly noting what you changed and referencing the fix (commit or follow-up PR).`,
    `6. Post an overall summary of the fixes as a PR comment with \`comment_issue\` (pass the PR number — PRs accept issue comments).`,
    `7. Resolve threads — but ONLY once the fix is actually present on the reviewed PR's branch: immediately after \`commit_and_update\` for a normal PR, or only AFTER the follow-up PR has merged into the head for a protected-head PR (resolving while the fix still sits in an unmerged PR is misleading). Then call \`resolve_review_thread\` with each thread id. It respects \`OKFFS_RESOLVE_THREADS\`: threads are only actually resolved when that env var is enabled (check it — don't assume), otherwise they're left for the user to resolve.`,
    ``,
    `Keep replies and the summary concise and specific about what changed.`,
  ].join("\n");

  return {
    description: `Address review feedback on PR #${pr}`,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
