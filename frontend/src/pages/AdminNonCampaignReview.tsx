import { useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Instagram,
  Loader2,
  MoreVertical,
  Music2,
  Search,
  Twitter,
  X,
  Youtube,
  Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NonCampaignTrends } from "@/components/dashboard/NonCampaignTrends";
import { cn } from "@/lib/utils";

type StatusFilter = "pending" | "approved" | "rejected";
const STATUSES: StatusFilter[] = ["pending", "approved", "rejected"];
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const platformIcon = (platform: string): LucideIcon => {
  const p = platform?.toLowerCase() ?? "";
  if (p.includes("youtube") || p === "yt") return Youtube;
  if (p.includes("instagram") || p === "ig") return Instagram;
  if (p.includes("tiktok") || p === "tt") return Music2;
  if (p === "x" || p.includes("twitter")) return Twitter;
  return Globe;
};

const formatNumber = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000
    ? `${(v / 1_000).toFixed(1)}K`
    : v.toLocaleString();

const formatDate = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

interface Props {
  campaignFilter: string;
}

const AdminNonCampaignReview = ({ campaignFilter }: Props) => {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sortOption, setSortOption] = useState("created-desc");
  const [urlSearch, setUrlSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [statsOpen, setStatsOpen] = useState(false);
  const [rejectDialog, setRejectDialog] = useState<{
    open: boolean;
    clipId: string | null;
    reason: string;
  }>({ open: false, clipId: null, reason: "" });

  // Convert-to-campaign confirmation (mod fix for clips uploaded to the
  // wrong bucket by mistake).
  const [convertDialog, setConvertDialog] = useState<{
    open: boolean;
    clipId: string | null;
    url: string;
  }>({ open: false, clipId: null, url: "" });

  const { data: clips, isLoading } =
    trpc.submissions.getAdminNonCampaignClips.useQuery({
      status: statusFilter,
      campaignId: campaignFilter !== "all" ? campaignFilter : undefined,
    });

  const updateStatus =
    trpc.submissions.updateNonCampaignClipStatus.useMutation({
      onSuccess: async (data) => {
        await Promise.all([
          utils.submissions.getAdminNonCampaignClips.invalidate(),
          utils.submissions.getAdminSubmissions.invalidate(),
          utils.submissions.getNonCampaignStats.invalidate(),
        ]);
        toast({
          title:
            data.status === "rejected"
              ? "Non-campaign clip rejected"
              : "Non-campaign clip approved",
          description:
            data.status === "rejected"
              ? `${data.affectedCampaignClipIds.length} campaign clip(s) un-redeemed; any paid rewards revoked.`
              : data.recoveredCampaignClipIds.length > 0
                ? `${data.recoveredCampaignClipIds.length} campaign clip(s) re-covered; clawed-back earnings restored.`
                : "Clipper can keep submitting campaign clips on this account.",
        });
      },
      onError: (e) =>
        toast({
          title: "Update failed",
          description: e.message || "Couldn't update.",
          variant: "destructive",
        }),
    });

  const convertToCampaign =
    trpc.submissions.convertNonCampaignToCampaign.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.submissions.getAdminNonCampaignClips.invalidate(),
          utils.submissions.getAdminSubmissions.invalidate(),
          utils.submissions.getNonCampaignStats.invalidate(),
        ]);
        toast({
          title: "Converted to campaign clip",
          description:
            "The clip moved to the campaign review queue as pending.",
        });
        setConvertDialog({ open: false, clipId: null, url: "" });
      },
      onError: (e) =>
        toast({
          title: "Conversion failed",
          description: e.message || "Couldn't convert.",
          variant: "destructive",
        }),
    });

  // Platform options from the returned data
  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    (clips ?? []).forEach((c) => c.platform && set.add(c.platform));
    return Array.from(set).sort();
  }, [clips]);

  // Client-side filter + sort
  const filtered = useMemo(() => {
    let rows = clips ?? [];
    if (platformFilter !== "all")
      rows = rows.filter((c) => c.platform === platformFilter);
    if (urlSearch.trim()) {
      const q = urlSearch.trim().toLowerCase();
      rows = rows.filter((c) => c.url.toLowerCase().includes(q));
    }
    const sorted = [...rows].sort((a, b) => {
      switch (sortOption) {
        case "created-asc":
          return (
            new Date(a.createdAt ?? 0).getTime() -
            new Date(b.createdAt ?? 0).getTime()
          );
        case "views-desc":
          return (b.views ?? 0) - (a.views ?? 0);
        case "views-asc":
          return (a.views ?? 0) - (b.views ?? 0);
        case "created-desc":
        default:
          return (
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime()
          );
      }
    });
    return sorted;
  }, [clips, platformFilter, urlSearch, sortOption]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const submitReject = async () => {
    if (!rejectDialog.clipId) return;
    if (!rejectDialog.reason.trim()) {
      toast({
        title: "Reason required",
        description: "Type why the clip is being rejected.",
        variant: "destructive",
      });
      return;
    }
    await updateStatus.mutateAsync({
      id: rejectDialog.clipId,
      status: "rejected",
      rejectedReason: rejectDialog.reason.trim(),
    });
    setRejectDialog({ open: false, clipId: null, reason: "" });
  };

  return (
    <div className="space-y-4">
      {/* Filters row — mirrors the campaign review panel */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 p-1">
          {STATUSES.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={statusFilter === s ? "default" : "ghost"}
              className="capitalize"
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            >
              {s}
            </Button>
          ))}
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by clip URL"
            className="pl-9"
            value={urlSearch}
            onChange={(e) => {
              setUrlSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <Select
          value={platformFilter}
          onValueChange={(v) => {
            setPlatformFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platformOptions.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortOption} onValueChange={setSortOption}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created-desc">Newest first</SelectItem>
            <SelectItem value="created-asc">Oldest first</SelectItem>
            <SelectItem value="views-desc">Most views</SelectItem>
            <SelectItem value="views-asc">Fewest views</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          className="ml-auto"
          onClick={() => setStatsOpen(true)}
        >
          <BarChart3 className="mr-2 h-4 w-4" />
          View stats
        </Button>
      </div>

      {/* Table — same structure as campaign clip review */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading non-campaign clips…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
          No {statusFilter} non-campaign clips
          {campaignFilter !== "all" ? " for this campaign" : ""}.
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clip</TableHead>
                  <TableHead>Views</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((c) => {
                  const Icon = platformIcon(c.platform);
                  const name =
                    [c.clerkFirstName, c.clerkLastName]
                      .filter(Boolean)
                      .join(" ") ||
                    c.clerkEmail ||
                    c.userId;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-[260px] items-center gap-2 text-primary hover:underline"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{c.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell>{formatNumber(c.views ?? 0)}</TableCell>
                      <TableCell>
                        @{c.verifiedHandle ?? "unknown"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={c.clerkImageUrl ?? undefined} />
                            <AvatarFallback className="text-xs">
                              {(name || "?").slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {name}
                            </div>
                            {c.clerkEmail ? (
                              <div className="truncate text-xs text-muted-foreground">
                                {c.clerkEmail}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        {c.campaignTitle ?? c.campaignId}
                      </TableCell>
                      <TableCell>{formatDate(c.createdAt)}</TableCell>
                      <TableCell>
                        {c.status === "rejected" ? (
                          <Badge variant="destructive">Rejected</Badge>
                        ) : c.status === "approved" ? (
                          <Badge className="bg-emerald-600">Approved</Badge>
                        ) : (
                          <Badge>Pending</Badge>
                        )}
                        {c.rejectedReason ? (
                          <div className="mt-1 max-w-[180px] text-xs text-red-700">
                            {c.rejectedReason}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {c.status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={updateStatus.isPending}
                                onClick={() =>
                                  updateStatus.mutate({
                                    id: c.id,
                                    status: "approved",
                                  })
                                }
                              >
                                <Check className="mr-1 h-4 w-4" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={updateStatus.isPending}
                                onClick={() =>
                                  setRejectDialog({
                                    open: true,
                                    clipId: c.id,
                                    reason: "",
                                  })
                                }
                              >
                                <X className="mr-1 h-4 w-4" />
                                Reject
                              </Button>
                            </>
                          ) : c.status === "approved" ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={updateStatus.isPending}
                              onClick={() =>
                                setRejectDialog({
                                  open: true,
                                  clipId: c.id,
                                  reason: "",
                                })
                              }
                            >
                              Reject
                            </Button>
                          ) : (
                            // Rejected rows can be flipped back to accepted —
                            // the backend re-covers the clipper's campaign
                            // clips and restores the clawed-back earnings.
                            <Button
                              size="sm"
                              disabled={updateStatus.isPending}
                              onClick={() =>
                                updateStatus.mutate({
                                  id: c.id,
                                  status: "approved",
                                })
                              }
                            >
                              <Check className="mr-1 h-4 w-4" />
                              Accept
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                aria-label="More actions"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  setConvertDialog({
                                    open: true,
                                    clipId: c.id,
                                    url: c.url,
                                  })
                                }
                              >
                                <ArrowLeftRight className="mr-2 h-4 w-4" />
                                Convert to campaign clip
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Showing {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number]);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-full sm:w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm">
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Reject dialog (cascade warning preserved) */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => setRejectDialog((p) => ({ ...p, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Reject non-campaign clip
            </DialogTitle>
            <DialogDescription>
              Rejecting un-redeems every campaign clip this was covering and
              revokes any paid rewards on them. The clipper must submit a new
              non-campaign clip from the same account to re-cover them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="nc-reject-reason">Reason</Label>
            <Textarea
              id="nc-reject-reason"
              value={rejectDialog.reason}
              onChange={(e) =>
                setRejectDialog((p) => ({ ...p, reason: e.target.value }))
              }
              placeholder="e.g. low quality / wrong account / doesn't meet guidelines"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setRejectDialog({ open: false, clipId: null, reason: "" })
              }
              disabled={updateStatus.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitReject}
              disabled={updateStatus.isPending}
            >
              {updateStatus.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Rejecting…
                </span>
              ) : (
                "Confirm rejection"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to campaign clip — confirmation */}
      <Dialog
        open={convertDialog.open}
        onOpenChange={(open) => setConvertDialog((p) => ({ ...p, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Convert to campaign clip
            </DialogTitle>
            <DialogDescription>
              Moves this clip out of the non-campaign bucket and into the
              campaign review queue as <strong>pending</strong>. Use this when
              a clipper uploaded a campaign clip as non-campaign by mistake.
              Blocked if this clip already covers campaign clips.
            </DialogDescription>
          </DialogHeader>
          {convertDialog.url ? (
            <p className="truncate rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {convertDialog.url}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setConvertDialog({ open: false, clipId: null, url: "" })
              }
              disabled={convertToCampaign.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                convertDialog.clipId &&
                convertToCampaign.mutate({
                  nonCampaignClipId: convertDialog.clipId,
                })
              }
              disabled={convertToCampaign.isPending || !convertDialog.clipId}
            >
              {convertToCampaign.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Converting…
                </span>
              ) : (
                "Convert"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View stats dialog (Feature 2) */}
      <NonCampaignStatsDialog
        open={statsOpen}
        onOpenChange={setStatsOpen}
        campaignFilter={campaignFilter}
      />
    </div>
  );
};

// ── Non-campaign clip stats — full dashboard, mirroring campaign "View stats"
// (impact, trend chart, top clippers, top clips, review performance). ──

type NCStats =
  ReturnType<typeof trpc.submissions.getNonCampaignStats.useQuery>["data"];
type NCClipper = NonNullable<NCStats>["topClippers"]["byViews"][number];
type NCReviewer = NonNullable<NCStats>["reviewers"][number];

const statusPriority: Record<string, number> = {
  approved: 0,
  rejected: 1,
  pending: 2,
  unknown: 3,
};
const statusBadgeStyles: Record<string, string> = {
  approved:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-800/60",
  rejected:
    "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-800/60",
  pending:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-800/60",
  unknown: "bg-muted text-muted-foreground border-muted-foreground/20",
};
const formatStatusLabel = (status: string) =>
  status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const clipperName = (c: {
  discordUsername: string | null;
  firstName: string | null;
  handle?: string | null;
  userId: string;
}) =>
  c.discordUsername
    ? `@${c.discordUsername}`
    : c.firstName
    ? c.firstName
    : c.handle
    ? `@${c.handle}`
    : c.userId === "unknown"
    ? "Unknown"
    : c.userId;

const initials = (source: string | null | undefined) =>
  (source ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase() || "?";

const reviewerName = (r: NCReviewer) =>
  r.discordUsername ? `@${r.discordUsername}` : r.firstName ?? r.reviewerId;

const ClipperRow = ({
  clipper,
  metric,
}: {
  clipper: NCClipper;
  metric: "views" | "clips";
}) => (
  <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/60 p-3">
    <div className="flex items-center gap-3">
      <Avatar className="h-10 w-10">
        <AvatarImage src={clipper.avatarUrl ?? undefined} />
        <AvatarFallback className="text-xs font-semibold">
          {initials(clipper.discordUsername || clipper.firstName || clipper.handle || clipper.userId)}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="text-sm font-medium leading-tight">{clipperName(clipper)}</p>
        <p className="text-xs text-muted-foreground">
          {metric === "views"
            ? `${clipper.clipCount.toLocaleString()} clips`
            : `${formatNumber(clipper.viewCount)} views`}
        </p>
      </div>
    </div>
    <div className="text-right">
      <p className="text-sm font-semibold">
        {metric === "views"
          ? formatNumber(clipper.viewCount)
          : clipper.clipCount.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground">
        {metric === "views" ? "views" : "clips"}
      </p>
    </div>
  </div>
);

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
    {children}
  </p>
);

const NonCampaignStatsDialog = ({
  open,
  onOpenChange,
  campaignFilter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignFilter: string;
}) => {
  const scopedCampaignId =
    campaignFilter !== "all" ? campaignFilter : undefined;
  const { data, isLoading } = trpc.submissions.getNonCampaignStats.useQuery(
    { campaignId: scopedCampaignId },
    { enabled: open }
  );

  const totalReviews =
    data?.reviewers.reduce((sum, r) => sum + r.totalReviewed, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Non-campaign clip stats
            {campaignFilter !== "all" ? " (this campaign)" : " (all campaigns)"}
          </DialogTitle>
          <DialogDescription>
            The full dashboard for non-campaign clips — impact, trends over
            time, top clips, top clippers, and review performance.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading stats…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Approved impact */}
            <div className="rounded-xl border border-dashed p-5">
              <h3 className="mb-1 flex items-center gap-2 font-semibold">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                Approved clip impact
              </h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Approved non-campaign clips, delivered views, and unique
                submitters per platform.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <StatCard label="Views" value={formatNumber(data.totals.views)} />
                <StatCard label="Approved clips" value={String(data.totals.clips)} />
                <StatCard label="Submitters" value={String(data.totals.submitters)} />
              </div>
              <div className="mt-5">
                <SectionTitle>Platform contributions</SectionTitle>
                {data.platforms.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No approved clips yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {data.platforms.map((p) => (
                      <div
                        key={p.platform}
                        className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/40 p-3 text-sm"
                      >
                        <span className="font-medium capitalize">
                          {p.platform}
                        </span>
                        <span className="text-muted-foreground">
                          {formatNumber(p.views)} views · {p.clips} clips
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Trend chart */}
            <NonCampaignTrends campaignId={scopedCampaignId} />

            {/* Top clippers */}
            <div className="rounded-xl border border-dashed p-5 md:col-span-2">
              <h3 className="mb-1 font-semibold">Top performing clippers</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Submitters delivering the most non-campaign views and clips.
              </p>
              {data.topClippers.byViews.length === 0 &&
              data.topClippers.byClips.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <SectionTitle>By views delivered</SectionTitle>
                    <div className="mt-3 space-y-3">
                      {data.topClippers.byViews.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No view data yet.
                        </p>
                      ) : (
                        data.topClippers.byViews.map((c) => (
                          <ClipperRow
                            key={`v-${c.userId}`}
                            clipper={c}
                            metric="views"
                          />
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <SectionTitle>By clips submitted</SectionTitle>
                    <div className="mt-3 space-y-3">
                      {data.topClippers.byClips.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No clip data yet.
                        </p>
                      ) : (
                        data.topClippers.byClips.map((c) => (
                          <ClipperRow
                            key={`c-${c.userId}`}
                            clipper={c}
                            metric="clips"
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Top individual clips */}
            <div className="rounded-xl border border-dashed p-5 md:col-span-2">
              <h3 className="mb-1 font-semibold">Top clips</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                The highest-viewed approved non-campaign clips.
              </p>
              {data.topClips.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approved clips yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.topClips.map((clip, i) => {
                    const Icon = platformIcon(clip.platform);
                    return (
                      <div
                        key={clip.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/60 p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-5 text-center text-xs font-semibold text-muted-foreground">
                            {i + 1}
                          </span>
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <a
                              href={clip.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 truncate text-sm font-medium hover:underline"
                            >
                              <span className="truncate">
                                {clip.handle ? `@${clip.handle}` : clip.url}
                              </span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                            <p className="truncate text-xs text-muted-foreground">
                              {clipperName(clip)} · {clip.platform}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold">
                            {formatNumber(clip.views)}
                          </p>
                          <p className="text-xs text-muted-foreground">views</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Review status summary */}
            <div className="rounded-xl border border-dashed p-5">
              <h3 className="mb-3 font-semibold">Review status</h3>
              <div className="flex flex-wrap gap-2">
                {data.byStatus.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No clips yet.</p>
                ) : (
                  data.byStatus.map((s) => (
                    <Badge
                      key={s.status}
                      variant="secondary"
                      className={cn(
                        "border px-2.5 py-1 text-xs font-medium",
                        statusBadgeStyles[s.status] || statusBadgeStyles.unknown
                      )}
                    >
                      {formatStatusLabel(s.status)} · {s.clips}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            {/* Moderator review performance */}
            <div className="rounded-xl border border-dashed p-5">
              <h3 className="mb-1 font-semibold">Moderator performance</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                {totalReviews > 0
                  ? `${totalReviews.toLocaleString()} decisions recorded.`
                  : "No reviews recorded yet."}
              </p>
              {data.reviewers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.reviewers.map((r) => (
                    <div
                      key={r.reviewerId}
                      className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={r.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-xs font-semibold">
                            {initials(r.discordUsername || r.firstName || r.reviewerId)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium leading-tight">
                            {reviewerName(r)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.totalReviewed.toLocaleString()} reviews
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(r.statusBreakdown)
                          .sort((a, b) => {
                            const pa = statusPriority[a[0]] ?? 50;
                            const pb = statusPriority[b[0]] ?? 50;
                            return pa !== pb ? pa - pb : b[1] - a[1];
                          })
                          .map(([status, count]) => (
                            <Badge
                              key={`${r.reviewerId}-${status}`}
                              variant="secondary"
                              className={cn(
                                "border px-2 py-0.5 text-xs",
                                statusBadgeStyles[status] ||
                                  statusBadgeStyles.unknown
                              )}
                            >
                              {formatStatusLabel(status)} · {count}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border p-3">
    <div className="text-2xl font-semibold">{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

export default AdminNonCampaignReview;
