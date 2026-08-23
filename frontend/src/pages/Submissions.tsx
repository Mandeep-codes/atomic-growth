import { AppLayout } from "@/components/AppLayout";
import type { CampaignDetail } from "@/components/CampaignDetailDialog";
import { CampaignDetailDialog } from "@/components/CampaignDetailDialog";
import { CpmBoostBadge } from "@/components/CpmBoostBadge";
import { Leaderboard } from "@/components/dashboard/Leaderboard";
import { MyNonCampaignClips } from "@/components/MyNonCampaignClips";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCampaignsData } from "@/hooks/useCampaignsData";
import { useMyCpmGroupRates } from "@/hooks/useMyCpmGroupRates";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRouter } from "../../../backend/src/routers";
import { cn, formatPlatformLabel } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatCurrency";

const CAMPAIGN_DURATION_DAYS = 7;
const DAY_IN_MS = 1000 * 60 * 60 * 24;

type RouterOutput = inferRouterOutputs<AppRouter>;
type Submission = RouterOutput["submissions"]["getMySubmissions"][number];
type Campaign = RouterOutput["campaigns"]["getAll"][number];
type CampaignReward = RouterOutput["rewards"]["getMyCampaignRewards"][number];

type SubmissionSortColumn = "views" | "platform" | "created" | "status";
type SubmissionSortDirection = "asc" | "desc";
type SubmissionSortConfig = {
  column: SubmissionSortColumn;
  direction: SubmissionSortDirection;
};

type CampaignSummary = {
  id: string;
  title: string;
  imageUrl: string | null;
  active: boolean;
  ended: boolean;
  totalEarned: number;
  totalViews: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalSubmissions: number;
  ratePerThousand: number | null;
  viewsToGo: number | null;
  daysLeft: number | null;
  achievementPercentage: number | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  platforms: string[];
  campaignPlatforms: string | null;
  submissions: Submission[];
};

type CampaignAccumulator = {
  id: string;
  title: string;
  imageUrl: string | null;
  active: boolean;
  ended: boolean;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  totalEarned: number;
  totalViews: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalSubmissions: number;
  ratePerThousand: number | null;
  platforms: Set<string>;
  campaignPlatforms: string | null;
  submissions: Submission[];
};

const formatDateTime = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatPlatformName = (platform: string) => {
  if (!platform) return "Unknown";
  const lower = platform.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const getRateForSubmission = (submission: Submission) => {
  const platform = submission.platform?.toLowerCase();
  const rates: Record<string, number | null | undefined> = {
    instagram: submission.campaign_insta_per_1000,
    ig: submission.campaign_insta_per_1000,
    tiktok: submission.campaign_tiktok_per_1000,
    youtube: submission.campaign_youtube_per_1000,
    yt: submission.campaign_youtube_per_1000,
    x: submission.campaign_x_per_1000,
    twitter: submission.campaign_x_per_1000,
  };

  const rate = platform ? rates[platform] : null;
  if (rate && rate > 0) return rate;

  const fallbackRates = [
    submission.campaign_insta_per_1000,
    submission.campaign_tiktok_per_1000,
    submission.campaign_youtube_per_1000,
    submission.campaign_x_per_1000,
  ].filter((value): value is number => typeof value === "number" && value > 0);

  return fallbackRates[0] ?? null;
};

const getInitials = (title: string | null | undefined) => {
  if (!title) return "C";
  const words = title.trim().split(" ");
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? "C"}${words[1]?.[0] ?? ""}`.toUpperCase();
};

const Submissions = () => {
  const { data: submissions, isLoading } =
    trpc.submissions.getMySubmissions.useQuery();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { data: campaignRewards, isLoading: isLoadingRewards } =
    trpc.rewards.getMyCampaignRewards.useQuery();
  const { data: campaignDetails } = useCampaignsData();
  // One fetch for the page; each campaign card looks its boost up by id.
  const cpmGroupRates = useMyCpmGroupRates();
  const achievementMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (campaignDetails) {
      campaignDetails.forEach((campaign) => {
        map.set(
          campaign.id,
          typeof campaign.achievementPercentage === "number"
            ? campaign.achievementPercentage
            : null
        );
      });
    }
    return map;
  }, [campaignDetails]);
  const campaignMinViewsMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (campaignDetails) {
      campaignDetails.forEach((campaign) => {
        map.set(
          campaign.id,
          typeof campaign.min_payout === "number" ? campaign.min_payout : null
        );
      });
    }
    return map;
  }, [campaignDetails]);
  const rewardsByCampaign = useMemo(() => {
    const map = new Map<
      string,
      {
        totalAmount: number;
        totalViewDelta: number;
        latestViewCount: number;
        lastRewardAt: Date | string | null;
        platforms: Array<{
          platform: string;
          amount: number;
          viewDelta: number;
          latestViewCount: number;
        }>;
      }
    >();

    if (!campaignRewards) {
      return map;
    }

    campaignRewards.forEach((reward: CampaignReward) => {
      const existing = map.get(reward.campaignId) ?? {
        totalAmount: 0,
        totalViewDelta: 0,
        latestViewCount: 0,
        lastRewardAt: null,
        platforms: [] as Array<{
          platform: string;
          amount: number;
          viewDelta: number;
          latestViewCount: number;
        }>,
      };

      existing.totalAmount += reward.totalAmount;
      existing.totalViewDelta += reward.totalViewDelta;
      existing.latestViewCount = Math.max(
        existing.latestViewCount,
        reward.latestViewCount
      );

      const rewardTime = reward.lastRewardAt
        ? new Date(reward.lastRewardAt).getTime()
        : null;
      const existingTime = existing.lastRewardAt
        ? new Date(existing.lastRewardAt).getTime()
        : null;

      if (rewardTime && (!existingTime || rewardTime > existingTime)) {
        existing.lastRewardAt = reward.lastRewardAt;
      }

      existing.platforms.push({
        platform: reward.platform,
        amount: reward.totalAmount,
        viewDelta: reward.totalViewDelta,
        latestViewCount: reward.latestViewCount,
      });

      map.set(reward.campaignId, existing);
    });

    map.forEach((entry) => {
      entry.platforms.sort((a, b) => b.amount - a.amount);
    });

    return map;
  }, [campaignRewards]);
  const [selectedPostsCampaign, setSelectedPostsCampaign] =
    useState<CampaignSummary | null>(null);
  const [isPostsDialogOpen, setIsPostsDialogOpen] = useState(false);
  const [detailCampaign, setDetailCampaign] = useState<CampaignDetail | null>(
    null
  );
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [leaderboardCampaignId, setLeaderboardCampaignId] = useState<
    string | null
  >(null);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [postsSortConfig, setPostsSortConfig] = useState<SubmissionSortConfig>({
    column: "created",
    direction: "desc",
  });
  const [submissionToDelete, setSubmissionToDelete] =
    useState<Submission | null>(null);

  const deleteSubmission = trpc.submissions.deleteSubmission.useMutation({
    onSuccess: async (_, variables) => {
      const submissionId = (variables as { submissionId: string }).submissionId;
      trackEvent({
        event: "campaign_submission_delete_success",
        properties: {
          submissionId: submissionId,
          campaignId: submissionToDelete?.campaign_id ?? null,
        },
      });
      toast({
        title: "Submission removed",
        description: "We deleted your pending clip.",
      });
      setSubmissionToDelete(null);
      await utils.submissions.getMySubmissions.invalidate();
      setSelectedPostsCampaign((current) => {
        if (!current) return current;
        const existsInCampaign = current.submissions.some(
          (submission) => submission.id === submissionId
        );
        if (!existsInCampaign) {
          return current;
        }
        const nextSubmissions = current.submissions.filter(
          (submission) => submission.id !== submissionId
        );
        return {
          ...current,
          submissions: nextSubmissions,
          pendingCount: Math.max(0, current.pendingCount - 1),
          totalSubmissions: Math.max(0, current.totalSubmissions - 1),
        };
      });
    },
    onError: (error) => {
      trackEvent({
        event: "campaign_submission_delete_failure",
        properties: {
          submissionId: submissionToDelete?.id ?? null,
          campaignId: submissionToDelete?.campaign_id ?? null,
        },
      });
      toast({
        title: "Unable to delete submission",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePostsSort = (column: SubmissionSortColumn) => {
    setPostsSortConfig((current) => {
      if (current.column === column) {
        return {
          column,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      const defaultDirection: SubmissionSortDirection =
        column === "views" || column === "created" ? "desc" : "asc";

      return { column, direction: defaultDirection };
    });
  };

  const getAriaSort = (
    column: SubmissionSortColumn
  ): "ascending" | "descending" | "none" => {
    if (postsSortConfig.column !== column) {
      return "none";
    }

    return postsSortConfig.direction === "asc" ? "ascending" : "descending";
  };

  const renderSortIcon = (column: SubmissionSortColumn) => {
    const isActive = postsSortConfig.column === column;
    if (!isActive) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    }

    if (postsSortConfig.direction === "asc") {
      return <ArrowUp className="h-3.5 w-3.5 text-foreground" />;
    }

    return <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
  };

  const sortedSubmissions = useMemo<Submission[]>(() => {
    if (!selectedPostsCampaign) {
      return [];
    }

    const { column, direction } = postsSortConfig;
    const multiplier = direction === "asc" ? 1 : -1;
    const getTimestamp = (value: Date | string | null | undefined) => {
      if (!value) return 0;
      return value instanceof Date
        ? value.getTime()
        : new Date(value).getTime();
    };

    return [...selectedPostsCampaign.submissions].sort((a, b) => {
      let comparison = 0;
      if (column === "views") {
        comparison = (a.views ?? 0) - (b.views ?? 0);
      } else if (column === "platform") {
        comparison = (a.platform || "").localeCompare(
          b.platform || "",
          undefined,
          {
            sensitivity: "base",
          }
        );
      } else if (column === "status") {
        comparison = (a.status || "").localeCompare(b.status || "", undefined, {
          sensitivity: "base",
        });
      } else {
        comparison = getTimestamp(a.created_at) - getTimestamp(b.created_at);
      }

      if (comparison === 0) {
        return (
          (getTimestamp(a.created_at) - getTimestamp(b.created_at)) * multiplier
        );
      }

      return comparison * multiplier;
    });
  }, [postsSortConfig, selectedPostsCampaign]);

  const campaigns = useMemo<CampaignSummary[]>(() => {
    if (!submissions) return [];

    const map = new Map<string, CampaignAccumulator>();

    submissions.forEach((submission) => {
      if (!submission.campaign_id) return;

      const id = submission.campaign_id;
      const existing = map.get(id);

      const status = submission.status?.toLowerCase();
      const pendingIncrement = status === "pending" ? 1 : 0;
      const approvedIncrement = status === "approved" ? 1 : 0;
      const rejectedIncrement = status === "rejected" ? 1 : 0;
      const rate = getRateForSubmission(submission);

      if (!existing) {
        map.set(id, {
          id,
          title: submission.campaign_title || "Untitled Campaign",
          active: Boolean(submission.campaign_active),
          imageUrl: submission.campaign_image_url,
          ended: Boolean(submission.campaign_ended),
          createdAt: submission.campaign_created_at,
          updatedAt: submission.campaign_updated_at || submission.updated_at,
          totalEarned: submission.reward ?? 0,
          totalViews: submission.views ?? 0,
          pendingCount: pendingIncrement,
          approvedCount: approvedIncrement,
          rejectedCount: rejectedIncrement,
          totalSubmissions: 1,
          ratePerThousand: rate ?? null,
          platforms: new Set(
            submission.platform ? [submission.platform.toLowerCase()] : []
          ),
          campaignPlatforms: submission.campaign_platforms || null,
          submissions: [submission],
        });
      } else {
        existing.totalEarned += submission.reward ?? 0;
        existing.totalViews += submission.views ?? 0;
        existing.totalSubmissions += 1;
        existing.pendingCount += pendingIncrement;
        existing.approvedCount += approvedIncrement;
        existing.rejectedCount += rejectedIncrement;
        existing.updatedAt = submission.updated_at || existing.updatedAt;
        if (!existing.ratePerThousand && rate) {
          existing.ratePerThousand = rate;
        }
        if (submission.platform) {
          existing.platforms.add(submission.platform.toLowerCase());
        }
        existing.submissions.push(submission);
      }
    });

    return Array.from(map.values())
      .map<CampaignSummary>((campaign) => {
        const createdAtDate = campaign.createdAt
          ? new Date(campaign.createdAt)
          : null;
        const daysActive = createdAtDate
          ? Math.max(
            0,
            Math.floor((Date.now() - createdAtDate.getTime()) / DAY_IN_MS)
          )
          : 0;
        const daysLeft = campaign.ended
          ? 0
          : Math.max(CAMPAIGN_DURATION_DAYS - daysActive, 0);
        const viewsToGo =
          campaign.ratePerThousand != null
            ? campaign.totalViews === 0
              ? 1000
              : 1000 - (campaign.totalViews % 1000 || 1000)
            : null;
        const achievementPercentage = achievementMap.get(campaign.id) ?? null;

        return {
          id: campaign.id,
          title: campaign.title,
          active: campaign.active && !campaign.ended,
          ended: campaign.ended,
          imageUrl: campaign.imageUrl,
          totalEarned: campaign.totalEarned,
          totalViews: campaign.totalViews,
          pendingCount: campaign.pendingCount,
          approvedCount: campaign.approvedCount,
          rejectedCount: campaign.rejectedCount,
          totalSubmissions: campaign.totalSubmissions,
          ratePerThousand: campaign.ratePerThousand,
          viewsToGo,
          daysLeft,
          achievementPercentage,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
          platforms: Array.from(campaign.platforms).filter(Boolean),
          campaignPlatforms: campaign.campaignPlatforms,
          submissions: [...campaign.submissions],
        };
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [achievementMap, submissions]);

  const openPostsDialog = (campaign: CampaignSummary) => {
    trackEvent({
      event: "campaign_posts_card_clicked",
      properties: {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
      },
    });
    setSelectedPostsCampaign(campaign);
    setIsPostsDialogOpen(true);
  };

  const closePostsDialog = () => {
    setIsPostsDialogOpen(false);
  };

  useEffect(() => {
    if (!isPostsDialogOpen) {
      const timeout = window.setTimeout(() => {
        setSelectedPostsCampaign(null);
      }, 200);

      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [isPostsDialogOpen]);

  const openCampaignDetail = (campaign: CampaignSummary) => {
    if (!campaignDetails) return;
    trackEvent({
      event: "campaign_directions_card_clicked",
      properties: {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
      },
    });
    const match =
      campaignDetails.find((entry) => entry.id === campaign.id) || null;
    if (match) {
      setDetailCampaign(match);
      setIsDetailDialogOpen(true);
      setIsPostsDialogOpen(false);
    }
  };

  const handleDeleteRequest = (submission: Submission) => {
    trackEvent({
      event: "campaign_submission_delete_clicked",
      properties: {
        submissionId: submission.id,
        campaignId: submission.campaign_id,
        status: submission.status,
      },
    });
    setSubmissionToDelete(submission);
  };

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (!open && !deleteSubmission.isPending) {
      setSubmissionToDelete(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!submissionToDelete) return;
    trackEvent({
      event: "campaign_submission_delete_confirmed",
      properties: {
        submissionId: submissionToDelete.id,
        campaignId: submissionToDelete.campaign_id,
      },
    });
    try {
      await deleteSubmission.mutateAsync({
        submissionId: submissionToDelete.id,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const closeCampaignDetail = () => {
    setIsDetailDialogOpen(false);
    setDetailCampaign(null);
  };

  const openLeaderboard = (campaign: CampaignSummary) => {
    trackEvent({
      event: "campaign_leaderboard_card_clicked",
      properties: {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
      },
    });
    setIsPostsDialogOpen(false);
    setSelectedPostsCampaign(null);
    setLeaderboardCampaignId(campaign.id);
    setIsLeaderboardOpen(true);
  };

  const closeLeaderboard = () => {
    setIsLeaderboardOpen(false);
  };

  useEffect(() => {
    if (!isLeaderboardOpen) {
      const timeout = window.setTimeout(() => {
        setLeaderboardCampaignId(null);
      }, 200);

      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [isLeaderboardOpen]);

  const getStatusBadgeClasses = (status: string | null | undefined) => {
    switch (status?.toLowerCase()) {
      case "approved":
        return "bg-green-500/10 text-green-600 ring-1 ring-green-500/20";
      case "pending":
        return "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30";
      case "rejected":
        return "bg-red-500/10 text-red-600 ring-1 ring-red-500/20 dark:bg-red-500/20 dark:text-red-400 dark:ring-red-500/30";
      default:
        return "bg-muted text-muted-foreground ring-1 ring-border";
    }
  };

  const formatStatus = (status: string | null | undefined) => {
    if (!status) return "Unknown";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-muted-foreground">Loading campaigns...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-4 space-y-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">
            My Campaigns
          </h1>
          <p className="text-sm text-muted-foreground">
            Keep track of the campaigns you&apos;ve joined and see how your
            posts are performing.
          </p>
        </header>

        {campaigns.length === 0 ? (
          <Card className="rounded-[28px] border-dashed border-muted/80 bg-muted/20 p-10 text-center">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">
                You haven&apos;t joined any campaigns yet
              </h2>
              <p className="text-sm text-muted-foreground">
                Submit your first clip to start tracking your progress and
                earnings here.
              </p>
              <Button asChild>
                <Link
                  to="/campaigns/active"
                  onClick={() =>
                    trackEvent({
                      event: "campaign_empty_state_submit_clicked",
                      properties: {
                        source: "submissions_empty_state",
                      },
                    })
                  }
                >
                  Submit your first clip
                </Link>
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-10">
            {campaigns.map((campaign) => {
              const isLegacyCampaign =
                campaign.id === "f9e026cf-11c1-478f-b972-12e61ffc6f94" ||
                campaign.id === "7cf3e7de-73b8-4591-9de6-864ff6bfdedb";
              const minViewsRequired =
                campaignMinViewsMap.get(campaign.id) ?? null;
              const minViewsText = minViewsRequired
                ? ` (${minViewsRequired.toLocaleString()} minimum needed)`
                : "";
              const stats = [
                {
                  label: "Campaign Start",
                  value: (() => {
                    const createdAt = campaign.createdAt
                      ? new Date(campaign.createdAt)
                      : null;
                    const formatted = createdAt
                      ? createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                      : "Unknown";
                    return campaign.ended ? `${formatted} (Ended)` : formatted;
                  })(),
                },
              ];

              const rewardSummary = rewardsByCampaign.get(campaign.id);
              const lastRewardDisplay = rewardSummary?.lastRewardAt
                ? formatDateTime(rewardSummary.lastRewardAt)
                : null;

              return (
                <div key={campaign.id} className="relative">
                  <Card
                    className={cn(
                    "rounded-[36px] border border-border/40 bg-[hsl(var(--card))] shadow-[0_26px_70px_rgba(15,23,42,0.08)] transition-colors dark:border-border/20 dark:bg-[hsl(var(--card)_/_0.85)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.35)]",
                    cpmGroupRates.has(campaign.id) && "cpm-boost-card"
                  )}
                >
                  <CpmBoostBadge rate={cpmGroupRates.get(campaign.id)} />
                  <div className="flex flex-col gap-8 p-8 lg:p-10">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-4">
                        <Avatar className="h-16 w-16 ring-4 ring-black/5">
                          <AvatarImage
                            src={campaign.imageUrl}
                            alt="Campaign Logo"
                          />
                          <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">
                            {getInitials(campaign.title)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                              <h2 className="text-2xl font-semibold text-foreground">
                                {campaign.title}
                              </h2>
                            </div>
                            <Badge
                              variant="secondary"
                              className={
                                campaign.active
                                  ? "rounded-full bg-green-500/15 text-xs font-medium text-green-600"
                                  : "rounded-full bg-muted text-xs font-medium text-muted-foreground"
                              }
                            >
                              {campaign.active ? "Live" : "Inactive"}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-3">
                          {campaign.active && (
                            <Button
                              asChild
                              className="h-12 rounded-full px-6 text-base font-semibold"
                            >
                              <Link
                                to={`/campaign/${campaign.id}/submit`}
                                onClick={() =>
                                  trackEvent({
                                    event: "campaign_submit_clip_clicked",
                                    properties: {
                                      campaignId: campaign.id,
                                      campaignTitle: campaign.title,
                                    },
                                  })
                                }
                              >
                                Submit clip
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {stats.map((stat) => (
                        <div
                          key={stat.label}
                          className="rounded-[20px] border border-border/40 bg-muted/20 px-5 py-4"
                        >
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            {stat.label}
                          </p>
                          <p className="mt-2 text-xl font-semibold text-foreground">
                            {stat.value}
                          </p>
                        </div>
                      ))}

                      {isLegacyCampaign ? (
                        <div className="col-span-full rounded-[20px] border border-dashed border-border/70 bg-muted/20 px-5 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            Rewards performance stats unavailable
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Past campaigns are not eligible for rewards
                            performance statistics.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="rounded-[20px] border border-border/40 bg-muted/20 px-5 py-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              Rewarded views
                            </p>
                            <>
                              {isLoadingRewards ? (
                                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>Loading...</span>
                                </div>
                              ) : rewardSummary ? (
                                <>
                                  <p className="mt-2 text-xl font-semibold text-foreground">
                                    {/* Used to be: {rewardSummary.totalViewDelta.toLocaleString()}{" "}
                                    / {campaign.totalViews.toLocaleString()} */}
                                    {rewardSummary.totalViewDelta.toLocaleString()}
                                  </p>
                                </>
                              ) : (
                                <div className="mt-2">
                                  <p className="text-xl font-semibold text-foreground">
                                    0
                                  </p>
                                  <p className="mt-2 text-sm text-muted-foreground">
                                    {campaign.totalViews.toLocaleString()} total
                                    views
                                    {minViewsText}
                                  </p>
                                </div>
                              )}
                            </>
                          </div>

                          <div className="rounded-[20px] border border-border/40 bg-muted/20 px-5 py-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              Total rewarded
                            </p>
                            {isLoadingRewards ? (
                              <div className="flex h-24 items-center justify-center">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : rewardSummary ? (
                              <div className="mt-2 space-y-4">
                                <p className="text-2xl font-semibold text-foreground">
                                  {formatCurrency(rewardSummary.totalAmount)}
                                </p>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                    Platforms
                                  </p>
                                  {rewardSummary.platforms.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {rewardSummary.platforms.map(
                                        (platform) => (
                                          <span
                                            key={platform.platform}
                                            className="inline-flex items-center rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-black/5"
                                          >
                                            {formatPlatformName(
                                              platform.platform
                                            )}
                                            <span className="ml-2 font-semibold text-foreground">
                                              {formatCurrency(platform.amount)}
                                            </span>
                                          </span>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      No platform breakdown yet
                                    </p>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {lastRewardDisplay
                                    ? `Last reward ${lastRewardDisplay}`
                                    : "Recent reward info coming soon"}
                                </p>
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-muted-foreground">
                                No rewards yet. Keep driving views to unlock
                                payouts.
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => openCampaignDetail(campaign)}
                        className="group flex h-full flex-col justify-between rounded-[26px] border border-border/40 bg-muted/20 p-6 text-left transition-transform hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                      >
                        <div className="flex items-center justify-between text-sm font-semibold text-foreground">
                          <span>Directions and content</span>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                        </div>
                        <div className="mt-6 flex items-center gap-3 text-muted-foreground"></div>
                        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                          Access briefs, talking points, and downloadable assets
                          for this campaign.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => openPostsDialog(campaign)}
                        className="group flex h-full flex-col justify-between rounded-[26px] border border-border/40 bg-muted/20 p-6 text-left transition-transform hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                      >
                        <div className="flex items-center justify-between text-sm font-semibold text-foreground">
                          <span>My clips ({campaign.totalSubmissions})</span>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                        </div>
                        <div className="mt-6 flex flex-wrap gap-3">
                          <span className="inline-flex items-center rounded-full bg-background px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm ring-1 ring-black/5">
                            {campaign.pendingCount} Pending
                          </span>
                          <span className="inline-flex items-center rounded-full bg-background px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm ring-1 ring-black/5">
                            {campaign.approvedCount} Approved
                          </span>
                          <span className="inline-flex items-center rounded-full bg-background px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm ring-1 ring-black/5">
                            {campaign.rejectedCount} Rejected
                          </span>
                        </div>
                        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                          Track review status and keep an eye on which clips are
                          still in the queue.
                        </p>
                      </button>

                    </div>
                  </div>
                </Card>
                </div>
              );
            })}
          </div>
        )}

        {/* The other half of what a clipper submitted. Renders nothing when
            they have never posted a non-campaign clip. */}
        <MyNonCampaignClips />
      </div>

      <Dialog
        open={isPostsDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closePostsDialog();
          }
        }}
      >
        <DialogContent className="max-w-4xl space-y-6 overflow-hidden rounded-[32px] border-none p-0 shadow-2xl">
          <div className="space-y-6 px-8 py-10">
            <DialogHeader>
              <DialogTitle className="text-2xl font-semibold text-foreground">
                {selectedPostsCampaign?.title || "Campaign submissions"}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Review every post you&apos;ve submitted to this campaign.
              </DialogDescription>
            </DialogHeader>

            {selectedPostsCampaign && (
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    label: "Pending",
                    value: selectedPostsCampaign.pendingCount,
                  },
                  {
                    label: "Approved",
                    value: selectedPostsCampaign.approvedCount,
                  },
                  {
                    label: "Rejected",
                    value: selectedPostsCampaign.rejectedCount,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-border/40 bg-muted/25 px-4 py-3 text-center"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {item.label}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-foreground">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-border/40">
              {selectedPostsCampaign && sortedSubmissions.length > 0 ? (
                <div className="max-h-[60vh] overflow-y-auto">
                  <div className="hidden min-w-full lg:block">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead aria-sort={getAriaSort("views")}>
                            <button
                              type="button"
                              onClick={() => handlePostsSort("views")}
                              className="flex w-full items-center gap-1 text-left text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <span>Views</span>
                              {renderSortIcon("views")}
                            </button>
                          </TableHead>
                          <TableHead aria-sort={getAriaSort("platform")}>
                            <button
                              type="button"
                              onClick={() => handlePostsSort("platform")}
                              className="flex w-full items-center gap-1 text-left text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <span>Platform</span>
                              {renderSortIcon("platform")}
                            </button>
                          </TableHead>
                          {/* <TableHead className="w-32">Reward</TableHead> */}
                          <TableHead
                            className="whitespace-nowrap"
                            aria-sort={getAriaSort("created")}
                          >
                            <button
                              type="button"
                              onClick={() => handlePostsSort("created")}
                              className="flex w-full items-center gap-1 text-left text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <span>Created</span>
                              {renderSortIcon("created")}
                            </button>
                          </TableHead>
                          <TableHead>Link</TableHead>
                          <TableHead>Note</TableHead>
                          <TableHead aria-sort={getAriaSort("status")}>
                            <button
                              type="button"
                              onClick={() => handlePostsSort("status")}
                              className="flex w-full items-center gap-1 text-left text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <span>Status</span>
                              {renderSortIcon("status")}
                            </button>
                          </TableHead>
                          <TableHead className="w-12 text-right">
                            <span className="sr-only">Delete</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedSubmissions.map((submission) => (
                          <TableRow key={submission.id}>
                            <TableCell className="font-medium">
                              {submission.views?.toLocaleString() ?? 0}
                            </TableCell>
                            <TableCell className="capitalize text-sm text-muted-foreground">
                              {formatPlatformLabel(submission.platform) || "—"}
                            </TableCell>
                            {/* <TableCell>
                              {formatCurrency(submission.reward ?? 0)}
                            </TableCell> */}
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {submission.created_at
                                ? new Date(
                                  submission.created_at
                                ).toLocaleString()
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {submission.url ? (
                                <a
                                  href={submission.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() =>
                                    trackEvent({
                                      event:
                                        "campaign_submission_view_post_clicked",
                                      properties: {
                                        campaignId:
                                          selectedPostsCampaign?.id ?? null,
                                        submissionId: submission.id,
                                        platform: submission.platform,
                                      },
                                    })
                                  }
                                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                >
                                  View
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  No link provided
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {submission.rejectedReason
                                ? submission.rejectedReason
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-1">
                                <Badge
                                  variant="outline"
                                  className={getStatusBadgeClasses(
                                    submission.status
                                  )}
                                >
                                  {formatStatus(submission.status)}
                                </Badge>
                                {submission.baselineFrozenViews != null && (
                                  <Badge
                                    variant="outline"
                                    className="border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-100"
                                    title={`${submission.baselineFrozenViews.toLocaleString()} views frozen — this clip's reward was reclaimed and no longer earns`}
                                  >
                                    Views frozen
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {submission.status === "pending" ? (
                                <button
                                  type="button"
                                  aria-label="Delete submission"
                                  onClick={() =>
                                    handleDeleteRequest(submission)
                                  }
                                  disabled={deleteSubmission.isPending}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deleteSubmission.isPending &&
                                    submissionToDelete?.id === submission.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="grid gap-4 p-4 lg:hidden">
                    {sortedSubmissions.map((submission) => (
                      <div
                        key={submission.id}
                        className="rounded-2xl border border-border/40 bg-background p-4 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-muted-foreground">
                            {formatPlatformLabel(submission.platform) || "—"}
                          </span>
                          <div className="flex items-center gap-2">
                            {submission.status === "pending" ? (
                              <button
                                type="button"
                                aria-label="Delete submission"
                                onClick={() => handleDeleteRequest(submission)}
                                disabled={deleteSubmission.isPending}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deleteSubmission.isPending &&
                                  submissionToDelete?.id === submission.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            ) : null}
                            <Badge
                              variant="outline"
                              className={getStatusBadgeClasses(
                                submission.status
                              )}
                            >
                              {formatStatus(submission.status)}
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                          <span className="font-semibold text-foreground">
                            {submission.views?.toLocaleString() ?? 0} views
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {submission.created_at
                            ? new Date(submission.created_at).toLocaleString()
                            : "Date unavailable"}
                        </p>
                        {submission.url ? (
                          <a
                            href={submission.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                          >
                            View post
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : (
                          <span className="mt-3 inline-block text-sm text-muted-foreground">
                            No link provided
                          </span>
                        )}
                        {submission.status === "rejected" &&
                          submission.rejectedReason && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Note: {submission.rejectedReason ?? "-"}
                            </p>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  You haven&apos;t submitted any posts to this campaign yet.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(submissionToDelete)}
        onOpenChange={handleDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your pending submission from the campaign. You
              can submit the clip again later if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmission.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteSubmission.isPending}
            >
              {deleteSubmission.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={isLeaderboardOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeLeaderboard();
          }
        }}
      >
        <DialogContent className="max-w-5xl overflow-hidden rounded-[32px] border-0 p-0 shadow-2xl">
          <div className="flex max-h-[85vh] flex-col">
            <div className="space-y-4 border-b px-8 py-6">
              <DialogHeader className="space-y-1">
                <DialogTitle className="text-2xl font-semibold text-foreground">
                  Campaign leaderboard
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Top performing clips from this campaign.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 w-full flex flex-col items-center">
              {leaderboardCampaignId ? (
                <div className="w-full">
                  <Leaderboard campaignId={leaderboardCampaignId} />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a campaign to view the leaderboard.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CampaignDetailDialog
        open={isDetailDialogOpen}
        campaign={detailCampaign}
        onOpenChange={(open) => {
          if (!open) {
            closeCampaignDetail();
          }
        }}
      />
    </AppLayout>
  );
};

export default Submissions;
