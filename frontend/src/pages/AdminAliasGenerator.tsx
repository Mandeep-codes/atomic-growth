import { useMemo, useState } from "react";
import { Loader2, Trash2, Copy, Check, Mail, Download } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const parseRecipients = (raw: string): string[] => [
  ...new Set(
    raw
      .split(/[\s,;]+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean)
  ),
];

const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export default function AdminAliasGenerator() {
  const { toast } = useToast();
  const [recipientsText, setRecipientsText] = useState("");
  const [count, setCount] = useState(1);
  const [tag, setTag] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const listQuery = trpc.modAliases.list.useQuery();

  const generateMutation = trpc.modAliases.generate.useMutation({
    onSuccess: (res) => {
      toast({
        title: `Created ${res.created.length} alias${res.created.length === 1 ? "" : "es"}`,
        description:
          res.failedCount > 0
            ? `${res.failedCount} failed to sync to ForwardEmail — still routed via catch-all.`
            : `Forwarding to ${res.recipients.join(", ")}.`,
        variant: res.failedCount > 0 ? "destructive" : undefined,
      });
      listQuery.refetch();
    },
    onError: (e) =>
      toast({
        title: "Couldn't generate",
        description: e.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = trpc.modAliases.delete.useMutation({
    onSuccess: (_res, vars) => {
      toast({ title: "Alias deleted" });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(vars.id);
        return next;
      });
      listQuery.refetch();
    },
    onError: (e) =>
      toast({
        title: "Couldn't delete",
        description: e.message,
        variant: "destructive",
      }),
  });

  const recipients = useMemo(
    () => parseRecipients(recipientsText),
    [recipientsText]
  );
  const invalid = recipients.filter((r) => !looksLikeEmail(r));
  const canSubmit =
    recipients.length > 0 &&
    invalid.length === 0 &&
    count >= 1 &&
    count <= 50 &&
    !generateMutation.isPending;

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  const aliases = listQuery.data ?? [];

  const allSelected =
    aliases.length > 0 && aliases.every((a) => selectedIds.has(a.id));
  // Ids can go stale when another admin/tab deletes a row; count only what a
  // CSV export would actually contain.
  const selectedCount = aliases.filter((a) => selectedIds.has(a.id)).length;

  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(aliases.map((a) => a.id)));

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const csvEscape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

  const exportCsv = () => {
    const rows = aliases.filter((a) => selectedIds.has(a.id));
    const lines = [
      "email,youtube_password,instagram_password,forwards_to,tag,created_at",
      ...rows.map((a) =>
        [
          a.email ?? "",
          a.youtubePassword ?? "",
          a.instagramPassword ?? "",
          a.recipients ?? "",
          a.tag ?? "",
          a.createdAt ? new Date(a.createdAt).toISOString() : "",
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `forwarding-aliases-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6" /> Forwarding Alias Generator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Spin up forwarding addresses across our domain pool. Mail sent to
            each generated address is forwarded to the recipient(s) you choose.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Generate</CardTitle>
            <CardDescription>
              Enter one or more recipient emails (comma, space, or newline
              separated) and how many aliases to create.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recipients">Forward to</Label>
              <Textarea
                id="recipients"
                placeholder="you@example.com, teammate@example.com"
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                rows={3}
              />
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {recipients.map((r) => (
                    <Badge
                      key={r}
                      variant={looksLikeEmail(r) ? "secondary" : "destructive"}
                    >
                      {r}
                    </Badge>
                  ))}
                </div>
              )}
              {invalid.length > 0 && (
                <p className="text-xs text-destructive">
                  Not a valid email: {invalid.join(", ")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="space-y-2 max-w-[160px]">
                <Label htmlFor="count">How many</Label>
                <Input
                  id="count"
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) =>
                    setCount(
                      Math.max(1, Math.min(50, Number(e.target.value) || 1))
                    )
                  }
                />
              </div>

              <div className="space-y-2 max-w-[280px] flex-1">
                <Label htmlFor="tag">Tag (optional)</Label>
                <Input
                  id="tag"
                  maxLength={100}
                  placeholder="e.g. client X drop, July batch"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                />
              </div>
            </div>

            <Button
              disabled={!canSubmit}
              onClick={() =>
                generateMutation.mutate({
                  count,
                  recipients,
                  tag: tag.trim() || undefined,
                })
              }
            >
              {generateMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Generate {count} alias{count === 1 ? "" : "es"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Your aliases</CardTitle>
              <CardDescription>
                Aliases you created. Deleting one stops forwarding immediately.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedCount === 0}
              onClick={exportCsv}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV ({selectedCount})
            </Button>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : aliases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No aliases yet. Generate some above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Alias</TableHead>
                    <TableHead>YouTube password</TableHead>
                    <TableHead>Instagram password</TableHead>
                    <TableHead>Forwards to</TableHead>
                    <TableHead>Tag</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aliases.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(a.id)}
                          onCheckedChange={() => toggleOne(a.id)}
                          aria-label={`Select ${a.email}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <button
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => a.email && copy(a.email, `${a.id}:email`)}
                          title="Copy"
                        >
                          {a.email}
                          {copied === `${a.id}:email` ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-50" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {a.youtubePassword ? (
                          <button
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() =>
                              copy(a.youtubePassword ?? "", `${a.id}:yt`)
                            }
                            title="Copy"
                          >
                            {a.youtubePassword}
                            {copied === `${a.id}:yt` ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3 opacity-50" />
                            )}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {a.instagramPassword ? (
                          <button
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() =>
                              copy(a.instagramPassword ?? "", `${a.id}:ig`)
                            }
                            title="Copy"
                          >
                            {a.instagramPassword}
                            {copied === `${a.id}:ig` ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3 opacity-50" />
                            )}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.recipients}
                      </TableCell>
                      <TableCell>
                        {a.tag ? (
                          <Badge variant="secondary">{a.tag}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {a.createdAt
                          ? new Date(a.createdAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate({ id: a.id })}
                          title="Delete alias"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
