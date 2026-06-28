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
    `3. Fix the code for the comments you're addressing. Build/verify if the project supports it.`,
    `4. Commit and push the fixes with \`commit_and_update\`.`,
    `5. Reply to each addressed thread with \`reply_to_review_comment\` (use the comment id from step 1), briefly noting what you changed and referencing the fix.`,
    `6. Post an overall summary of the fixes as a PR comment with \`comment_issue\` (pass the PR number — PRs accept issue comments).`,
    `7. For each addressed thread, call \`resolve_review_thread\` with its thread id. It respects \`OKFFS_RESOLVE_THREADS\`: threads are only actually resolved when that env var is enabled, otherwise they're left for the user to resolve.`,
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
