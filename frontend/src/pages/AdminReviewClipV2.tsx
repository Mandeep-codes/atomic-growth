import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Gamepad2,
  Globe,
  Instagram,
  Loader2,
  Music2,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { InstagramEmbed } from "@/components/InstagramEmbed";
import { TwitterEmbed } from "@/components/TwitterEmbed";

const REJECT_PRESETS = [
  { key: "2", label: "Wrong / irrelevant", reason: "Wrong or irrelevant clip" },
  { key: "3", label: "Not original", reason: "Not original content" },
  { key: "4", label: "Low quality", reason: "Low quality clip" },
  { key: "5", label: "Broken link", reason: "Link is broken or inaccessible" },
  { key: "6", label: "Other", reason: "" },
] as const;

const NC_PLATFORM_ICON_MAP: Record<string, LucideIcon> = {
  tiktok: Music2,
  instagram: Instagram,
  youtube: Youtube,
  twitter: Twitter,
  x: Twitter,
};
const ncPlatformIcon = (platform?: string | null): LucideIcon =>
  NC_PLATFORM_ICON_MAP[(platform ?? "").toLowerCase()] || Globe;

const shouldIgnoreKeybind = (target: EventTarget | null) => {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

const AdminReviewClipV2 = () => {
  const { toast } = useToast();
  const hasAutoLoadedBatchRef = useRef(false);
  const [queue, setQueue] = useState<
    Array<{
      id: string;
      campaignId: string;
      campaignTitle: string | null;
      url: string;
      platform: string | null;
      views: number;
    }>
  >([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [batchErrorMessage, setBatchErrorMessage] = useState<string | null>(
    null
  );
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isLoadingBatch, setIsLoadingBatch] = useState(false);
  const [customRejectDialog, setCustomRejectDialog] = useState({
    open: false,
    reason: "",
  });

  const claimBatch = trpc.submissions.claimReviewBatchV2.useMutation({
    onError(error) {
      toast({
        title: "Couldn’t load review batch",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const loadBatch = useCallback(async () => {
    if (isLoadingBatch) {
      return;
    }

    setBatchErrorMessage(null);
    setIsLoadingBatch(true);

    try {
      const result = await Promise.race([
        claimBatch.mutateAsync({
          batchSize: 10,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Batch request timed out")), 15_000);
        }),
      ]);

      setQueue(result.submissions);
      setPendingCount(result.remaining);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch";
      setQueue([]);
      setPendingCount(0);
      setBatchErrorMessage(message);
    } finally {
      setHasLoadedOnce(true);
      setIsLoadingBatch(false);
    }
  }, [claimBatch.mutateAsync, isLoadingBatch]);

  useEffect(() => {
    if (hasAutoLoadedBatchRef.current) {
      return;
    }

    hasAutoLoadedBatchRef.current = true;
    void loadBatch();
  }, [loadBatch]);

  const submission = queue[0] ?? null;
  const remaining = pendingCount;

  const updateStatus = trpc.submissions.updateSubmissionStatus.useMutation({
    onError(error) {
      toast({
        title: "Couldn’t update submission",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canReview = Boolean(submission) && !updateStatus.isLoading;

  const contentUrl = submission?.url ?? "";

  const {
    data: previewData,
    error: previewError,
    isError: isPreviewError,
    isLoading: isPreviewLoading,
  } = trpc.submissions.getPlatformMetadata.useQuery(
    { url: contentUrl },
    {
      enabled: Boolean(contentUrl),
      retry: false,
    }
  );

  const isInstagram = previewData?.platform === "instagram";
  const isTwitter = previewData?.platform === "x";

  const handleApprove = useCallback(async () => {
    if (!submission) {
      return;
    }

    await updateStatus.mutateAsync({
      submissionId: submission.id,
      status: "approved",
    });

    setQueue((prev) => {
      const nextQueue = prev.slice(1);
      if (nextQueue.length === 0) {
        void loadBatch();
      }
      return nextQueue;
    });
    toast({
      title: "Approved",
      description: "Moving to next clip…",
    });
  }, [loadBatch, submission, toast, updateStatus]);

  const handleReject = useCallback(
    async (reason: string) => {
      if (!submission) {
        return;
      }

      await updateStatus.mutateAsync({
        submissionId: submission.id,
        status: "rejected",
        rejectedReason: reason,
        preventResubmission: false,
      });

      setQueue((prev) => {
        const nextQueue = prev.slice(1);
        if (nextQueue.length === 0) {
          void loadBatch();
        }
        return nextQueue;
      });
      toast({
        title: "Rejected",
        description: "Moving to next clip…",
      });
    },
    [loadBatch, submission, toast, updateStatus]
  );

  const openCustomRejectDialog = useCallback(() => {
    setCustomRejectDialog({ open: true, reason: "" });
  }, []);

  const closeCustomRejectDialog = useCallback(() => {
    setCustomRejectDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const submitCustomReject = useCallback(async () => {
    const reason = customRejectDialog.reason.trim();
    if (!reason) {
      toast({
        title: "Reason required",
        description: "Please enter a rejection reason.",
        variant: "destructive",
      });
      return;
    }

    closeCustomRejectDialog();
    await handleReject(reason);
  }, [closeCustomRejectDialog, customRejectDialog.reason, handleReject, toast]);

  const keyToPreset = useMemo<
    Record<string, (typeof REJECT_PRESETS)[number]>
  >(() => {
    return Object.fromEntries(
      REJECT_PRESETS.map((preset) => [preset.key, preset])
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canReview || event.repeat) {
        return;
      }

      if (customRejectDialog.open) {
        return;
      }

      if (shouldIgnoreKeybind(event.target)) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        void handleApprove();
        return;
      }

      if (event.key === "6") {
        event.preventDefault();
        openCustomRejectDialog();
        return;
      }

      const preset = keyToPreset[event.key as keyof typeof keyToPreset];
      if (preset) {
        event.preventDefault();
        void handleReject(preset.reason);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canReview,
    customRejectDialog.open,
    handleApprove,
    handleReject,
    keyToPreset,
    openCustomRejectDialog,
  ]);

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Gamepad2 className="h-5 w-5" />
              Review Clip v2
            </h1>
            <p className="text-sm text-muted-foreground">
              Press <span className="font-medium">2–6</span> to reject, <span className="font-medium">1</span> to approve.
            </p>
          </div>

          <div className="text-right text-sm text-muted-foreground">
            {`${remaining.toLocaleString()} pending • ${queue.length}/10 in batch`}
          </div>
        </div>

        {batchErrorMessage ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load batch</CardTitle>
              <CardDescription>
                This is usually a backend connectivity issue (check
                `VITE_TRPC_URL` and that the backend is running).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Error: {batchErrorMessage}
              </p>
              <Button
                variant="outline"
                onClick={() => loadBatch()}
                disabled={isLoadingBatch}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!submission && !batchErrorMessage && hasLoadedOnce ? (
          <Card>
            <CardHeader>
              <CardTitle>All caught up</CardTitle>
              <CardDescription>No pending clip submissions found.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => loadBatch()}
                disabled={isLoadingBatch}
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        ) : submission ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="truncate">Clip preview</span>
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={submission.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
                    </a>
                  </Button>
                </CardTitle>
                <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>Campaign: {submission.campaignTitle ?? "Unknown"}</span>
                  <span>Platform: {submission.platform ?? "Unknown"}</span>
                  <span>Views: {submission.views.toLocaleString()}</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isPreviewLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Fetching preview…
                  </div>
                ) : isPreviewError ? (
                  <div className="space-y-2 rounded-md border border-dashed border-red-200 bg-red-50 p-4 text-xs text-red-700">
                    <p>We couldn’t load a preview for this link.</p>
                    {previewError instanceof Error ? <p>{previewError.message}</p> : null}
                  </div>
                ) : isInstagram && submission.url ? (
                  <InstagramEmbed url={submission.url} />
                ) : isTwitter && submission.url ? (
                  <TwitterEmbed url={submission.url} />
                ) : previewData?.embedUrl ? (
                  <iframe
                    title="Content preview"
                    src={previewData.embedUrl}
                    className="aspect-video h-[750px] w-full max-w-xl mx-auto"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                    No embed available for this platform.
                  </div>
                )}

                {/* Non-campaign clips — same row format as the campaign
                     clip above (platform icon + URL + view count + Open
                     button). Enforcement guarantees the count is always
                     correct, so no warning state needed. */}
                {(submission.nonCampaignClips ?? []).length > 0 ? (
                  <div className="mt-4 space-y-2 rounded-md border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Non-campaign clips ({(submission.nonCampaignClips ?? []).length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Click each to confirm same account + same niche as the
                      campaign clip above.
                    </p>
                    <div className="space-y-2">
                      {(submission.nonCampaignClips ?? []).map((nc, idx) => {
                        const NcIcon = ncPlatformIcon(nc.platform);
                        return (
                          <div
                            key={`${nc.url}-${idx}`}
                            className="flex items-center justify-between gap-3 rounded-md border bg-background p-2"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/40">
                                <NcIcon className="h-4 w-4" />
                              </span>
                              <div className="min-w-0 leading-tight">
                                <p className="text-sm font-medium">
                                  Non-campaign #{idx + 1}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  <span className="capitalize">{nc.platform}</span>
                                  {" • "}
                                  {(nc.views ?? 0).toLocaleString()} views
                                </p>
                              </div>
                            </div>
                            <Button asChild variant="outline" size="sm">
                              <a
                                href={nc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                View
                                <ExternalLink className="ml-1 h-3.5 w-3.5" />
                              </a>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>
                  One keypress submits the decision and auto-advances.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full justify-between"
                  onClick={() => handleApprove()}
                  disabled={!canReview}
                >
                  <span>Approve</span>
                  <span className="text-muted-foreground">1</span>
                </Button>

                <div className="space-y-2">
                  {REJECT_PRESETS.map((preset) => (
                    <Button
                      key={preset.key}
                      variant="destructive"
                      className="w-full justify-between"
                      onClick={() =>
                        preset.key === "6"
                          ? openCustomRejectDialog()
                          : handleReject(preset.reason)
                      }
                      disabled={!canReview}
                    >
                      <span>{preset.label}</span>
                      <span className="text-destructive-foreground/80">
                        {preset.key}
                      </span>
                    </Button>
                  ))}
                </div>

                {updateStatus.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving decision…
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Dialog
          open={customRejectDialog.open}
          onOpenChange={(open) =>
            open ? openCustomRejectDialog() : closeCustomRejectDialog()
          }
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject with a custom reason</DialogTitle>
              <DialogDescription>
                Enter a short reason for rejecting this clip.
              </DialogDescription>
            </DialogHeader>

            <Textarea
              value={customRejectDialog.reason}
              onChange={(event) =>
                setCustomRejectDialog((prev) => ({
                  ...prev,
                  reason: event.target.value,
                }))
              }
              placeholder="Type rejection reason…"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submitCustomReject();
                }
              }}
            />

            <DialogFooter>
              <Button variant="outline" onClick={closeCustomRejectDialog}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void submitCustomReject()}
              >
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default AdminReviewClipV2;
