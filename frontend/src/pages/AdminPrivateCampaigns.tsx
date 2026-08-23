import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ExternalLink,
  Eye,
  Instagram,
  Loader2,
  Lock,
  Music2,
  RotateCcw,
  Twitter,
  UserX,
  Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const platformIcons: Record<string, LucideIcon> = {
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Music2,
  x: Twitter,
};

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

const formatViews = (views: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact" }).format(views);

const statusBadge = (status: string) => {
  switch (status) {
    case "approved":
      return <Badge className="bg-emerald-100 text-emerald-800">Approved</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    case "autoreject":
      return <Badge variant="destructive">Auto-rejected</Badge>;
    default:
      return <Badge className="bg-amber-100 text-amber-800">Pending</Badge>;
  }
};

export default function AdminPrivateCampaigns() {
  const { toast } = useToast();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_TABS)[number]["value"]>("pending");
  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null);
  const [reviewingApplicationId, setReviewingApplicationId] = useState<
    string | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");

  const campaignsQuery = trpc.privateCampaigns.listPrivateCampaigns.useQuery();
  const applicationsQuery = trpc.privateCampaigns.listApplications.useQuery(
    { campaignId: campaignId ?? "", status: statusFilter },
    { enabled: Boolean(campaignId) }
  );
  const statsQuery = trpc.privateCampaigns.getApplicantStats.useQuery(
    { userId: reviewingUserId ?? "" },
    { enabled: Boolean(reviewingUserId) }
  );

  const reviewMutation = trpc.privateCampaigns.review.useMutation({
    onSuccess: (result) => {
      if (result.status === "approved") {
        const discordNote = result.discordAdded
          ? "Added to the private Discord server automatically."
          : "They'll be added once they click “Enable one-click Discord join” on the campaign card.";
        toast({ title: "Application approved", description: discordNote });
      } else if (result.status === "rejected") {
        toast({ title: "Application rejected" });
      } else {
        toast({
          title: "Moved back to pending",
          description: "The application is in the review queue again.",
        });
      }
      setReviewingUserId(null);
      setReviewingApplicationId(null);
      setRejectReason("");
      applicationsQuery.refetch();
      campaignsQuery.refetch();
    },
    onError: (e) =>
      toast({
        title: "Review failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const selectedCampaign = (campaignsQuery.data ?? []).find(
    (c) => c.id === campaignId
  );
  const reviewingApplication = (applicationsQuery.data ?? []).find(
    (a) => a.id === reviewingApplicationId
  );
  const stats = statsQuery.data;

  const openReview = (applicationId: string, userId: string) => {
    setReviewingApplicationId(applicationId);
    setReviewingUserId(userId);
    setRejectReason("");
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-muted-foreground">
                Admin • Private Campaigns
              </p>
              <h1 className="flex items-center gap-2 text-3xl font-semibold">
                <Lock className="h-7 w-7" /> Private campaigns
              </h1>
              <p className="text-muted-foreground">
                Review clipper applications. Approving pulls the clipper into
                the campaign's private Discord server.
              </p>
            </div>
            <Select
              value={campaignId ?? undefined}
              onValueChange={(v) => setCampaignId(v)}
            >
              <SelectTrigger className="w-full sm:w-[320px]">
                <SelectValue placeholder="Select a private campaign" />
              </SelectTrigger>
              <SelectContent>
                {(campaignsQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title ?? "Untitled campaign"}
                    {Number(c.pendingCount) > 0
                      ? ` — ${c.pendingCount} pending`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {campaignsQuery.data?.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                No private campaigns yet. Flip a campaign to private in its
                edit page (Private Campaign section) and it'll show up here.
              </CardContent>
            </Card>
          )}

          {!campaignId ? (
            campaignsQuery.data?.length !== 0 && (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  Pick a private campaign to see its applications.
                </CardContent>
              </Card>
            )
          ) : (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>
                      Applications — {selectedCampaign?.title ?? "campaign"}
                    </CardTitle>
                    <CardDescription>
                      {selectedCampaign
                        ? `${selectedCampaign.pendingCount} pending • ${selectedCampaign.approvedCount} approved • ${selectedCampaign.rejectedCount} rejected`
                        : null}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {STATUS_TABS.map((tab) => (
                      <Button
                        key={tab.value}
                        size="sm"
                        variant={
                          statusFilter === tab.value ? "default" : "outline"
                        }
                        onClick={() => setStatusFilter(tab.value)}
                      >
                        {tab.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {applicationsQuery.isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading
                    applications…
                  </div>
                ) : (applicationsQuery.data ?? []).length === 0 ? (
                  <p className="py-12 text-center text-muted-foreground">
                    No {statusFilter} applications.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {(applicationsQuery.data ?? []).map((application) => (
                      <div
                        key={application.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={application.imageUrl ?? undefined}
                            />
                            <AvatarFallback>
                              {(application.username ?? "?")
                                .slice(0, 2)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {application.username ??
                                application.name ??
                                application.userId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Applied{" "}
                              {new Date(
                                application.createdAt
                              ).toLocaleDateString()}
                              {application.email ? ` • ${application.email}` : ""}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {application.accounts.map((account) => {
                                const Icon =
                                  platformIcons[account.platform] ?? Music2;
                                return (
                                  <span
                                    key={account.verifiedUserId}
                                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                                  >
                                    <Icon className="h-3 w-3" /> @
                                    {account.handle}
                                  </span>
                                );
                              })}
                            </div>
                            {application.applyCount > 1 && (
                              <p className="mt-1 text-xs text-amber-700">
                                Previously rejected
                                {application.lastRejectedAt
                                  ? ` on ${new Date(application.lastRejectedAt).toLocaleDateString()}`
                                  : ""}
                                {application.lastRejectedReason
                                  ? `: “${application.lastRejectedReason}”`
                                  : ""}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {application.applyCount > 1 && (
                            <Badge className="bg-amber-100 text-amber-800">
                              {application.status === "pending"
                                ? `Re-applying · attempt ${application.applyCount}`
                                : `Attempt ${application.applyCount}`}
                            </Badge>
                          )}
                          {statusBadge(application.status)}
                          {application.status === "approved" &&
                            (application.discordJoinMethod === "oauth" ? (
                              <Badge className="bg-indigo-100 text-indigo-800">
                                In Discord
                              </Badge>
                            ) : application.discordJoinMethod === "invite" ? (
                              <Badge className="bg-indigo-100 text-indigo-800">
                                Invite sent
                              </Badge>
                            ) : (
                              <Badge variant="outline">No Discord</Badge>
                            ))}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              openReview(application.id, application.userId)
                            }
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            {application.status === "pending"
                              ? "Review"
                              : "Details"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Applicant review dialog ── */}
      <Dialog
        open={Boolean(reviewingApplicationId)}
        onOpenChange={(open) => {
          if (!open) {
            setReviewingApplicationId(null);
            setReviewingUserId(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {reviewingApplication?.username ??
                reviewingApplication?.name ??
                "Applicant"}{" "}
              — clipper history
            </DialogTitle>
          </DialogHeader>

          {statsQuery.isLoading || !stats ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading stats…
            </div>
          ) : (
            <div className="space-y-6">
              {/* Re-application notice — the mod should know they've judged
                  this person before, and what the verdict was. */}
              {reviewingApplication && reviewingApplication.applyCount > 1 && (
                <div className="space-y-1 rounded-lg border border-amber-300/60 bg-amber-500/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                    <AlertTriangle className="h-4 w-4" /> Re-application —
                    attempt {reviewingApplication.applyCount}
                  </p>
                  <p className="text-sm text-amber-700">
                    Previously rejected
                    {reviewingApplication.lastRejectedAt
                      ? ` on ${new Date(reviewingApplication.lastRejectedAt).toLocaleDateString()}`
                      : ""}
                    {reviewingApplication.lastRejectedReason
                      ? ` — “${reviewingApplication.lastRejectedReason}”`
                      : " — no reason was recorded"}
                  </p>
                </div>
              )}

              {/* Red flags first — the fastest way to say no. */}
              {(stats.flags.ban ||
                stats.flags.bannedHandles.length > 0 ||
                stats.flags.suspensions.length > 0 ||
                stats.flags.autorejectCount > 0) && (
                <div className="space-y-2 rounded-lg border border-red-300/60 bg-red-500/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
                    <AlertTriangle className="h-4 w-4" /> Flags
                  </p>
                  {stats.flags.ban && (
                    <p className="flex items-center gap-2 text-sm text-red-700">
                      <Ban className="h-4 w-4" /> Platform-banned:{" "}
                      {stats.flags.ban.reason ?? "no reason recorded"}
                    </p>
                  )}
                  {stats.flags.bannedHandles.map((handle) => (
                    <p
                      key={`${handle.platform}-${handle.handle}`}
                      className="flex items-center gap-2 text-sm text-red-700"
                    >
                      <Ban className="h-4 w-4" /> Banned handle: @
                      {handle.handle} ({handle.platform})
                    </p>
                  ))}
                  {stats.flags.suspensions.map((suspension, i) => (
                    <p
                      key={i}
                      className="flex items-center gap-2 text-sm text-red-700"
                    >
                      <UserX className="h-4 w-4" />
                      {suspension.unsuspendedAt ? "Past" : "ACTIVE"} suspension
                      from {suspension.campaignTitle ?? "a campaign"}:{" "}
                      {suspension.reason ?? "no reason"}
                    </p>
                  ))}
                  {stats.flags.autorejectCount > 0 && (
                    <p className="text-sm text-red-700">
                      {stats.flags.autorejectCount} auto-rejected clip
                      {stats.flags.autorejectCount === 1 ? "" : "s"} (Discord
                      ban automation)
                    </p>
                  )}
                </div>
              )}

              {/* Totals */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Campaigns", value: stats.totals.campaigns },
                  { label: "Clips", value: stats.totals.clips },
                  {
                    label: "Total views",
                    value: formatViews(stats.totals.views),
                  },
                  {
                    label: "Avg views / clip",
                    value: formatViews(stats.totals.avgViewsPerClip),
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border bg-muted/30 p-3 text-center"
                  >
                    <p className="text-2xl font-semibold">{stat.value}</p>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>

              {/* Everything connected to the applicant's web-app profile,
                  clickable, plus their Discord profile — so the mod can
                  inspect the real accounts before deciding. */}
              {reviewingApplication && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Connected accounts (profile)
                  </p>
                  {reviewingApplication.profileAccounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No verified accounts connected.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {reviewingApplication.profileAccounts.map((account) => {
                        const Icon = platformIcons[account.platform] ?? Music2;
                        const chip = (
                          <>
                            <Icon className="h-3.5 w-3.5" /> @{account.handle}
                          </>
                        );
                        return account.url ? (
                          <a
                            key={`${account.platform}:${account.handle}`}
                            href={account.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm underline-offset-2 hover:underline"
                          >
                            {chip}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        ) : (
                          <span
                            key={`${account.platform}:${account.handle}`}
                            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                          >
                            {chip}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <a
                    href={`https://discord.com/users/${reviewingApplication.userId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> View Discord
                    profile
                  </a>
                </div>
              )}

              {/* Accounts they applied with (legacy applications only — new
                  applications no longer collect accounts). */}
              {reviewingApplication &&
                reviewingApplication.accounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Applying with</p>
                  <div className="flex flex-wrap gap-2">
                    {reviewingApplication.accounts.map((account) => {
                      const Icon = platformIcons[account.platform] ?? Music2;
                      return (
                        <span
                          key={account.verifiedUserId}
                          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                        >
                          <Icon className="h-3.5 w-3.5" /> @{account.handle}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Per-campaign history */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">Campaign history</p>
                {stats.perCampaign.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No clips submitted yet — brand-new clipper.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {stats.perCampaign.map((campaign) => (
                      <div
                        key={campaign.campaignId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={campaign.campaignImageUrl ?? undefined}
                            />
                            <AvatarFallback>
                              {(campaign.campaignTitle ?? "C").slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">
                              {campaign.campaignTitle ?? "Unknown campaign"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {String(campaign.totalClips)} clips •{" "}
                              {String(campaign.approvedClips)} approved •{" "}
                              {String(campaign.rejectedClips)} rejected
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">
                            {formatViews(Number(campaign.totalViews ?? 0))}{" "}
                            views
                          </p>
                          <p className="text-xs text-muted-foreground">
                            last clip{" "}
                            {campaign.lastClipAt
                              ? new Date(
                                  campaign.lastClipAt
                                ).toLocaleDateString()
                              : "—"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top clips */}
              {stats.topClips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Top clips</p>
                  <div className="space-y-1">
                    {stats.topClips.map((clip) => {
                      const Icon = platformIcons[clip.platform] ?? Music2;
                      return (
                        <a
                          key={clip.id}
                          href={clip.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition hover:border-primary/50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate text-muted-foreground">
                              {clip.campaignTitle ?? "campaign"} •{" "}
                              {clip.status}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 font-medium">
                            {formatViews(clip.views ?? 0)} views
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Rejection profile */}
              {stats.rejectionSummary.reviewedClips > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Rejection profile</p>
                  <div
                    className={`rounded-lg border p-3 ${
                      (stats.rejectionSummary.rejectionRatePct ?? 0) >= 30
                        ? "border-red-300/60 bg-red-500/5"
                        : "bg-muted/30"
                    }`}
                  >
                    <p className="text-sm">
                      <span
                        className={`font-semibold ${
                          (stats.rejectionSummary.rejectionRatePct ?? 0) >= 30
                            ? "text-red-700"
                            : ""
                        }`}
                      >
                        {stats.rejectionSummary.rejectionRatePct}% rejection
                        rate
                      </span>{" "}
                      — {stats.rejectionSummary.rejectedClips} of{" "}
                      {stats.rejectionSummary.reviewedClips} reviewed clips
                      rejected
                    </p>
                    {stats.rejectionSummary.topReasons.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Rejection reasons
                        </p>
                        {stats.rejectionSummary.topReasons.map((reason) => (
                          <p
                            key={reason.reason}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="truncate">{reason.reason}</span>
                            {reason.count >= 3 ? (
                              <Badge variant="destructive">
                                ×{reason.count} — repeated
                              </Badge>
                            ) : (
                              <span className="shrink-0 text-muted-foreground">
                                ×{reason.count}
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent clips — newest first, warts and all */}
              {stats.recentClips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Recent clips ({stats.recentClips.length}
                    {stats.recentClips.length === 100 ? " most recent" : ""})
                  </p>
                  <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                    {stats.recentClips.map((clip) => {
                      const Icon = platformIcons[clip.platform] ?? Music2;
                      return (
                        <a
                          key={clip.id}
                          href={clip.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition hover:border-primary/50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0">
                              <span className="block truncate text-muted-foreground">
                                {new Date(clip.createdAt).toLocaleDateString()}{" "}
                                • {clip.campaignTitle ?? "campaign"}
                                {clip.source === "non-campaign"
                                  ? " • non-campaign"
                                  : ""}
                              </span>
                              {clip.status === "rejected" ||
                              clip.status === "autoreject" ? (
                                <span className="block truncate text-xs text-red-600">
                                  rejected
                                  {clip.rejectedReason
                                    ? `: ${clip.rejectedReason}`
                                    : ""}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {clip.deletedAt && (
                              <Badge variant="destructive">deleted</Badge>
                            )}
                            {statusBadge(clip.status)}
                            <span className="font-medium">
                              {formatViews(clip.views ?? 0)}
                            </span>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Decision — mods can set the verdict, or reverse an earlier
                  one (accepted/rejected by mistake). Only the buttons for a
                  *different* status than the current one are shown. */}
              {reviewingApplication && (
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Current status:
                    </span>
                    {statusBadge(reviewingApplication.status)}
                    {reviewingApplication.status !== "pending" && (
                      <span className="text-xs text-muted-foreground">
                        You can change this to fix a mistake.
                      </span>
                    )}
                  </div>
                  {reviewingApplication.status !== "rejected" && (
                    <Textarea
                      placeholder="Rejection reason (optional — shown to the clipper)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                    />
                  )}
                  <div className="flex flex-wrap gap-3">
                    {reviewingApplication.status !== "approved" && (
                      <Button
                        className="flex-1"
                        disabled={reviewMutation.isPending}
                        onClick={() => {
                          if (!reviewingApplicationId) return;
                          if (
                            reviewingApplication.status !== "pending" &&
                            !window.confirm(
                              "Move this applicant to Approved? They regain campaign access and get re-invited to Discord."
                            )
                          )
                            return;
                          reviewMutation.mutate({
                            applicationId: reviewingApplicationId,
                            action: "approve",
                          });
                        }}
                      >
                        {reviewMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        {reviewingApplication.status === "pending"
                          ? "Approve & invite to Discord"
                          : "Move to Approved"}
                      </Button>
                    )}
                    {reviewingApplication.status !== "rejected" && (
                      <Button
                        variant="destructive"
                        className="flex-1"
                        disabled={reviewMutation.isPending}
                        onClick={() => {
                          if (!reviewingApplicationId) return;
                          if (
                            reviewingApplication.status !== "pending" &&
                            !window.confirm(
                              "Move this applicant to Rejected? They lose campaign access. (They stay in the Discord server until you remove them there.)"
                            )
                          )
                            return;
                          reviewMutation.mutate({
                            applicationId: reviewingApplicationId,
                            action: "reject",
                            rejectedReason: rejectReason.trim() || undefined,
                          });
                        }}
                      >
                        <UserX className="mr-2 h-4 w-4" />
                        {reviewingApplication.status === "pending"
                          ? "Reject"
                          : "Move to Rejected"}
                      </Button>
                    )}
                    {reviewingApplication.status !== "pending" && (
                      <Button
                        variant="outline"
                        className="flex-1"
                        disabled={reviewMutation.isPending}
                        onClick={() => {
                          if (!reviewingApplicationId) return;
                          if (
                            !window.confirm(
                              "Undo this decision and send the application back to Pending?"
                            )
                          )
                            return;
                          reviewMutation.mutate({
                            applicationId: reviewingApplicationId,
                            action: "pending",
                          });
                        }}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" /> Move to Pending
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
