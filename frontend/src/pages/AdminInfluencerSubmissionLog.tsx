import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import { Loader2, ExternalLink } from "lucide-react";
import { demographicSchema, type DemographicData } from "@/shared/demographics";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64] = result.split(",");
      resolve(base64 ?? result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });

const ALL_CAMPAIGNS_OPTION = "all";

type SubmissionType = "twitter" | "linkedin";

type ModalState = {
  open: boolean;
  submissionId: string | null;
  platform: SubmissionType;
  handle: string;
  campaignTitle: string | null;
  existingDemographics: DemographicData | null;
  screenshotUrl: string | null;
};

const AdminInfluencerSubmissionLog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCampaignFilter =
    searchParams.get("campaignId") ?? ALL_CAMPAIGNS_OPTION;
  const [campaignFilter, setCampaignFilter] = useState<string>(
    initialCampaignFilter
  );
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const campaignQuery = trpc.influencerSubmissions.listCampaigns.useQuery();
  const submissionsQuery = trpc.influencerSubmissions.listSubmissions.useQuery(
    campaignFilter === ALL_CAMPAIGNS_OPTION
      ? undefined
      : { campaignId: campaignFilter },
    { keepPreviousData: true }
  );
  const demographicsFileInputRef = useRef<HTMLInputElement | null>(null);
  const [demographicsModal, setDemographicsModal] = useState<ModalState>({
    open: false,
    submissionId: null,
    platform: "twitter",
    handle: "",
    campaignTitle: null,
    existingDemographics: null,
    screenshotUrl: null,
  });
  const [pendingDemographics, setPendingDemographics] = useState<{
    screenshotUrl: string;
    data: DemographicData;
  } | null>(null);
  const [demographicsError, setDemographicsError] = useState<string | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [impressionsModal, setImpressionsModal] = useState<{
    open: boolean;
    submissionId: string | null;
    platform: SubmissionType;
    handle: string;
    impressions: number;
  }>({ open: false, submissionId: null, platform: "twitter", handle: "", impressions: 0 });
  const [twitterPage, setTwitterPage] = useState(0);
  const [linkedinPage, setLinkedinPage] = useState(0);

  const campaigns = campaignQuery.data ?? [];
  const submissionsData = submissionsQuery.data;
  const twitterSubmissions = submissionsData?.twitter ?? [];
  const linkedinSubmissions = submissionsData?.linkedin ?? [];

  const campaignMap = useMemo(() => {
    const map = new Map<string, string>();
    (campaignQuery.data ?? []).forEach((campaign) => {
      map.set(campaign.id, campaign.title);
    });
    return map;
  }, [campaignQuery.data]);

  useEffect(() => {
    const param = searchParams.get("campaignId") ?? ALL_CAMPAIGNS_OPTION;
    setCampaignFilter((prev) => (prev === param ? prev : param));
  }, [searchParams]);

  useEffect(() => {
    setTwitterPage(0);
  }, [twitterSubmissions.length]);

  useEffect(() => {
    setLinkedinPage(0);
  }, [linkedinSubmissions.length]);

  const TWITTER_PAGE_SIZE = 5;
  const LINKEDIN_PAGE_SIZE = 5;

  const twitterPageCount = Math.max(
    1,
    Math.ceil(twitterSubmissions.length / TWITTER_PAGE_SIZE)
  );
  const linkedinPageCount = Math.max(
    1,
    Math.ceil(linkedinSubmissions.length / LINKEDIN_PAGE_SIZE)
  );
  const safeTwitterPage = Math.min(twitterPage, twitterPageCount - 1);
  const safeLinkedinPage = Math.min(linkedinPage, linkedinPageCount - 1);
  const twitterPageData = twitterSubmissions.slice(
    safeTwitterPage * TWITTER_PAGE_SIZE,
    safeTwitterPage * TWITTER_PAGE_SIZE + TWITTER_PAGE_SIZE
  );
  const linkedinPageData = linkedinSubmissions.slice(
    safeLinkedinPage * LINKEDIN_PAGE_SIZE,
    safeLinkedinPage * LINKEDIN_PAGE_SIZE + LINKEDIN_PAGE_SIZE
  );

  const parseDemographics = (value: unknown) => {
    if (!value) return null;
    const parsed = demographicSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  const demographicsUploadMutation =
    trpc.uploads.uploadDemographicScreenshot.useMutation({
      onSuccess: (response) => {
        if (response.success && response.demographics && response.screenshotUrl) {
          setPendingDemographics({
            screenshotUrl: response.screenshotUrl,
            data: response.demographics,
          });
          setDemographicsError(null);
        } else {
          setPendingDemographics(null);
          setDemographicsError(
            "We couldn't parse that screenshot. Try a clearer upload."
          );
        }
      },
      onError: (error) => {
        setDemographicsError(error.message);
        toast({
          title: "Upload failed",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const updateDemographicsMutation =
    trpc.influencerSubmissions.updateDemographics.useMutation({
      onSuccess: async () => {
        toast({
          title: "Demographics saved",
          description: "We updated the submission with the parsed data.",
        });
        setDemographicsModal((prev) => ({ ...prev, open: false }));
        setPendingDemographics(null);
        setDemographicsError(null);
        await utils.influencerSubmissions.listSubmissions.invalidate();
      },
      onError: (error) => {
        toast({
          title: "Unable to save demographics",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const deleteSubmissionMutation =
    trpc.influencerSubmissions.deleteSubmission.useMutation({
      onSuccess: async () => {
        toast({
          title: "Submission deleted",
          description: "The entry has been removed.",
        });
        setDeletingId(null);
        await utils.influencerSubmissions.listSubmissions.invalidate();
      },
      onError: (error) => {
        toast({
          title: "Unable to delete submission",
          description: error.message,
          variant: "destructive",
        });
        setDeletingId(null);
      },
    });

  const updateImpressionsMutation =
    trpc.influencerSubmissions.updateImpressions.useMutation({
      onSuccess: async () => {
        toast({
          title: "Impressions updated",
          description: "The submission now reflects the latest count.",
        });
        setImpressionsModal((prev) => ({ ...prev, open: false }));
        await utils.influencerSubmissions.listSubmissions.invalidate();
      },
      onError: (error) => {
        toast({
          title: "Unable to update impressions",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const handleOpenModal = (
    submission:
      | (typeof twitterSubmissions)[number]
      | (typeof linkedinSubmissions)[number],
    platform: SubmissionType
  ) => {
    setDemographicsModal({
      open: true,
      submissionId: submission.id,
      platform,
      handle: submission.handle,
      campaignTitle: submission.campaignTitle ?? null,
      existingDemographics: parseDemographics(submission.demographicsParsed),
      screenshotUrl: submission.demographicsScreenshotUrl ?? null,
    });
    setPendingDemographics(null);
    setDemographicsError(null);
  };

  const handleCloseModal = () => {
    setDemographicsModal((prev) => ({ ...prev, open: false }));
    setPendingDemographics(null);
    setDemographicsError(null);
    if (demographicsFileInputRef.current) {
      demographicsFileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setDemographicsError(null);
    try {
      const base64 = await fileToBase64(file);
      await demographicsUploadMutation.mutateAsync({
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileBase64: base64,
        folder: "influencer-submissions/demographics",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to upload screenshot";
      setDemographicsError(message);
      toast({
        title: "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  const handleSaveDemographics = async () => {
    if (!pendingDemographics || !demographicsModal.submissionId) {
      return;
    }
    await updateDemographicsMutation.mutateAsync({
      submissionId: demographicsModal.submissionId,
      platform: demographicsModal.platform,
      demographics: {
        screenshotUrl: pendingDemographics.screenshotUrl,
        parsed: pendingDemographics.data,
      },
    });
  };

  const handleDeleteSubmission = async (
    submissionId: string,
    platform: SubmissionType,
    handle: string
  ) => {
    const confirmed = window.confirm(
      `Delete @${handle}'s ${platform} submission? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingId(submissionId);
    try {
      await deleteSubmissionMutation.mutateAsync({ submissionId, platform });
    } catch {
      // handled in mutation onError
    }
  };

  const handleOpenImpressions = (
    submission:
      | (typeof twitterSubmissions)[number]
      | (typeof linkedinSubmissions)[number],
    platform: SubmissionType
  ) => {
    setImpressionsModal({
      open: true,
      submissionId: submission.id,
      platform,
      handle: submission.handle,
      impressions: submission.impressions,
    });
  };

  const handleSaveImpressions = async () => {
    if (!impressionsModal.submissionId) return;
    await updateImpressionsMutation.mutateAsync({
      submissionId: impressionsModal.submissionId,
      platform: impressionsModal.platform,
      impressions: impressionsModal.impressions,
    });
  };

  const renderActionsCell = (
    submission:
      | (typeof twitterSubmissions)[number]
      | (typeof linkedinSubmissions)[number],
    platform: SubmissionType
  ) => {
    const isDeleting = deletingId === submission.id && deleteSubmissionMutation.isPending;
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleOpenModal(submission, platform)}
          disabled={isDeleting}
        >
          Upload demographics
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleOpenImpressions(submission, platform)}
          disabled={isDeleting}
        >
          Add impressions
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => handleDeleteSubmission(submission.id, platform, submission.handle)}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
    );
  };

  return (
    <>
      <AppLayout>
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-foreground">
                Influencer submissions
              </h1>
              <p className="text-muted-foreground">
                Browse every influencer clip captured through the manual form.
              </p>
            </div>
            <Button asChild>
              <Link to="/admin/influencer-submissions">Add submission</Link>
            </Button>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 border-b border-border/40 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Filters</CardTitle>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={campaignFilter}
                  onValueChange={(value) => {
                    setCampaignFilter(value);
                    if (value === ALL_CAMPAIGNS_OPTION) {
                      setSearchParams({}, { replace: true });
                    } else {
                      setSearchParams({ campaignId: value }, { replace: true });
                    }
                  }}
                  disabled={campaignQuery.isLoading}
                >
                  <SelectTrigger className="w-full sm:w-[240px]">
                    <SelectValue placeholder="Filter by campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CAMPAIGNS_OPTION}>
                      All campaigns
                    </SelectItem>
                    {campaigns.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Twitter submissions</CardTitle>
              <CardDescription>Metrics pulled from X/Twitter posts.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Handle</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Impressions</TableHead>
                      <TableHead>Moderator</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {twitterSubmissions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm">
                          {submissionsQuery.isLoading ? (
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading submissions
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              No Twitter submissions for this filter.
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      twitterPageData.map((submission) => (
                        <TableRow key={submission.id}>
                          <TableCell className="font-medium">
                            {submission.campaignTitle ?? "Untitled"}
                          </TableCell>
                          <TableCell>@{submission.handle}</TableCell>
                          <TableCell>
                            <a
                              href={submission.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              View post
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </TableCell>
                          <TableCell>{submission.impressions.toLocaleString()}</TableCell>
                          <TableCell>
                            {submission.moderatorDiscordUsername ? (
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {submission.moderatorDiscordUsername}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {submission.moderatorEmail ?? submission.submittedBy}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">
                                {submission.submittedBy}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {timeAgo(submission.submittedAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {renderActionsCell(submission, "twitter")}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {twitterSubmissions.length > TWITTER_PAGE_SIZE ? (
                <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                  <span>
                    Page {safeTwitterPage + 1} of {twitterPageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTwitterPage((prev) => Math.max(prev - 1, 0))}
                      disabled={safeTwitterPage === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setTwitterPage((prev) =>
                          Math.min(prev + 1, twitterPageCount - 1)
                        )
                      }
                      disabled={safeTwitterPage >= twitterPageCount - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>LinkedIn submissions</CardTitle>
              <CardDescription>Metrics pulled from LinkedIn posts.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Handle</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Impressions</TableHead>
                      <TableHead>Moderator</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedinSubmissions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-sm">
                          {submissionsQuery.isLoading ? (
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading submissions
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              No LinkedIn submissions for this filter.
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      linkedinPageData.map((submission) => (
                        <TableRow key={submission.id}>
                          <TableCell className="font-medium">
                            {submission.campaignTitle ?? "Untitled"}
                          </TableCell>
                          <TableCell>@{submission.handle}</TableCell>
                          <TableCell>
                            <a
                              href={submission.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              View post
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </TableCell>
                          <TableCell>{submission.impressions.toLocaleString()}</TableCell>
                          <TableCell>
                            {submission.moderatorDiscordUsername ? (
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {submission.moderatorDiscordUsername}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {submission.moderatorEmail ?? submission.submittedBy}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">
                                {submission.submittedBy}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {timeAgo(submission.submittedAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {renderActionsCell(submission, "linkedin")}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {linkedinSubmissions.length > LINKEDIN_PAGE_SIZE ? (
                <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                  <span>
                    Page {safeLinkedinPage + 1} of {linkedinPageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLinkedinPage((prev) => Math.max(prev - 1, 0))}
                      disabled={safeLinkedinPage === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setLinkedinPage((prev) =>
                          Math.min(prev + 1, linkedinPageCount - 1)
                        )
                      }
                      disabled={safeLinkedinPage >= linkedinPageCount - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </AppLayout>

      <Dialog
        open={demographicsModal.open}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseModal();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload demographics</DialogTitle>
            <DialogDescription>
              Attach a demographics screenshot for @{demographicsModal.handle}
              {demographicsModal.campaignTitle
                ? ` • ${demographicsModal.campaignTitle}`
                : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <p>We’ll parse the screenshot automatically and attach the detected countries.</p>
              <input
                ref={demographicsFileInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => demographicsFileInputRef.current?.click()}
                  disabled={
                    demographicsUploadMutation.isPending ||
                    updateDemographicsMutation.isPending
                  }
                >
                  {demographicsUploadMutation.isPending
                    ? "Uploading…"
                    : pendingDemographics
                      ? "Replace screenshot"
                      : "Upload screenshot"}
                </Button>
              </div>
              {demographicsError ? (
                <p className="text-xs text-destructive">{demographicsError}</p>
              ) : null}
            </div>
            {pendingDemographics ? (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="text-xs uppercase text-muted-foreground">
                  Pending demographics
                </p>
                <p className="text-xl font-semibold">
                  {pendingDemographics.data.countries.length} countries detected
                </p>
                <ul className="space-y-1">
                  {[...pendingDemographics.data.countries]
                    .sort((a, b) => b.percentage - a.percentage)
                    .slice(0, 3)
                    .map((country) => (
                      <li key={country.country} className="flex items-center justify-between">
                        <span>{country.country}</span>
                        <span className="text-muted-foreground">
                          {country.percentage}%
                        </span>
                      </li>
                    ))}
                </ul>
                <a
                  href={pendingDemographics.screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  View screenshot
                </a>
              </div>
            ) : demographicsModal.existingDemographics ? (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="text-xs uppercase text-muted-foreground">
                  Current demographics
                </p>
                <p className="text-xl font-semibold">
                  {demographicsModal.existingDemographics.countries.length} countries saved
                </p>
                <ul className="space-y-1">
                  {[...demographicsModal.existingDemographics.countries]
                    .sort((a, b) => b.percentage - a.percentage)
                    .slice(0, 3)
                    .map((country) => (
                      <li key={country.country} className="flex items-center justify-between">
                        <span>{country.country}</span>
                        <span className="text-muted-foreground">
                          {country.percentage}%
                        </span>
                      </li>
                    ))}
                </ul>
                {demographicsModal.screenshotUrl ? (
                  <a
                    href={demographicsModal.screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    View screenshot
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveDemographics}
              disabled={
                !pendingDemographics ||
                demographicsUploadMutation.isPending ||
                updateDemographicsMutation.isPending
              }
            >
              {updateDemographicsMutation.isPending ? "Saving…" : "Save demographics"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={impressionsModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setImpressionsModal((prev) => ({ ...prev, open: false }));
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update impressions</DialogTitle>
            <DialogDescription>
              Enter the reported impressions for @{impressionsModal.handle}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="impressions-input">Impressions</Label>
            <Input
              id="impressions-input"
              type="number"
              min={0}
              value={impressionsModal.impressions}
              onChange={(event) =>
                setImpressionsModal((prev) => ({
                  ...prev,
                  impressions: Number(event.target.value),
                }))
              }
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setImpressionsModal((prev) => ({ ...prev, open: false }))}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveImpressions}
              disabled={updateImpressionsMutation.isPending}
            >
              {updateImpressionsMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminInfluencerSubmissionLog;
