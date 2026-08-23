import { useState } from "react";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";

type Row = {
  id: number;
  ts: string | Date;
  dbUser: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  tableName: string;
  rowId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
};

const TABLE_LABELS: Record<string, string> = {
  balances: "wallet balance",
  balance_entries: "money ledger",
  campaign_view_rewards: "reward record",
  wise_withdrawals: "Wise withdrawal",
  crypto_withdrawals: "crypto withdrawal",
  crypto_payout_batches: "crypto payout batch",
  crypto_payout_methods: "crypto wallet",
  wise_recipient: "BANK DETAILS",
  bank_accounts: "BANK ACCOUNT",
  deleted_clip_reserves: "clawback reserve",
  campaigns: "campaign",
  submissions: "clip",
  user_roles: "admin role",
  banned_users: "user ban",
  banned_social_media_users: "handle ban",
  verified_users: "linked account",
  user_clerk: "user profile",
};

const money = (v: unknown) =>
  typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)))
    ? `$${Number(v).toFixed(2)}`
    : String(v);

const who = (
  data: Record<string, unknown> | null,
  usernames: Record<string, string>
) => {
  const uid = data?.["user_id"];
  if (typeof uid !== "string") return null;
  return usernames[uid] ? `@${usernames[uid]}` : `user ${uid}`;
};

// Turn one audit row into a plain-English sentence.
const describe = (row: Row, usernames: Record<string, string>): string => {
  const label = TABLE_LABELS[row.tableName] ?? row.tableName;
  const target = who(row.newData ?? row.oldData, usernames);
  const forWhom = target ? ` for ${target}` : "";

  if (row.action === "UPDATE" && row.oldData && row.newData) {
    const changes: string[] = [];
    for (const key of Object.keys(row.newData)) {
      const before = row.oldData[key];
      const after = row.newData[key];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const isMoney = ["balance", "totalEarned", "amount", "reward", "budget", "cpm", "achieved"].includes(key);
      changes.push(
        `${key}: ${isMoney ? money(before) : String(before)} → ${isMoney ? money(after) : String(after)}`
      );
    }
    if (changes.length === 0) return `touched a ${label}${forWhom} (no visible change)`;
    return `changed ${label}${forWhom} — ${changes.join(", ")}`;
  }

  if (row.action === "INSERT") {
    if (row.tableName === "balance_entries") {
      const amt = money(row.newData?.["amount"]);
      const memo = row.newData?.["memo"] ? ` ("${row.newData["memo"]}")` : "";
      return `added a ledger entry of ${amt}${forWhom}${memo}`;
    }
    return `created a new ${label}${forWhom}`;
  }

  // DELETE
  if (row.tableName === "balance_entries") {
    return `DELETED a ledger entry of ${money(row.oldData?.["amount"])}${forWhom}`;
  }
  return `DELETED a ${label}${forWhom}`;
};

// Code activity, per developer. A change to the codebase is the OTHER way
// someone changes what this platform does with money — and unlike a direct
// database edit, it leaves no audit_log row until it runs in production.
const CodeActivityPanel = () => {
  const [login, setLogin] = useState<string>("Argon-py");
  const [days, setDays] = useState(30);
  const [moneyOnly, setMoneyOnly] = useState(false);

  const activity = trpc.devOverlook.codeActivity.useQuery(
    { login: login || undefined, days, limit: 60 },
    { refetchOnWindowFocus: false }
  );

  const developers = activity.data?.developers ?? {};
  const items = (activity.data?.items ?? []).filter(
    (i) => !moneyOnly || i.touchesMoney
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-end justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Code changes</CardTitle>
          <CardDescription>
            Commits and pull requests on the platform repo. Read live from
            GitHub, so it is never out of date.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => activity.refetch()}
          disabled={activity.isFetching}
        >
          {activity.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Developer</Label>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={login === "" ? "default" : "outline"}
                onClick={() => setLogin("")}
              >
                Everyone
              </Button>
              {Object.entries(developers).map(([ghLogin, name]) => (
                <Button
                  key={ghLogin}
                  size="sm"
                  variant={login === ghLogin ? "default" : "outline"}
                  onClick={() => setLogin(ghLogin)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Window</Label>
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={days === d ? "default" : "outline"}
                  onClick={() => setDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Switch
              id="codeMoneyOnly"
              checked={moneyOnly}
              onCheckedChange={setMoneyOnly}
            />
            <Label htmlFor="codeMoneyOnly">Money code only</Label>
          </div>
        </div>

        {activity.data?.configured === false ? (
          <Alert variant="destructive">
            <AlertTitle>Not connected to GitHub</AlertTitle>
            <AlertDescription>
              Set GITHUB_TOKEN in the backend environment (a read-only token
              with repo scope). Until then this shows nothing — which is not
              the same as nobody having changed anything.
            </AlertDescription>
          </Alert>
        ) : activity.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No code changes from{" "}
            {login ? (developers[login] ?? login) : "anyone"} in the last {days}{" "}
            days.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={`rounded-lg border p-3 ${
                  item.touchesMoney ? "border-red-300 bg-red-50/50" : ""
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold">{item.displayName}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.kind === "pull_request" ? "PR" : item.kind}
                  </Badge>
                  {item.touchesMoney ? (
                    <Badge variant="destructive" className="text-[10px]">
                      money code
                    </Badge>
                  ) : null}
                  {item.merged ? (
                    <Badge variant="outline" className="text-[10px]">
                      merged
                    </Badge>
                  ) : null}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline decoration-dotted"
                  >
                    {item.title}
                  </a>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {new Date(item.ts).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  {item.additions !== undefined ? (
                    <span>
                      <span className="text-emerald-600">
                        +{item.additions}
                      </span>{" "}
                      <span className="text-red-600">-{item.deletions}</span>
                      {item.changedFiles
                        ? ` across ${item.changedFiles} file${
                            item.changedFiles === 1 ? "" : "s"
                          }`
                        : null}
                    </span>
                  ) : null}
                  {item.branch ? <span>branch {item.branch}</span> : null}
                  {item.files && item.files.length > 0 ? (
                    <details className="ml-auto">
                      <summary className="cursor-pointer">files</summary>
                      <ul className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">
                        {item.files.map((f) => (
                          <li
                            key={f}
                            className={
                              // Same rule the backend flags on, so the
                              // highlighted line explains the red border.
                              item.touchesMoney ? "" : undefined
                            }
                          >
                            {f}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

const AdminDevOverlook = () => {
  const [moneyOnly, setMoneyOnly] = useState(true);
  const [userFilter, setUserFilter] = useState("");

  const canView = trpc.devOverlook.canView.useQuery();
  const list = trpc.devOverlook.list.useQuery(
    { moneyOnly, dbUser: userFilter.trim() || undefined, limit: 300 },
    { enabled: canView.data?.allowed === true, refetchOnWindowFocus: false }
  );

  if (canView.isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!canView.data?.allowed) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-2xl px-6 py-16 text-center text-muted-foreground">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8" />
          This page does not exist for you.
        </div>
      </AppLayout>
    );
  }

  const rows = list.data?.rows ?? [];
  const usernames = list.data?.usernames ?? {};

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-bold">Dev Overlook</h1>
          <p className="text-sm text-muted-foreground">
            Two halves of the same question. <strong>Code changes</strong> is
            what someone shipped. <strong>Database changes</strong> is what
            someone did by hand, straight to the data, written by database
            triggers the moment it happens (the app's own traffic is filtered
            out).
          </p>
        </div>

        <CodeActivityPanel />

        <Card>
          <CardHeader className="flex flex-row items-end justify-between space-y-0">
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id="moneyOnly"
                  checked={moneyOnly}
                  onCheckedChange={setMoneyOnly}
                />
                <Label htmlFor="moneyOnly">Money-related only</Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor="userFilter" className="text-xs">
                  Filter by database user
                </Label>
                <Input
                  id="userFilter"
                  className="h-8 w-44"
                  placeholder="e.g. achuth"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => list.refetch()}
              disabled={list.isFetching}
            >
              {list.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              {rows.length} recorded actions{moneyOnly ? " (money tables)" : ""}.
              Newest first.
            </CardDescription>
            {list.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing recorded yet — no human database activity since the
                audit trail went live.
              </p>
            ) : (
              <ul className="space-y-3">
                {rows.map((row) => {
                  const [name, ip] = row.dbUser.split("@");
                  const sensitive =
                    row.tableName === "wise_recipient" ||
                    row.tableName === "bank_accounts" ||
                    row.tableName === "crypto_payout_methods" ||
                    row.action === "DELETE";
                  return (
                    <li
                      key={row.id}
                      className={`rounded-lg border p-3 ${
                        sensitive ? "border-red-300 bg-red-50/50" : ""
                      }`}
                    >
                      <p className="text-sm">
                        <span className="font-semibold">{name}</span>{" "}
                        <span className="text-muted-foreground">
                          (from {ip ?? "unknown IP"})
                        </span>{" "}
                        {describe(row as Row, usernames)}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {new Date(row.ts).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "medium",
                          })}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {row.action}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {row.tableName}
                        </Badge>
                        {row.rowId ? <span>row {row.rowId}</span> : null}
                        <details className="ml-auto">
                          <summary className="cursor-pointer">raw</summary>
                          <pre className="mt-1 max-h-48 max-w-xl overflow-auto rounded bg-muted p-2 text-[10px]">
                            {JSON.stringify(
                              { before: row.oldData, after: row.newData },
                              null,
                              1
                            )}
                          </pre>
                        </details>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminDevOverlook;
