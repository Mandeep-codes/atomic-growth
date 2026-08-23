import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { inferRouterOutputs } from "@trpc/server";
import {
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RewardEligibleUserSelect } from "@/components/RewardEligibleUserSelect";
import {
  formatRewardEligibleUserLabel,
  type RewardEligibleUser,
} from "@/lib/rewardUsers";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatPlatformLabel, timeAgo } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRole } from "@/hooks/useRole";
import type { AppRouter } from "../../../backend/src/routers";

const formatDateTime = (value?: Date | string | null) => {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatPhoneNumber = (
  phoneNumber?: string | null,
  phoneCountryCode?: string | null
) => {
  if (!phoneNumber) return "No phone number";
  const trimmedNumber = phoneNumber.trim();
  const trimmedCode = phoneCountryCode?.trim();
  if (!trimmedNumber) return "No phone number";
  return trimmedCode ? `${trimmedCode} ${trimmedNumber}` : trimmedNumber;
};

const getInitials = (
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string
) => {
  const source =
    `${firstName ?? ""}${lastName ?? ""}`.trim() || fallback || "?";
  return source
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const statusStyles: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  rejected: "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
  pending: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  active: "bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800",
  created: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-800",
  "needs-human-review": "bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800",
  cancelled: "bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:border-zinc-800",
  autoreject: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
};

const statusLabels: Record<string, string> = {
  autoreject: "Auto-rejected",
};

const MIN_USER_SEARCH_CHARS = 2;

type UserActivity = inferRouterOutputs<AppRouter>["user"]["getActivity"];

type EarningsEntry = UserActivity["earnings"]["entries"][number];

type HandleRecord = UserActivity["handles"][number];
type HandlePlatform = "youtube" | "instagram" | "tiktok" | "x";

type HandleBanControlsProps = {
  handle: HandleRecord;
  onBan: (params: {
    platform: HandlePlatform;
    handle: string;
    reason?: string;
  }) => void;
  onUnban: (params: { platform: HandlePlatform; handle: string }) => void;
  isBanLoading: boolean;
  isUnbanLoading: boolean;
};

const HandleBanControls = ({
  handle,
  onBan,
  onUnban,
  isBanLoading,
  isUnbanLoading,
}: HandleBanControlsProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setReason("");
    }
  };

  const handleBan = () => {
    if (!reason.trim()) return;
    onBan({
      platform: handle.platform as HandlePlatform,
      handle: handle.handle,
      reason: reason.trim(),
    });
  };

  const handleUnban = () => {
    onUnban({
      platform: handle.platform as HandlePlatform,
      handle: handle.handle,
    });
  };

  if (handle.banStatus) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={isUnbanLoading}>
            {isUnbanLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Lifting ban…
              </span>
            ) : (
              "Lift ban"
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore handle access?</AlertDialogTitle>
            <AlertDialogDescription>
              {handle.handle} on {formatPlatformLabel(handle.platform)} will be
              allowed to submit again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnbanLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleUnban} disabled={isUnbanLoading}>
              {isUnbanLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Restoring…
                </span>
              ) : (
                "Lift ban"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" disabled={isBanLoading}>
          {isBanLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Banning…
            </span>
          ) : (
            "Ban handle"
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban handle?</AlertDialogTitle>
          <AlertDialogDescription>
            Prevent @{handle.handle} on {formatPlatformLabel(handle.platform)}
            from submitting future clips.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`ban-reason-${handle.id}`}>
            Reason to ban <span className="text-red-600">(required)</span>
          </Label>
          <Textarea
            id={`ban-reason-${handle.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Duplicate submissions, spam, etc."
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBanLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleBan}
            disabled={isBanLoading || !reason.trim()}
          >
            {isBanLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Banning…
              </span>
            ) : (
              "Ban handle"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const AdminUserActivity = () => {
  const [searchParams] = useSearchParams();
  const userIdFromUrl = searchParams.get("userId") ?? "";
  const [selectedUserId, setSelectedUserId] = useState(userIdFromUrl);
  const [selectedUser, setSelectedUser] = useState<RewardEligibleUser | null>(
    null
  );

  // Allow deep-linking directly to a user: /admin/user-activity?userId=...
  // Useful for sharing links in Discord/Slack and for QA setups.
  useEffect(() => {
    if (userIdFromUrl && userIdFromUrl !== selectedUserId) {
      setSelectedUserId(userIdFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdFromUrl]);
  const [handleQuery, setHandleQuery] = useState("");
  const [lookupHandle, setLookupHandle] = useState("");
  const [userSearchInput, setUserSearchInput] = useState("");
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [isBanUserDialogOpen, setIsBanUserDialogOpen] = useState(false);
  const [userBanReason, setUserBanReason] = useState("");
  // Campaigns to strip the user out of on ban. Empty = ban going forward only.
  const [purgeCampaignIds, setPurgeCampaignIds] = useState<string[]>([]);
  // Campaigns a mod has ticked to reinstate when lifting the ban. Separate
  // from purgeCampaignIds: a clipper may have been fairly removed from one
  // campaign and unfairly from another, so the two lists rarely match.
  const [repayCampaignIds, setRepayCampaignIds] = useState<string[]>([]);
  const debouncedUserSearch = useDebouncedValue(userSearchInput, 400);
  const trimmedUserSearch = debouncedUserSearch.trim();
  const shouldFetchUsers = trimmedUserSearch.length >= MIN_USER_SEARCH_CHARS;
  const {
    data: searchedUsers = [],
    isFetching: isSearchingUsers,
    error: usersError,
  } = trpc.user.listUsers.useQuery(
    { query: trimmedUserSearch, limit: 20 },
    { enabled: shouldFetchUsers }
  );
  const rewardUsers = shouldFetchUsers ? searchedUsers : [];
  const usersErrorMessage =
    usersError && shouldFetchUsers ? "Failed to search users" : undefined;

  const {
    data: activityData,
    isLoading: isLoadingActivity,
    isFetching: isFetchingActivity,
    error: activityError,
  } = trpc.user.getActivity.useQuery(
    { userId: selectedUserId },
    { enabled: Boolean(selectedUserId) }
  );

  const isActivityPending = isLoadingActivity || isFetchingActivity;
  const handles = activityData?.handles ?? [];
  const submissions = activityData?.submissions ?? [];
  const totalSubmissions = activityData?.totalSubmissions ?? submissions.length;
  const autoRejectCount = activityData?.autoRejectCount ?? 0;
  const earningsEntries = activityData?.earnings.entries ?? [];
  const demographicsVerifications =
    activityData?.demographicsVerifications ?? [];
  const [earningsExpanded, setEarningsExpanded] = useState(false);
  const userBanStatus = activityData?.user.banStatus ?? null;
  const postCampaignDeletedClips =
    activityData?.postCampaignDeletedClips ?? [];

  const { roles } = useRole();
  const canRestore =
    roles.includes("rewards-modifier") || roles.includes("god-mode");
  // Bank details (masked) are visible to anyone who can see this page.
  const canSeeBank =
    roles.includes("user-activity-read") || roles.includes("god-mode");

  // Live-from-Wise override. bank_accounts is a stale snapshot (last written
  // Nov 2025), so mods get a button to read the CURRENT recipient from Wise.
  const [liveBank, setLiveBank] = useState<
    | (NonNullable<
        inferRouterOutputs<AppRouter>["user"]["refreshBankDetails"]["details"]
      > & { fetchedAt: string })
    | null
  >(null);
  useEffect(() => {
    setLiveBank(null);
  }, [selectedUserId]);

  const refreshBank = trpc.user.refreshBankDetails.useMutation({
    onSuccess: (res) => {
      if (res.ok && res.details) {
        setLiveBank(res.details as never);
        toast({
          title: "Bank details refreshed",
          description: "Fetched live from Wise.",
        });
      } else {
        setLiveBank(null);
        toast({
          title: "Couldn't refresh",
          description: res.message ?? "Wise returned no details.",
          variant: "destructive",
        });
      }
      void bankDetailsQuery.refetch();
    },
    onError: (e) =>
      toast({
        title: "Couldn't refresh",
        description: e.message,
        variant: "destructive",
      }),
  });

  const bankDetailsQuery = trpc.user.getBankDetails.useQuery(
    { userId: selectedUserId },
    { enabled: Boolean(selectedUserId) && canSeeBank }
  );
  // Live Wise data wins while it's on screen; otherwise the cached row.
  const bankDetails = liveBank ?? bankDetailsQuery.data ?? null;

  const lookupHandleQuery = trpc.user.lookupByHandle.useQuery(
    { handle: lookupHandle },
    { enabled: Boolean(lookupHandle) }
  );

  const handleLookupSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = handleQuery.trim();
    if (!trimmed) return;
    if (trimmed === lookupHandle) {
      await lookupHandleQuery.refetch();
    } else {
      setLookupHandle(trimmed);
    }
  };

  const handleLookupResult = lookupHandleQuery.data ?? null;
  const lookupError = lookupHandleQuery.error;
  const isLookupLoading = lookupHandleQuery.isFetching && Boolean(lookupHandle);

  const invalidateActivity = async () => {
    if (selectedUserId) {
      await utils.user.getActivity.invalidate({ userId: selectedUserId });
    }
  };

  const restoreMutation = trpc.submissions.restoreDeletedSubmission.useMutation({
    onSuccess: async (res) => {
      await invalidateActivity();
      toast({
        title: "Clip restored",
        description:
          res.restoredAmount > 0
            ? `Re-credited $${res.restoredAmount.toFixed(2)} and reinstated the reward.`
            : "Clip is active again.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Restore failed",
        description: error.message,
      });
    },
  });

  const restoreAccountMutation = trpc.user.restoreAccount.useMutation({
    onSuccess: async (res) => {
      await invalidateActivity();
      toast({
        title: "Account restored",
        description: `Re-activated the account and restored ${res.restoredClips} of its clip(s).`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Restore failed",
        description: error.message,
      });
    },
  });

  const manualClawbackMutation = trpc.user.manualClawbackDeletedClip.useMutation(
    {
      onSuccess: async (res) => {
        await invalidateActivity();
        toast({
          title: res.alreadyClawedBack
            ? "Already clawed back"
            : "Money clawed back",
          description: res.alreadyClawedBack
            ? "This clip's reward was already removed."
            : `Removed $${res.clawedBack.toFixed(2)} from the clipper's balance (can go negative).`,
        });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Clawback failed",
          description: error.message,
        });
      },
    }
  );

  const requeueAutoRejectsMutation =
    trpc.user.requeueAutoRejectedSubmissions.useMutation({
      onSuccess: async (result) => {
        await invalidateActivity();
        toast({
          title: "Sent back for moderator review",
          description: `${result.updatedCount} auto-rejected ${
            result.updatedCount === 1 ? "clip is" : "clips are"
          } now in the moderator queue.`,
        });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Failed to requeue clips",
          description: error.message,
        });
      },
    });

  // What a purge would strip out, per campaign. Only fetched once the ban
  // dialog is actually open — it's a heavier aggregate than the page needs.
  const banPurgePreview = trpc.user.banPurgePreview.useQuery(
    { userId: selectedUserId },
    { enabled: isBanUserDialogOpen && Boolean(selectedUserId) }
  );

  // What a ban purge took, per campaign, and what lifting the ban would give
  // back. The unban dialog is uncontrolled (AlertDialogTrigger opens it), so
  // there is no open-state to gate on; it is fetched with the selected user
  // instead. Cheap when there is nothing to repay — the query returns no rows
  // for a user who was never purged, which is the common case.
  const unbanRepayPreview = trpc.user.unbanRepayPreview.useQuery(
    { userId: selectedUserId },
    { enabled: Boolean(selectedUserId) }
  );
  // Detach a connected social account. Unlike a ban this touches no money —
  // the clips and their history stay exactly as they are.
  const unlinkAccountMutation = trpc.user.adminUnlinkAccount.useMutation({
    onSuccess: async (data) => {
      await invalidateActivity();
      toast({
        title: "Account unlinked",
        description: `@${data.handle} (${data.platform}) is no longer connected. Its clips and history are unchanged.`,
      });
    },
    onError: (error) =>
      toast({
        title: "Could not unlink account",
        description: error.message,
        variant: "destructive",
      }),
  });

  const banUserMutation = trpc.user.banUser.useMutation({
    onSuccess: async (data) => {
      await invalidateActivity();
      const purged = data?.purged ?? [];

      // Crypto claims needing a human: either the cancel failed outright, or
      // it deliberately skipped one already sitting in a payout batch (the
      // money may already have been hand-sent). Both leave a live claim that
      // the payout picker now hides, so nobody would otherwise notice.
      if (data?.cryptoCancelFailed) {
        toast({
          variant: "destructive",
          title: "Check their crypto claims",
          description:
            "The ban applied, but cancelling their crypto claims failed. Check the Crypto Payouts panel manually.",
        });
      } else if ((data?.cryptoClaimsNeedingReview ?? []).length > 0) {
        toast({
          variant: "destructive",
          title: "Crypto claim already in a batch",
          description: `${
            data.cryptoClaimsNeedingReview.length
          } claim(s) were left alone because they are already batched — the crypto may have been sent. Reconcile them by hand.`,
        });
      }

      if (purged.length > 0) {
        const clips = purged.reduce((sum, p) => sum + p.clips, 0);
        // Report what THIS ban removed, not the change in campaigns.achieved.
        // The recompute also absorbs unrelated drift that had accumulated
        // since the campaign was last totalled, so quoting its delta would
        // credit this one ban with other clippers' movements.
        const money = purged.reduce((sum, p) => sum + p.rewardRemoved, 0);
        const views = purged.reduce((sum, p) => sum + p.viewsRemoved, 0);
        toast({
          title: "User banned and purged",
          description: `${clips} clip(s), ${views.toLocaleString()} views and $${money.toFixed(
            2
          )} taken off ${purged.length} campaign(s).`,
        });
      } else {
        toast({
          title: "User banned",
          description: "They will no longer be able to sign in or earn.",
        });
      }
      setUserBanReason("");
      setPurgeCampaignIds([]);
      setIsBanUserDialogOpen(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Failed to ban user",
        description: error.message,
      });
    },
  });

  const unbanUserMutation = trpc.user.unbanUser.useMutation({
    onSuccess: async () => {
      await invalidateActivity();
      toast({
        title: "User reinstated",
        description: "Their login has been restored.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Failed to lift ban",
        description: error.message,
      });
    },
  });

  const banHandleMutation = trpc.user.banHandle.useMutation({
    onSuccess: async (_, variables) => {
      await invalidateActivity();
      toast({
        title: "Handle banned",
        description: `@${variables?.handle} can no longer submit.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Failed to ban handle",
        description: error.message,
      });
    },
  });

  const unbanHandleMutation = trpc.user.unbanHandle.useMutation({
    onSuccess: async (_, variables) => {
      await invalidateActivity();
      toast({
        title: "Handle restored",
        description: `@${variables?.handle} can submit again.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Failed to lift handle ban",
        description: error.message,
      });
    },
  });

  const handleBanUser = () => {
    if (!selectedUserId || !userBanReason.trim()) return;
    banUserMutation.mutate({
      userId: selectedUserId,
      reason: userBanReason.trim(),
      purgeCampaignIds,
    });
  };

  const togglePurgeCampaign = (campaignId: string) => {
    setPurgeCampaignIds((prev) =>
      prev.includes(campaignId)
        ? prev.filter((id) => id !== campaignId)
        : [...prev, campaignId]
    );
  };

  const handleUnbanUser = () => {
    if (!selectedUserId) return;
    unbanUserMutation.mutate({ userId: selectedUserId, repayCampaignIds });
  };

  const handleBanHandle = ({
    platform,
    handle,
    reason,
  }: {
    platform: HandlePlatform;
    handle: string;
    reason?: string;
  }) => {
    banHandleMutation.mutate({ platform, handle, reason });
  };

  const handleUnbanHandle = ({
    platform,
    handle,
  }: {
    platform: HandlePlatform;
    handle: string;
  }) => {
    unbanHandleMutation.mutate({ platform, handle });
  };

  const getIsHandleBanLoading = (platform: string, handle: string) =>
    banHandleMutation.isPending &&
    banHandleMutation.variables?.platform === platform &&
    banHandleMutation.variables?.handle === handle;

  const getIsHandleUnbanLoading = (platform: string, handle: string) =>
    unbanHandleMutation.isPending &&
    unbanHandleMutation.variables?.platform === platform &&
    unbanHandleMutation.variables?.handle === handle;

  const renderStatusBadge = (status?: string | null) => {
    if (!status) {
      return <Badge variant="outline">Unknown</Badge>;
    }
    const normalized = status.toLowerCase();
    const className = statusStyles[normalized] ?? "bg-muted text-foreground";
    const label =
      statusLabels[normalized] ??
      normalized.charAt(0).toUpperCase() + normalized.slice(1);
    return (
      <Badge variant="outline" className={className}>
        {label}
      </Badge>
    );
  };

  const formatApprovalMethod = (method?: string | null) => {
    if (!method) return "—";
    const normalized = method.toLowerCase();
    if (normalized === "api") {
      return "API";
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const renderEarningsEntry = (entry: EarningsEntry) => {
    return (
      <TableRow key={entry.id}>
        <TableCell className="font-medium">
          {formatCurrency(entry.amount, { maximumFractionDigits: 2 })}
        </TableCell>
        <TableCell className="capitalize">
          {entry.type.replace("_", " ")}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {entry.memo ?? "—"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {formatDateTime(entry.createdAt)}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">
            User activity
          </h1>
          <p className="text-muted-foreground">
            Inspect a user’s submissions, verified handles, and earnings without
            leaving the dashboard.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Select a user</CardTitle>
              <CardDescription>
                Pick anyone who has logged in before to load their latest data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <RewardEligibleUserSelect
                  users={rewardUsers}
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                  onUserSelected={(user) => {
                    setSelectedUser(user);
                    setUserSearchInput("");
                  }}
                  selectedUser={selectedUser}
                  searchQuery={userSearchInput}
                  onSearchQueryChange={setUserSearchInput}
                  isSearching={isSearchingUsers}
                  minSearchChars={MIN_USER_SEARCH_CHARS}
                  errorMessage={usersErrorMessage}
                />
              </div>
              {selectedUser && (
                <div className="flex items-center gap-4 rounded-lg border bg-muted/40 p-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage
                      src={selectedUser.imageUrl ?? undefined}
                      alt=""
                    />
                    <AvatarFallback>
                      {getInitials(
                        selectedUser.firstName,
                        selectedUser.lastName,
                        selectedUser.email ?? selectedUser.discordId
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {formatRewardEligibleUserLabel(selectedUser)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedUser.email ?? "No email on file"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Look up by handle</CardTitle>
              <CardDescription>
                Search the verified handles table to find the associated user.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={handleLookupSubmit}
              >
                <Input
                  value={handleQuery}
                  onChange={(event) => setHandleQuery(event.target.value)}
                  placeholder="@username or username"
                />
                <Button
                  type="submit"
                  disabled={isLookupLoading || !handleQuery.trim()}
                >
                  {isLookupLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search className="h-4 w-4" /> Look up
                    </span>
                  )}
                </Button>
              </form>
              {lookupError && (
                <Alert variant="destructive">
                  <AlertTitle>Lookup failed</AlertTitle>
                  <AlertDescription>{lookupError.message}</AlertDescription>
                </Alert>
              )}
              {lookupHandle &&
                lookupHandleQuery.status === "success" &&
                !handleLookupResult && (
                  <p className="text-sm text-muted-foreground">
                    No handle matched “{lookupHandle}”.
                  </p>
                )}
              {handleLookupResult && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        @{handleLookupResult.handle.handle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {handleLookupResult.handle.username}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {formatPlatformLabel(handleLookupResult.handle.platform)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>
                      Updated {timeAgo(handleLookupResult.handle.updatedAt)}
                    </span>
                    {handleLookupResult.handle.discordId && (
                      <span>
                        Discord ID: {handleLookupResult.handle.discordId}
                      </span>
                    )}
                  </div>
                  {handleLookupResult.user ? (
                    <div className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium">
                          {formatRewardEligibleUserLabel(
                            handleLookupResult.user
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {handleLookupResult.user.email ?? "No email"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!handleLookupResult.user) return;
                          setSelectedUserId(handleLookupResult.user.discordId);
                          setSelectedUser(handleLookupResult.user);
                          setUserSearchInput("");
                        }}
                      >
                        Load activity
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This handle is not linked to a known Clerk user.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {!selectedUserId ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Choose a user to view submissions, handles, and payouts.
            </CardContent>
          </Card>
        ) : activityError ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load activity</AlertTitle>
            <AlertDescription>{activityError.message}</AlertDescription>
          </Alert>
        ) : isActivityPending && !activityData ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching latest
              activity…
            </CardContent>
          </Card>
        ) : activityData ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>User overview</CardTitle>
                <CardDescription>
                  Synced from Clerk and Discord metadata.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Avatar className="h-16 w-16">
                    <AvatarImage
                      src={activityData.user.imageUrl ?? undefined}
                      alt=""
                    />
                    <AvatarFallback>
                      {getInitials(
                        activityData.user.firstName,
                        activityData.user.lastName,
                        activityData.user.email ?? activityData.user.discordId
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-lg font-semibold">
                      {formatRewardEligibleUserLabel({
                        discordId: activityData.user.discordId,
                        email: activityData.user.email,
                        firstName: activityData.user.firstName,
                        lastName: activityData.user.lastName,
                      })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Discord: {activityData.user.discordUsername || "Unknown"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Phone: {formatPhoneNumber(
                        activityData.user.phoneNumber,
                        activityData.user.phoneCountryCode
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Joined {formatDateTime(activityData.user.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Ban status
                      </p>
                      {userBanStatus ? (
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-destructive">
                            Banned on {formatDateTime(userBanStatus.createdAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {userBanStatus.reason ?? "No reason provided"}
                            {userBanStatus.createdBy && (
                              <> • By {userBanStatus.createdBy}</>
                            )}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm font-semibold text-emerald-600">
                          Active
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {userBanStatus ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={unbanUserMutation.isPending}
                            >
                              {unbanUserMutation.isPending ? (
                                <span className="flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Restoring…
                                </span>
                              ) : (
                                "Lift ban"
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Lift this ban?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                The user will be allowed to log back in. Tick
                                any campaign whose clips and earnings should be
                                reinstated — leaving them all unticked lifts the
                                ban without returning money.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            {unbanRepayPreview.data &&
                              unbanRepayPreview.data.length > 0 && (
                                <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
                                  {unbanRepayPreview.data.map((c) => (
                                    <label
                                      key={c.campaignId}
                                      className="flex cursor-pointer items-start gap-3 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={repayCampaignIds.includes(
                                          c.campaignId
                                        )}
                                        onChange={(e) =>
                                          setRepayCampaignIds((prev) =>
                                            e.target.checked
                                              ? [...prev, c.campaignId]
                                              : prev.filter(
                                                  (id) => id !== c.campaignId
                                                )
                                          )
                                        }
                                      />
                                      <span className="flex-1">
                                        <span className="font-medium">
                                          {c.campaignTitle}
                                        </span>
                                        {!c.isLive && (
                                          <span className="ml-2 text-xs text-muted-foreground">
                                            not live
                                          </span>
                                        )}
                                        <span className="block text-xs text-muted-foreground">
                                          {c.clips} clip(s) · $
                                          {c.reward.toFixed(2)} to return
                                        </span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            <AlertDialogFooter>
                              <AlertDialogCancel
                                disabled={unbanUserMutation.isPending}
                              >
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleUnbanUser}
                                disabled={unbanUserMutation.isPending}
                              >
                                {unbanUserMutation.isPending ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Restoring…
                                  </span>
                                ) : (
                                  "Lift ban"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <AlertDialog
                          open={isBanUserDialogOpen}
                          onOpenChange={(open) => {
                            setIsBanUserDialogOpen(open);
                            if (!open) {
                              setUserBanReason("");
                              setPurgeCampaignIds([]);
                            }
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={
                                !selectedUserId || banUserMutation.isPending
                              }
                            >
                              {banUserMutation.isPending ? (
                                <span className="flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Banning…
                                </span>
                              ) : (
                                "Ban user"
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Ban this user?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                They will be signed out immediately, blocked
                                from logging in, and their clips will stop
                                earning on every campaign from this moment on.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="space-y-2">
                              <Label htmlFor="ban-user-reason">
                                Reason to ban{" "}
                                <span className="text-red-600">(required)</span>
                              </Label>
                              <Textarea
                                id="ban-user-reason"
                                value={userBanReason}
                                onChange={(event) =>
                                  setUserBanReason(event.target.value)
                                }
                                placeholder="Spam submissions, fake views, etc."
                                rows={3}
                              />
                            </div>

                            {/* Optional retroactive purge. Unticked = ban
                                going forward only, history left alone. */}
                            <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                              <div>
                                <p className="text-sm font-semibold text-rose-800">
                                  Also wipe them from past campaigns?
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Tick a campaign to reject their clips there,
                                  pull those views and dollars back out of the
                                  campaign progress, and claw the money out of
                                  their wallet. Leave everything unticked to
                                  just ban them going forward — either way
                                  their clips stop earning immediately.
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Ended campaigns aren't listed. Their totals
                                  are already settled and reopening them would
                                  disturb other clippers' paid money.
                                </p>
                              </div>

                              {banPurgePreview.isLoading ? (
                                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Working out what they have earned…
                                </div>
                              ) : (banPurgePreview.data ?? []).length === 0 ? (
                                <p className="py-1 text-sm text-muted-foreground">
                                  Nothing to remove — they hold no counting
                                  clips or money on any campaign.
                                </p>
                              ) : (
                                <div className="max-h-56 space-y-1 overflow-y-auto">
                                  {(banPurgePreview.data ?? []).map((c) => (
                                    <label
                                      key={c.campaignId}
                                      className="flex cursor-pointer items-center gap-3 rounded-md border bg-background p-2 hover:bg-muted/50"
                                    >
                                      <Checkbox
                                        checked={purgeCampaignIds.includes(
                                          c.campaignId
                                        )}
                                        onCheckedChange={() =>
                                          togglePurgeCampaign(c.campaignId)
                                        }
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                          <span className="truncate text-sm font-medium">
                                            {c.campaignTitle}
                                          </span>
                                          {c.isLive ? (
                                            <Badge
                                              variant="outline"
                                              className="shrink-0 text-[10px]"
                                            >
                                              live
                                            </Badge>
                                          ) : null}
                                        </span>
                                        <span className="block text-xs text-muted-foreground">
                                          {c.clips} clip
                                          {c.clips === 1 ? "" : "s"} ·{" "}
                                          {c.views.toLocaleString()} views ·{" "}
                                          <span className="font-medium text-rose-700">
                                            ${c.reward.toFixed(2)}
                                          </span>
                                        </span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              )}

                              {purgeCampaignIds.length > 0 ? (
                                <p className="rounded-md bg-rose-100 p-2 text-xs text-rose-900">
                                  <span className="font-semibold">
                                    Removing{" "}
                                    {(banPurgePreview.data ?? [])
                                      .filter((c) =>
                                        purgeCampaignIds.includes(c.campaignId)
                                      )
                                      .reduce((s, c) => s + c.views, 0)
                                      .toLocaleString()}{" "}
                                    views and $
                                    {(banPurgePreview.data ?? [])
                                      .filter((c) =>
                                        purgeCampaignIds.includes(c.campaignId)
                                      )
                                      .reduce((s, c) => s + c.reward, 0)
                                      .toFixed(2)}
                                    .
                                  </span>{" "}
                                  If they already withdrew it their balance goes
                                  negative. This is not undone by unbanning.
                                </p>
                              ) : null}
                            </div>

                            <AlertDialogFooter>
                              <AlertDialogCancel
                                disabled={banUserMutation.isPending}
                              >
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleBanUser}
                                disabled={
                                  banUserMutation.isPending ||
                                  !userBanReason.trim()
                                }
                              >
                                {banUserMutation.isPending ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Banning…
                                  </span>
                                ) : (
                                  "Ban user"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">Submissions</p>
                    <p className="text-2xl font-semibold">{totalSubmissions}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    {/* Counted every linked row while calling them all
                        "Verified handles", so a user with one verified and one
                        half-finished account read as two verified accounts. */}
                    <p className="text-sm text-muted-foreground">
                      Linked accounts
                    </p>
                    <p className="text-2xl font-semibold">{handles.length}</p>
                    {handles.some((handle) => !handle.verified) && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {handles.filter((handle) => handle.verified).length}{" "}
                        verified
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">
                      Current balance
                    </p>
                    <p className="text-2xl font-semibold">
                      {formatCurrency(activityData.earnings.currentBalance)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">
                      Total earned
                    </p>
                    <p className="text-2xl font-semibold">
                      {formatCurrency(activityData.earnings.totalEarned)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Linked social accounts</CardTitle>
                  <CardDescription>
                    Every account this user has started linking — not only the
                    verified ones. An account without the green "Verified" mark
                    cannot submit clips and does not appear on the user's own
                    verification page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {handles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No social accounts are linked to this user.
                    </p>
                  ) : (
                    handles.map((handle) => (
                      <div
                        key={handle.id}
                        className="rounded-lg border bg-muted/30 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">
                              @{handle.handle}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-2 h-6 px-2 text-xs text-destructive"
                                disabled={unlinkAccountMutation.isPending}
                                onClick={() =>
                                  unlinkAccountMutation.mutate({
                                    verifiedUserId: handle.id,
                                  })
                                }
                              >
                                Unlink
                              </Button>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {handle.username}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {formatPlatformLabel(handle.platform)}
                            </Badge>
                            {/* Unverified rows used to render with NOTHING here
                                — the only signal was the green "Verified" text
                                further down being absent. Under a card titled
                                "Verified handles", with an Unlink button beside
                                it, that reads as connected, which is why users
                                get told their account is linked while the app
                                correctly refuses their clips. Say it outright. */}
                            {!handle.verified && (
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-600 dark:text-amber-400"
                              >
                                Not verified
                              </Badge>
                            )}
                            {handle.banStatus && (
                              <Badge variant="destructive">Banned</Badge>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Updated {timeAgo(handle.updatedAt)}</span>
                          {handle.verified ? (
                            <span className="font-medium text-emerald-600">
                              Verified
                            </span>
                          ) : (
                            // What the mod needs to tell the clipper. Without
                            // this they can only see that something is wrong,
                            // not what unblocks it.
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              Awaiting bio-code verification — cannot submit yet
                            </span>
                          )}
                        </div>
                        <div className="mt-4 grid gap-3 text-xs">
                          {handle.loginCredsUserId && (
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                Login user ID
                              </span>
                              <span className="font-mono text-sm text-foreground break-all">
                                {handle.loginCredsUserId}
                              </span>
                            </div>
                          )}
                          {handle.verificationMethod && (
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                Verification method
                              </span>
                              <span className="font-medium text-foreground">
                                {handle.verificationMethod}
                              </span>
                            </div>
                          )}
                          {handle.loginCredsEmail && (
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                Login email
                              </span>
                              <span className="font-mono text-sm text-foreground break-all">
                                {handle.loginCredsEmail}
                              </span>
                            </div>
                          )}
                          {handle.loginCredsPassword && (
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                Login password
                              </span>
                              <span className="font-mono text-sm text-foreground break-all">
                                {handle.loginCredsPassword}
                              </span>
                            </div>
                          )}
                          {handle.loginCredsForwardingEmail && (
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                Forwarding email
                              </span>
                              <span className="font-mono text-sm text-foreground break-all">
                                {handle.loginCredsForwardingEmail}
                              </span>
                            </div>
                          )}
                          {handle.loginCredsManuallyVerifiedAt && (
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                Manually verified
                              </span>
                              <span className="text-foreground">
                                {formatDateTime(
                                  handle.loginCredsManuallyVerifiedAt
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                        {handle.banStatus && (
                          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                            <p className="font-semibold text-destructive">
                              Banned on{" "}
                              {formatDateTime(handle.banStatus.createdAt)}
                            </p>
                            <p className="text-muted-foreground">
                              {handle.banStatus.reason ?? "No reason provided"}
                              {handle.banStatus.createdBy && (
                                <> • By {handle.banStatus.createdBy}</>
                              )}
                            </p>
                          </div>
                        )}
                        {handle.accountDeletedAt && (
                          <div className="mt-4 flex flex-col gap-2 rounded-md border border-amber-400/50 bg-amber-50 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-amber-800">
                                Account marked unavailable (
                                {handle.accountUnavailableStrikes ?? 0} strikes)
                                on {formatDateTime(handle.accountDeletedAt)}
                              </p>
                              <p className="text-muted-foreground">
                                If the channel is back, restore it to re-activate
                                the account and re-credit its deleted clips.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="shrink-0"
                              disabled={restoreAccountMutation.isPending}
                              onClick={() =>
                                restoreAccountMutation.mutate({
                                  verifiedUserId: handle.id,
                                })
                              }
                            >
                              {restoreAccountMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              Restore account
                            </Button>
                          </div>
                        )}
                        <div className="mt-4 flex justify-end">
                          <HandleBanControls
                            handle={handle}
                            onBan={handleBanHandle}
                            onUnban={handleUnbanHandle}
                            isBanLoading={getIsHandleBanLoading(
                              handle.platform,
                              handle.handle
                            )}
                            isUnbanLoading={getIsHandleUnbanLoading(
                              handle.platform,
                              handle.handle
                            )}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="space-y-1.5">
                    <CardTitle>Latest earnings activity</CardTitle>
                    <CardDescription>
                      All {earningsEntries.length} balance entries.
                    </CardDescription>
                  </div>
                  {earningsEntries.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEarningsExpanded(true)}
                    >
                      <Maximize2 className="mr-2 h-4 w-4" />
                      Full screen
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-4">
                  {earningsEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No balance entries found during the tracked window.
                    </p>
                  ) : (
                    <div className="max-h-[28rem] overflow-y-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-32">Amount</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Memo</TableHead>
                            <TableHead className="w-48">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {earningsEntries.map(renderEarningsEntry)}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Dialog
                open={earningsExpanded}
                onOpenChange={setEarningsExpanded}
              >
                <DialogContent className="h-[92vh] w-[96vw] max-w-[96vw] overflow-hidden p-6 sm:max-w-[96vw]">
                  <DialogHeader>
                    <DialogTitle>
                      Earnings activity — all {earningsEntries.length} balance
                      entries
                    </DialogTitle>
                  </DialogHeader>
                  <div className="h-full overflow-y-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-36">Amount</TableHead>
                          <TableHead className="w-56">Type</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="w-52">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {earningsEntries.map(renderEarningsEntry)}
                      </TableBody>
                    </Table>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Demographics verifications</CardTitle>
                <CardDescription>
                  Every demographics_verifications_v2 record associated with
                  this user.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {demographicsVerifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No demographics verification requests have been submitted
                    by this user.
                  </p>
                ) : (
                  <div className="rounded-lg border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaign</TableHead>
                          <TableHead>Handle</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Approval</TableHead>
                          <TableHead className="text-right">
                            Views snapshot
                          </TableHead>
                          <TableHead className="w-48">Updated</TableHead>
                          <TableHead className="w-32">Evidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {demographicsVerifications.map((verification) => (
                          <TableRow key={verification.id}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {verification.campaignTitle ??
                                    "Untitled campaign"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {verification.campaignId}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {verification.verifiedHandle
                                    ? `@${verification.verifiedHandle}`
                                    : verification.verifiedUsername ?? "Unknown"}
                                </span>
                                {verification.verifiedUsername && (
                                  <span className="text-xs text-muted-foreground">
                                    {verification.verifiedUsername}
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {formatPlatformLabel(
                                    verification.verifiedPlatform
                                  )}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                {renderStatusBadge(verification.status)}
                                {verification.exemptionReason && (
                                  <p className="text-xs text-muted-foreground">
                                    {verification.exemptionReason}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatApprovalMethod(
                                verification.approvalMethod
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {typeof verification.viewsFromSubmissionsSnapshot ===
                              "number"
                                ? verification.viewsFromSubmissionsSnapshot.toLocaleString()
                                : "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDateTime(
                                verification.updatedAt ??
                                  verification.createdAt ??
                                  null
                              )}
                            </TableCell>
                            <TableCell>
                              {verification.screenshotFileUrl ? (
                                <a
                                  href={verification.screenshotFileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm font-medium text-primary hover:underline"
                                >
                                  View
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No file
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {canSeeBank && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Bank / payout details</CardTitle>
                      <CardDescription>
                        Account number is masked (last 4 digits). Visible to
                        anyone with User Activity access.
                        {liveBank ? (
                          <span className="ml-1 font-medium text-emerald-600 dark:text-emerald-400">
                            Live from Wise.
                          </span>
                        ) : (
                          <span className="ml-1">
                            Saved copy may be out of date — hit Refresh for the
                            current account.
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!selectedUserId || refreshBank.isPending}
                      onClick={() =>
                        selectedUserId &&
                        refreshBank.mutate({ userId: selectedUserId })
                      }
                    >
                      {refreshBank.isPending ? (
                        <>
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          Fetching…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-1 h-4 w-4" />
                          Refresh from Wise
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {bankDetailsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : !bankDetails ? (
                    <p className="text-sm text-muted-foreground">
                      No bank details on file for this user.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                      {[
                        ["Account holder", bankDetails.accountHolder],
                        ["Bank", bankDetails.bankName],
                        ["Account number", bankDetails.accountNumberMasked],
                        ["IFSC", bankDetails.ifscCode],
                        ["Branch", bankDetails.branchName],
                        ["Currency", bankDetails.targetCurrency],
                        ["Email", bankDetails.recipientEmail],
                        [
                          "Location",
                          [bankDetails.addressCity, bankDetails.addressCountryCode]
                            .filter(Boolean)
                            .join(", ") || null,
                        ],
                      ].map(([label, value]) => (
                        <div key={label as string}>
                          <div className="text-xs text-muted-foreground">
                            {label}
                          </div>
                          <div className="font-medium">
                            {(value as string) || "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {liveBank ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Fetched from Wise at{" "}
                      {new Date(liveBank.fetchedAt).toLocaleString()} · recipient{" "}
                      {liveBank.wiseRecipientId}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Recent submissions</CardTitle>
                <CardDescription>
                  Showing the {submissions.length} most recent submissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {autoRejectCount > 0 && (
                  <Alert className="mb-4 border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
                    <AlertTitle className="text-orange-800">
                      {autoRejectCount} auto-rejected{" "}
                      {autoRejectCount === 1 ? "clip" : "clips"} found
                    </AlertTitle>
                    <AlertDescription className="text-orange-700">
                      These were auto-rejected (likely by the Discord bot when
                      this user was banned on the server). Send them back to
                      the moderator queue for a fresh human review.
                    </AlertDescription>
                    <div className="mt-3">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="default"
                            size="sm"
                            disabled={requeueAutoRejectsMutation.isPending}
                          >
                            {requeueAutoRejectsMutation.isPending
                              ? "Sending..."
                              : `Send ${autoRejectCount} ${
                                  autoRejectCount === 1
                                    ? "clip"
                                    : "clips"
                                } back for moderator review`}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Send {autoRejectCount} clip
                              {autoRejectCount === 1 ? "" : "s"} back for
                              moderator review?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Every auto-rejected clip from this user will be
                              moved to status <strong>Pending</strong> so the
                              moderator queue picks them up. Their previous
                              reviewer assignment and rejection reason will be
                              cleared. This cannot be undone in bulk — you'd
                              have to reject individually after.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                requeueAutoRejectsMutation.mutate({
                                  userId: selectedUserId,
                                })
                              }
                            >
                              Send back for review
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </Alert>
                )}
                {submissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This user hasn’t submitted any clips yet.
                  </p>
                ) : (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaign</TableHead>
                          <TableHead>Platform</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Views</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Availability</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {submissions.map((submission) => {
                          const isDeleted = Boolean(submission.deletedAt);
                          return (
                          <TableRow key={submission.id}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span
                                  className={
                                    isDeleted
                                      ? "font-medium line-through text-muted-foreground"
                                      : "font-medium"
                                  }
                                >
                                  {submission.campaignTitle ??
                                    "Untitled campaign"}
                                </span>
                                <span
                                  className={
                                    isDeleted
                                      ? "text-xs text-muted-foreground line-through"
                                      : "text-xs text-muted-foreground"
                                  }
                                >
                                  {submission.url}
                                </span>
                                {submission.ncRequired &&
                                  (submission.nonCampaignClip ? (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
                                      <span className="text-[11px] text-muted-foreground">
                                        Non-campaign clip:
                                      </span>
                                      <a
                                        href={submission.nonCampaignClip.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="max-w-[200px] truncate text-[11px] underline"
                                      >
                                        {formatPlatformLabel(
                                          submission.nonCampaignClip.platform
                                        )}{" "}
                                        ↗
                                      </a>
                                      {renderStatusBadge(
                                        submission.nonCampaignClip.status
                                      )}
                                      {submission.nonCampaignClip.status ===
                                        "rejected" &&
                                        submission.nonCampaignClip
                                          .rejectedReason && (
                                          <span className="text-[11px] text-rose-700">
                                            {
                                              submission.nonCampaignClip
                                                .rejectedReason
                                            }
                                          </span>
                                        )}
                                    </div>
                                  ) : (
                                    <span className="mt-1 text-[11px] text-amber-600">
                                      No linked non-campaign clip (unredeemed)
                                    </span>
                                  ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              {formatPlatformLabel(submission.platform)}
                            </TableCell>
                            <TableCell>
                              {renderStatusBadge(submission.status)}
                            </TableCell>
                            <TableCell className="text-right">
                              {submission.views.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDateTime(submission.createdAt)}
                            </TableCell>
                            <TableCell>
                              {isDeleted ? (
                                <div className="flex items-center gap-2">
                                  <Badge className="border-rose-200 bg-rose-100 text-rose-700">
                                    Deleted
                                  </Badge>
                                  {canRestore && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={restoreMutation.isPending}
                                      onClick={() =>
                                        restoreMutation.mutate({
                                          submissionId: submission.id,
                                        })
                                      }
                                    >
                                      Restore
                                    </Button>
                                  )}
                                </div>
                              ) : (submission.unavailableStrikes ?? 0) > 0 ? (
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className="border-amber-200 text-amber-700"
                                  >
                                    At-risk ({submission.unavailableStrikes})
                                  </Badge>
                                  {canRestore && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={restoreMutation.isPending}
                                      onClick={() =>
                                        restoreMutation.mutate({
                                          submissionId: submission.id,
                                        })
                                      }
                                    >
                                      Restore
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Live
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {postCampaignDeletedClips.length > 0 && (
              <Card className="border-rose-200">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-rose-700">
                        Clips Status
                      </CardTitle>
                      <CardDescription>
                        Reels taken down after their campaign ended — breaking
                        the "stay live for 3 months after the campaign ends"
                        rule. The campaign is settled, so money is NOT removed
                        automatically: claw back a clip's reward, or ban the
                        clipper.
                      </CardDescription>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            !selectedUserId || banUserMutation.isPending
                          }
                        >
                          Ban clipper
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Ban this clipper?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They won't be able to participate. You can unban
                            later from the user overview.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              banUserMutation.mutate({
                                userId: selectedUserId,
                                reason:
                                  "Deleted clip(s) after campaign end",
                              })
                            }
                          >
                            Ban
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaign</TableHead>
                          <TableHead>Platform</TableHead>
                          <TableHead className="text-right">Views</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead>Campaign ended</TableHead>
                          <TableHead>Deleted</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {postCampaignDeletedClips.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {c.campaignTitle ?? "Untitled campaign"}
                                </span>
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-muted-foreground hover:underline"
                                >
                                  {c.url}
                                </a>
                              </div>
                            </TableCell>
                            <TableCell>
                              {formatPlatformLabel(c.platform)}
                            </TableCell>
                            <TableCell className="text-right">
                              {c.views.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              ${c.reward.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDateTime(c.endDate)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDateTime(c.deletedAt)}
                            </TableCell>
                            <TableCell>
                              {c.deletedClawedBack ? (
                                <Badge
                                  variant="outline"
                                  className="border-zinc-200 text-zinc-600"
                                >
                                  Clawed back
                                </Badge>
                              ) : (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={manualClawbackMutation.isPending}
                                    >
                                      Claw back
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Claw back ${c.reward.toFixed(2)}?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Removes this clip's reward from the
                                        clipper's current balance. The balance
                                        can go negative (debt), recovered from
                                        future earnings. Reversible via Restore.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>
                                        Cancel
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() =>
                                          manualClawbackMutation.mutate({
                                            submissionId: c.id,
                                          })
                                        }
                                      >
                                        Claw back
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        ) : null}
      </div>
    </AppLayout>
  );
};

export default AdminUserActivity;
