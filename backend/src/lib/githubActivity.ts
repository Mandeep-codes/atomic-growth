import { env } from "./env";

// ─────────────────────────────────────────────────────────────────────────
// Dev Overlook — code activity
//
// The audit_log triggers cover changes made straight to the DATABASE. They
// say nothing about changes made through CODE, which is how a developer
// actually changes what the platform does to people's money. A migration
// that rewrites a balance, or a one-line edit to the payout cron, leaves no
// audit_log row at all until it runs in production.
//
// So this reads the other half from GitHub: commits, pull requests, and PR
// reviews per person. Nothing is stored locally — GitHub is already the
// durable record, and copying it into our DB would only add a second thing
// that can be wrong or stale.
// ─────────────────────────────────────────────────────────────────────────

// GitHub login → the name we actually call them. Add a row per person who
// gets repo access; anyone NOT in here still shows up (we never hide an
// author), they just appear under their raw GitHub login.
export const TRACKED_DEVELOPERS: Record<string, string> = {
  "Argon-py": "deepak",
  achuthhhh: "achuth",
  "pranav-atomik": "pranav",
  enjoitheburger: "sebastian",
  sebruiz: "sebruiz",
};

export const displayNameForLogin = (login: string): string =>
  TRACKED_DEVELOPERS[login] ?? login;

export interface CodeActivityItem {
  kind: "commit" | "pull_request" | "review";
  id: string;
  login: string;
  displayName: string;
  title: string;
  url: string;
  ts: string;
  // Commits only — how much of the codebase this actually moved.
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  // Which files. Truncated by GitHub on very large commits; we say so.
  files?: string[];
  // PRs only.
  state?: string;
  merged?: boolean;
  branch?: string;
  // True when the change touches a path we consider money-critical.
  touchesMoney: boolean;
}

// Paths where a mistake costs real money. A change here is highlighted in the
// panel so it can't scroll past unnoticed. Kept deliberately broad: better to
// over-flag than to let a payout edit look routine.
const MONEY_PATH_PATTERNS = [
  "revokeSubmissionReward",
  "reverseClawback",
  "createReward",
  "createCampaignViewRewards",
  "updateViewCounts",
  "banPurge",
  "wise",
  "cryptoPayouts",
  "balance",
  "withdraw",
  "payout",
  "rewards/",
  "invoice",
  "drizzle/", // migrations run automatically on deploy
  "restoreDeletedSubmission",
  "noncampaignCascade",
  "redemptionLedger",
];

export const pathTouchesMoney = (path: string): boolean => {
  const lower = path.toLowerCase();
  return MONEY_PATH_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
};

export const isGithubConfigured = (): boolean => Boolean(env.GITHUB_TOKEN);

const gh = async <T>(path: string): Promise<T> => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "atomik-clips-dev-overlook",
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub ${path} failed: ${res.status} ${await res.text().catch(() => "")}`
    );
  }
  return (await res.json()) as T;
};

type ApiCommitListItem = {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string } | null;
  html_url: string;
};

type ApiCommitDetail = {
  sha: string;
  stats?: { additions: number; deletions: number };
  files?: { filename: string }[];
};

type ApiPull = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  user: { login: string } | null;
  head: { ref: string };
};

// Commits on the default branch, newest first, optionally narrowed to one
// author. `detail` fetches per-commit stats + file lists, which costs one API
// call each — capped so a wide window can't burn the hourly rate limit.
export const fetchCommits = async (opts: {
  login?: string;
  limit: number;
  since?: string;
  detailLimit?: number;
}): Promise<CodeActivityItem[]> => {
  const params = new URLSearchParams({
    per_page: String(Math.min(opts.limit, 100)),
  });
  if (opts.login) params.set("author", opts.login);
  if (opts.since) params.set("since", opts.since);

  const list = await gh<ApiCommitListItem[]>(
    `/repos/${env.GITHUB_REPO}/commits?${params.toString()}`
  );

  const detailLimit = opts.detailLimit ?? 25;
  const items: CodeActivityItem[] = [];

  for (const [index, c] of list.entries()) {
    const login = c.author?.login ?? c.commit.author.name;
    let detail: ApiCommitDetail | null = null;
    // Only the most recent N get the extra round trip; older rows still show
    // author/message/time, just without the diff size.
    if (index < detailLimit) {
      try {
        detail = await gh<ApiCommitDetail>(
          `/repos/${env.GITHUB_REPO}/commits/${c.sha}`
        );
      } catch {
        detail = null;
      }
    }
    const files = detail?.files?.map((f) => f.filename) ?? [];
    items.push({
      kind: "commit",
      id: c.sha,
      login,
      displayName: displayNameForLogin(login),
      // An empty commit message is legal in git, so the first line can be
      // undefined under noUncheckedIndexedAccess.
      title: c.commit.message.split("\n")[0] ?? "(no commit message)",
      url: c.html_url,
      ts: c.commit.author.date,
      additions: detail?.stats?.additions,
      deletions: detail?.stats?.deletions,
      changedFiles: files.length || undefined,
      files: files.slice(0, 40),
      touchesMoney: files.some(pathTouchesMoney),
    });
  }

  return items;
};

// Pull requests they opened, in any state.
export const fetchPullRequests = async (opts: {
  login?: string;
  limit: number;
}): Promise<CodeActivityItem[]> => {
  const list = await gh<ApiPull[]>(
    `/repos/${env.GITHUB_REPO}/pulls?state=all&sort=updated&direction=desc&per_page=${Math.min(
      opts.limit,
      100
    )}`
  );
  return list
    .filter((p) => !opts.login || p.user?.login === opts.login)
    .map((p) => {
      const login = p.user?.login ?? "unknown";
      return {
        kind: "pull_request" as const,
        id: `pr-${p.number}`,
        login,
        displayName: displayNameForLogin(login),
        title: `#${p.number} ${p.title}`,
        url: p.html_url,
        ts: p.merged_at ?? p.created_at,
        state: p.state,
        merged: Boolean(p.merged_at),
        branch: p.head?.ref,
        // A PR's own file list needs another call; the commits feed already
        // carries the money flag, so we don't double-spend rate limit here.
        touchesMoney: false,
      };
    });
};
