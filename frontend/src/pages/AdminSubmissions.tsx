import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  MoreVertical,
  Loader2,
  Check,
  X,
  ExternalLink,
  Instagram,
  Youtube,
  Music2,
  Twitter,
  Globe,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { clipUrlMatchesSearch } from "@/lib/clipUrl";
import { useToast } from "@/hooks/use-toast";
import { useCampaignsData } from "@/hooks/useCampaignsData";
import { useRole } from "@/hooks/useRole";
import { cn } from "@/lib/utils";
import AdminNonCampaignReview from "./AdminNonCampaignReview";

const STATUS_OPTIONS = ["pending", "approved", "rejected"] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number];

const ASSIGNMENT_FILTER_OPTIONS = [
  { label: "All assignments", value: "all" },
  { label: "Assigned to you", value: "assignedToMe" },
  { label: "Assigned to others", value: "assignedToOthers" },
  { label: "Unassigned", value: "unassigned" },
] as const;

type AssignmentFilter = (typeof ASSIGNMENT_FILTER_OPTIONS)[number]["value"];

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const SORT_OPTIONS = [
  {
    label: "Newest first",
    value: "created-desc",
    sortBy: "createdAt",
    order: "desc",
  },
  {
    label: "Oldest first",
    value: "created-asc",
    sortBy: "createdAt",
    order: "asc",
  },
  {
    label: "Most views",
    value: "views-desc",
    sortBy: "views",
    order: "desc",
  },
  {
    label: "Fewest views",
    value: "views-asc",
    sortBy: "views",
    order: "asc",
  },
] as const;

type SortOptionValue = (typeof SORT_OPTIONS)[number]["value"];

const getStatusBadgeStyles = (status?: string | null) => {
  switch (status) {
    case "approved":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "rejected":
      return "bg-red-500/10 text-red-500 border-red-500/20 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30";
    case "pending":
    default:
      return "bg-amber-500/10 text-amber-500 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30";
  }
};

const PLATFORM_ICON_MAP: Record<string, LucideIcon> = {
  tiktok: Music2,
  instagram: Instagram,
  youtube: Youtube,
  twitter: Twitter,
  x: Twitter,
};

const getPlatformIcon = (platform?: string | null): LucideIcon => {
  const normalized = platform?.toLowerCase() || "";
  return PLATFORM_ICON_MAP[normalized] || Globe;
};

const formatPlatformLabel = (value: string) => {
  if (value === "unknown") {
    return "Unknown";
  }
  return value
    .split(" ")
    .map((segment) =>
      segment.length > 0
        ? segment[0]!.toUpperCase() + segment.slice(1)
        : segment
    )
    .join(" ");
};

const formatDate = (date?: Date | string | null) => {
  if (!date) return "N/A";
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
};

const AdminSubmissions = () => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [assignmentFilter, setAssignmentFilter] =
    useState<AssignmentFilter>("all");
  const [sortOption, setSortOption] = useState<SortOptionValue>("created-asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(
    PAGE_SIZE_OPTIONS[1]
  );
  const [rejectDialog, setRejectDialog] = useState<{
    open: boolean;
    submissionId: string | null;
    reason: string;
    preventResubmission: boolean;
  }>({
    open: false,
    submissionId: null,
    reason: "",
    preventResubmission: false,
  });
  const [viewCapDialog, setViewCapDialog] = useState({
    open: false,
    submissionId: null as string | null,
    url: "",
    currentViews: 0,
    maxViewCap: null as number | null,
    inputValue: "",
  });
  const [urlSearchTerm, setUrlSearchTerm] = useState("");
  const [unassigningId, setUnassigningId] = useState<string | null>(null);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>(
    []
  );
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [platformFilter, setPlatformFilter] = useState("all");
  // Top-level clip kind toggle. Campaign-clip review uses the existing big
  // table below; non-campaign-clip review delegates to AdminNonCampaignReview.
  const [clipKind, setClipKind] = useState<"campaign" | "non-campaign">(
    "campaign"
  );
  const { toast } = useToast();
  const { roles } = useRole();
  const canManageViewCaps = roles.includes("submission-view-cap-manager");

  const { data: campaigns } = useCampaignsData();
  const { data: reviewerIdentity } =
    trpc.submissions.getReviewerIdentity.useQuery();
  const currentReviewerId = reviewerIdentity?.reviewerId ?? null;

  const campaignOptions = useMemo(
    () =>
      (campaigns || []).map((campaign) => ({
        id: campaign.id,
        title: campaign.title || "Untitled Campaign",
        submissionCount: campaign.submissionCount ?? 0,
        createdAt: campaign.created_at,
      })),
    [campaigns]
  );

  const selectedSortOption = useMemo(() => {
    return (
      SORT_OPTIONS.find((option) => option.value === sortOption) ||
      SORT_OPTIONS[0]
    );
  }, [sortOption]);
  const sortBy = selectedSortOption.sortBy;
  const sortOrder = selectedSortOption.order;

  const {
    data: submissions,
    isLoading,
    refetch,
  } = trpc.submissions.getAdminSubmissions.useQuery({
    status: statusFilter,
    order: sortOrder,
    sortBy,
    campaignId: campaignFilter !== "all" ? campaignFilter : undefined,
  });

  type AdminSubmission = NonNullable<typeof submissions>[number];

  const utils = trpc.useUtils();
  // Convert-to-non-campaign confirmation (mod fix for clips uploaded to the
  // wrong bucket by mistake).
  const [convertDialog, setConvertDialog] = useState<{
    open: boolean;
    submissionId: string | null;
    url: string;
  }>({ open: false, submissionId: null, url: "" });

  const convertToNonCampaign =
    trpc.submissions.convertSubmissionToNonCampaign.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.submissions.getAdminSubmissions.invalidate(),
          utils.campaigns.getAll.invalidate(),
        ]);
        refetch();
        toast({
          title: "Converted to non-campaign clip",
          description:
            "The clip moved to the non-campaign review queue as pending.",
        });
        setConvertDialog({ open: false, submissionId: null, url: "" });
      },
      onError: (error) => {
        toast({
          title: "Conversion failed",
          description: error.message || "Couldn't convert.",
          variant: "destructive",
        });
      },
    });

  const updateStatus = trpc.submissions.updateSubmissionStatus.useMutation({
    onSuccess: async () => {
      // Approving/rejecting a submission changes its inclusion in the
      // approved-only count on campaigns.getAll, so refresh both.
      await Promise.all([
        utils.submissions.getAdminSubmissions.invalidate(),
        utils.campaigns.getAll.invalidate(),
      ]);
      refetch();
      toast({
        title: "Submission updated",
        description: "The submission status has been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error.message || "Unable to update submission status.",
        variant: "destructive",
      });
    },
  });
  const assignSubmissions = trpc.submissions.assignSubmissions.useMutation({
    onSuccess: async (data) => {
      await utils.submissions.getAdminSubmissions.invalidate();
      await refetch();
      setSelectedSubmissionIds([]);
      toast({
        title: "Submissions assigned",
        description: `Assigned ${data.assignedCount} submission${
          data.assignedCount === 1 ? "" : "s"
        } to you.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Assignment failed",
        description:
          error.message || "Unable to assign the selected submissions.",
        variant: "destructive",
      });
    },
  });
  const unassignSubmissions =
    trpc.submissions.unassignSubmissions.useMutation({
      onSuccess: async (data) => {
        await utils.submissions.getAdminSubmissions.invalidate();
        await refetch();
        setSelectedSubmissionIds([]);
        toast({
          title: "Submissions unassigned",
          description: `Unassigned ${data.unassignedCount} submission${
            data.unassignedCount === 1 ? "" : "s"
          }.`,
        });
      },
      onError: (error) => {
        toast({
          title: "Unassignment failed",
          description:
            error.message || "Unable to unassign the selected submissions.",
          variant: "destructive",
        });
      },
    });
  const unassignSubmission = trpc.submissions.unassignSubmission.useMutation({
    onMutate: ({ submissionId }) => {
      setUnassigningId(submissionId);
    },
    onSuccess: async () => {
      await utils.submissions.getAdminSubmissions.invalidate();
      await refetch();
      toast({
        title: "Submission unassigned",
        description: "The submission is now available for review.",
      });
    },
    onError: (error) => {
      toast({
        title: "Unable to unassign",
        description: error.message || "Failed to remove the assignment.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setUnassigningId(null);
    },
  });
  const setSubmissionViewCap =
    trpc.submissions.setSubmissionViewCap.useMutation({
      onSuccess: async () => {
        await utils.submissions.getAdminSubmissions.invalidate();
        await refetch();
        closeViewCapDialog();
        toast({
          title: "View cap saved",
          description: "Future view updates will use the capped value.",
        });
      },
      onError: (error) => {
        toast({
          title: "Unable to save view cap",
          description: error.message || "Try again in a moment.",
          variant: "destructive",
        });
      },
    });

  const isSubmissionSelectable = useCallback(
    (submission?: AdminSubmission | null) => {
      if (!submission) {
        return false;
      }
      if (submission.status !== "pending") {
        return false;
      }
      if (!currentReviewerId) {
        return false;
      }

      return true;
    },
    [currentReviewerId]
  );

  const toggleSubmissionSelection = (
    submissionId: string,
    shouldSelect: boolean
  ) => {
    setSelectedSubmissionIds((prev) => {
      if (shouldSelect) {
        if (prev.includes(submissionId)) {
          return prev;
        }
        return [...prev, submissionId];
      }

      return prev.filter((id) => id !== submissionId);
    });
  };

  const getAssignmentDisplayName = useCallback(
    (submission: AdminSubmission) => {
      const fullName = [
        submission.assignmentClerkFirstName,
        submission.assignmentClerkLastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (fullName) {
        return fullName;
      }

      return (
        submission.assignmentClerkEmail ||
        submission.assignmentClerkDiscordId ||
        "another reviewer"
      );
    },
    []
  );

  const handleStatusChange = async (
    submissionId: string,
    nextStatus: "approved" | "rejected",
    rejectedReason?: string,
    preventResubmission?: boolean
  ) => {
    if (nextStatus === "rejected" && !rejectedReason?.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a rejection reason before continuing.",
        variant: "destructive",
      });
      return;
    }

    try {
      setProcessingId(submissionId);
      await updateStatus.mutateAsync({
        submissionId,
        status: nextStatus,
        ...(rejectedReason ? { rejectedReason: rejectedReason.trim() } : {}),
        ...(nextStatus === "rejected"
          ? { preventResubmission: Boolean(preventResubmission) }
          : {}),
      });
    } finally {
      setProcessingId(null);
    }
  };

  const openRejectDialog = (submissionId: string) => {
    setRejectDialog({
      open: true,
      submissionId,
      reason: "",
      preventResubmission: false,
    });
  };

  const closeRejectDialog = () => {
    setRejectDialog({
      open: false,
      submissionId: null,
      reason: "",
      preventResubmission: false,
    });
  };

  const openViewCapDialog = (submission: AdminSubmission) => {
    if (!canManageViewCaps) {
      return;
    }
    const cappedViews =
      typeof submission.maxViewCap === "number"
        ? Math.min(submission.views, submission.maxViewCap)
        : submission.views;
    setViewCapDialog({
      open: true,
      submissionId: submission.id,
      url: submission.url,
      currentViews: cappedViews,
      maxViewCap: submission.maxViewCap ?? null,
      inputValue:
        typeof submission.maxViewCap === "number"
          ? submission.maxViewCap.toString()
          : "",
    });
  };

  const closeViewCapDialog = () => {
    setViewCapDialog({
      open: false,
      submissionId: null,
      url: "",
      currentViews: 0,
      maxViewCap: null,
      inputValue: "",
    });
  };

  const handleSaveViewCap = async () => {
    if (!canManageViewCaps) {
      return;
    }
    if (!viewCapDialog.submissionId) {
      return;
    }

    const trimmedValue = viewCapDialog.inputValue.trim();
    let parsedCap: number | null = null;

    if (trimmedValue.length > 0) {
      const parsedNumber = Number(trimmedValue);
      if (!Number.isFinite(parsedNumber) || parsedNumber < 0) {
        toast({
          title: "Enter a valid number",
          description: "Use a non-negative number of views.",
          variant: "destructive",
        });
        return;
      }
      parsedCap = Math.floor(parsedNumber);
    }

    try {
      await setSubmissionViewCap.mutateAsync({
        submissionId: viewCapDialog.submissionId,
        maxViewCap: parsedCap,
      });
    } catch {
      // handled by mutation onError toast
    }
  };

  const handleClearViewCap = async () => {
    if (!canManageViewCaps || !viewCapDialog.submissionId) {
      return;
    }

    try {
      await setSubmissionViewCap.mutateAsync({
        submissionId: viewCapDialog.submissionId,
        maxViewCap: null,
      });
    } catch {
      // handled by mutation onError
    }
  };

  const confirmReject = async () => {
    if (!rejectDialog.submissionId) {
      return;
    }

    const reason = rejectDialog.reason.trim();
    if (!reason) {
      toast({
        title: "Reason required",
        description: "Please enter a reason for rejecting this submission.",
        variant: "destructive",
      });
      return;
    }

    try {
      await handleStatusChange(
        rejectDialog.submissionId,
        "rejected",
        reason,
        rejectDialog.preventResubmission
      );
      closeRejectDialog();
    } catch (error) {
      // errors handled by mutation toast
    }
  };

  const isRejectingCurrent =
    rejectDialog.submissionId !== null &&
    processingId === rejectDialog.submissionId;
  const isRejectDisabled = !rejectDialog.reason.trim() || isRejectingCurrent;

  const platformOptions = useMemo(() => {
    if (!submissions) {
      return [];
    }
    const unique = new Set<string>();
    submissions.forEach((submission) => {
      const normalized = submission.platform?.toLowerCase().trim() || "unknown";
      unique.add(normalized);
    });
    return Array.from(unique).sort();
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    if (!submissions) {
      return [];
    }

    // Matching is delegated to clipUrlMatchesSearch: a pasted link is compared
    // on the platform's video id, so tracking params, /reel/ vs /reels/ and a
    // missing www no longer stop it finding the row. Bare ids and partial text
    // fall back to the substring behaviour this had before.
    const trimmedSearch = urlSearchTerm.trim();

    const matchesAssignmentFilter = (submission: AdminSubmission) => {
      switch (assignmentFilter) {
        case "assignedToMe":
          if (!currentReviewerId) {
            return false;
          }
          return submission.reviewerAssignmentUserId === currentReviewerId;
        case "assignedToOthers":
          return (
            Boolean(submission.reviewerAssignmentUserId) &&
            submission.reviewerAssignmentUserId !== currentReviewerId
          );
        case "unassigned":
          return !submission.reviewerAssignmentUserId;
        case "all":
        default:
          return true;
      }
    };

    return submissions.filter((submission) => {
      const matchesSearch = trimmedSearch
        ? clipUrlMatchesSearch(submission.url ?? "", trimmedSearch)
        : true;
      const normalizedPlatform =
        submission.platform?.toLowerCase().trim() || "unknown";
      const matchesPlatform =
        platformFilter === "all" || normalizedPlatform === platformFilter;
      return (
        matchesSearch && matchesAssignmentFilter(submission) && matchesPlatform
      );
    });
  }, [
    assignmentFilter,
    currentReviewerId,
    platformFilter,
    submissions,
    urlSearchTerm,
  ]);

  const totalSubmissions = filteredSubmissions.length;

  const totalPages = useMemo(() => {
    if (!totalSubmissions) {
      return 1;
    }

    return Math.max(1, Math.ceil(totalSubmissions / pageSize));
  }, [pageSize, totalSubmissions]);

  const paginatedSubmissions = useMemo(() => {
    if (!filteredSubmissions.length) return [];

    const startIndex = (currentPage - 1) * pageSize;
    return filteredSubmissions.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredSubmissions, pageSize]);

  const visibleSelectableIds = useMemo(
    () =>
      paginatedSubmissions
        .filter((submission) => isSubmissionSelectable(submission))
        .map((submission) => submission.id),
    [isSubmissionSelectable, paginatedSubmissions]
  );

  const selectedSubmissions = useMemo(() => {
    if (!submissions || !selectedSubmissionIds.length) {
      return [];
    }

    const selectedSet = new Set(selectedSubmissionIds);
    return submissions.filter((submission) => selectedSet.has(submission.id));
  }, [selectedSubmissionIds, submissions]);

  const selectedSubmissionsWithAssignments = useMemo(() => {
    if (!selectedSubmissions.length) {
      return [];
    }

    return selectedSubmissions.filter((submission) =>
      Boolean(submission.reviewerAssignmentUserId)
    );
  }, [selectedSubmissions]);

  const selectedAssignedSubmissionIds = useMemo(
    () => selectedSubmissionsWithAssignments.map((submission) => submission.id),
    [selectedSubmissionsWithAssignments]
  );

  const selectedSubmissionsAssignableToCurrentReviewer = useMemo(() => {
    if (!currentReviewerId || !selectedSubmissions.length) {
      return [];
    }

    return selectedSubmissions.filter(
      (submission) =>
        !submission.reviewerAssignmentUserId ||
        submission.reviewerAssignmentUserId === currentReviewerId
    );
  }, [currentReviewerId, selectedSubmissions]);

  const selectedAssignableSubmissionIds = useMemo(
    () =>
      selectedSubmissionsAssignableToCurrentReviewer.map(
        (submission) => submission.id
      ),
    [selectedSubmissionsAssignableToCurrentReviewer]
  );

  const handleUnassignSubmission = (submissionId: string) => {
    if (!submissionId || unassignSubmission.isPending) {
      return;
    }

    unassignSubmission.mutate({ submissionId });
  };

  const visibleSelectedCount = visibleSelectableIds.filter((id) =>
    selectedSubmissionIds.includes(id)
  ).length;
  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectedCount === visibleSelectableIds.length;
  const partiallyVisibleSelected =
    visibleSelectedCount > 0 &&
    visibleSelectedCount < visibleSelectableIds.length;

  const selectedCount = selectedSubmissionIds.length;
  const selectionSummary = selectedCount
    ? `${selectedCount} submission${selectedCount === 1 ? "" : "s"} selected`
    : "No submissions selected";

  const handleToggleSelectAllVisible = (checked: boolean | string) => {
    if (!visibleSelectableIds.length) {
      return;
    }
    const shouldSelect = checked === true;
    setSelectedSubmissionIds((prev) => {
      if (shouldSelect) {
        const next = new Set(prev);
        visibleSelectableIds.forEach((id) => next.add(id));
        return Array.from(next);
      }
      return prev.filter((id) => !visibleSelectableIds.includes(id));
    });
  };

  const handleAssignSelected = async () => {
    if (!selectedSubmissionIds.length) {
      return;
    }
    if (!currentReviewerId) {
      toast({
        title: "Hang tight",
        description: "We're still loading your reviewer profile.",
      });
      return;
    }
    if (!selectedAssignableSubmissionIds.length) {
      toast({
        title: "Nothing to assign",
        description:
          "Select submissions that are unassigned or already assigned to you.",
      });
      return;
    }

    try {
      await assignSubmissions.mutateAsync({
        submissionIds: selectedAssignableSubmissionIds,
      });
    } catch (error) {
      // Errors handled by the mutation's onError handler
    }
  };

  const handleUnassignSelected = async () => {
    if (!selectedAssignedSubmissionIds.length || unassignSubmissions.isPending) {
      return;
    }

    try {
      await unassignSubmissions.mutateAsync({
        submissionIds: selectedAssignedSubmissionIds,
      });
    } catch (error) {
      // Handled by mutation
    }
  };

  const clearSelection = () => setSelectedSubmissionIds([]);
  const assignButtonDisabled =
    selectedAssignableSubmissionIds.length === 0 ||
    assignSubmissions.isPending ||
    !currentReviewerId;
  const unassignButtonDisabled =
    selectedAssignedSubmissionIds.length === 0 ||
    unassignSubmissions.isPending ||
    !currentReviewerId;

  const paginationItems = useMemo<(number | string)[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages = new Set<number>([1, totalPages]);
    for (let offset = -2; offset <= 2; offset += 1) {
      const candidate = currentPage + offset;
      if (candidate > 1 && candidate < totalPages) {
        pages.add(candidate);
      }
    }

    const sortedPages = Array.from(pages).sort((a, b) => a - b);
    const items: (number | string)[] = [];

    for (let index = 0; index < sortedPages.length; index += 1) {
      const page = sortedPages[index];
      if (index === 0) {
        items.push(page);
        continue;
      }

      const previousPage = sortedPages[index - 1];
      if (page - previousPage === 2) {
        items.push(previousPage + 1);
      } else if (page - previousPage > 2) {
        items.push(`ellipsis-${previousPage}`);
      }

      items.push(page);
    }

    return items;
  }, [currentPage, totalPages]);

  const startIndex = totalSubmissions === 0 ? 0 : (currentPage - 1) * pageSize;
  const displayFrom = totalSubmissions === 0 ? 0 : startIndex + 1;
  const displayTo =
    totalSubmissions === 0
      ? 0
      : Math.min(startIndex + paginatedSubmissions.length, totalSubmissions);

  useEffect(() => {
    if (!submissions) {
      setSelectedSubmissionIds([]);
      return;
    }

    setSelectedSubmissionIds((prev) =>
      prev.filter((submissionId) =>
        isSubmissionSelectable(
          submissions.find((submission) => submission.id === submissionId) ??
            null
        )
      )
    );
  }, [submissions, isSubmissionSelectable]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedSubmissionIds([]);
  }, [
    assignmentFilter,
    campaignFilter,
    sortOption,
    statusFilter,
    urlSearchTerm,
  ]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const goToPreviousPage = () =>
    setCurrentPage((prev) => Math.max(1, prev - 1));
  const goToNextPage = () =>
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Review Submissions
            </h1>
            <p className="text-muted-foreground">
              Approve or reject creator submissions and track their status.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-muted/30 p-1 w-fit">
          <Button
            type="button"
            size="sm"
            variant={clipKind === "campaign" ? "default" : "ghost"}
            onClick={() => setClipKind("campaign")}
          >
            Campaign clips
          </Button>
          <Button
            type="button"
            size="sm"
            variant={clipKind === "non-campaign" ? "default" : "ghost"}
            onClick={() => setClipKind("non-campaign")}
          >
            Non-campaign clips
          </Button>
        </div>

        {clipKind === "non-campaign" ? (
          <div className="mb-6 grid gap-3 md:grid-cols-2">
            <Select
              value={campaignFilter}
              onValueChange={(value) => setCampaignFilter(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filter by campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaignOptions.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {clipKind === "non-campaign" ? (
          <AdminNonCampaignReview campaignFilter={campaignFilter} />
        ) : (
        <>
        <div className="mb-4">
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Paste a clip link, or search by URL"
              className="pl-9"
              value={urlSearchTerm}
              onChange={(event) => setUrlSearchTerm(event.target.value)}
            />
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Select
            value={campaignFilter}
            onValueChange={(value) => setCampaignFilter(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaignOptions.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  <div className="flex flex-col">
                    <span className="font-medium">{campaign.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {campaign.submissionCount.toLocaleString()} submissions
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={assignmentFilter}
            onValueChange={(value) =>
              setAssignmentFilter(value as AssignmentFilter)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by assignment" />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNMENT_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            disabled={isLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status} className="capitalize">
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={platformFilter}
            onValueChange={(value) => setPlatformFilter(value)}
            disabled={platformOptions.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {platformOptions.map((option) => (
                <SelectItem key={option} value={option} className="capitalize">
                  {formatPlatformLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sortOption}
            onValueChange={(value) => setSortOption(value as SortOptionValue)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Sort submissions" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-muted/30 p-1">
          <Button
            type="button"
            size="sm"
            variant={viewMode === "cards" ? "default" : "ghost"}
            className="h-8 px-3 text-xs"
            onClick={() => setViewMode("cards")}
          >
            Cards
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "table" ? "default" : "ghost"}
            className="h-8 px-3 text-xs"
            onClick={() => setViewMode("table")}
          >
            Table
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading submissions...
            </div>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No submissions found</CardTitle>
              <CardDescription>
                No submissions match the current filters or search query. Try
                adjusting the campaign, status, or URL search.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Submissions</CardTitle>
              <CardDescription>
                Showing {displayFrom}-{displayTo} of {totalSubmissions}{" "}
                submission
                {totalSubmissions === 1 ? "" : "s"}{" "}
                {statusFilter === "pending"
                  ? "matching your filters."
                  : `with status ${statusFilter}.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Rows per page
                  </span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setCurrentPage(1);
                      setPageSize(
                        Number(value) as (typeof PAGE_SIZE_OPTIONS)[number]
                      );
                    }}
                  >
                    <SelectTrigger className="h-9 w-[130px]">
                      <SelectValue placeholder={`${pageSize} per page`} />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} per page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {selectionSummary}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedCount > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearSelection}
                      disabled={
                        assignSubmissions.isPending ||
                        unassignSubmissions.isPending
                      }
                    >
                      Clear selection
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUnassignSelected}
                    disabled={unassignButtonDisabled}
                  >
                    {unassignSubmissions.isPending ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Unassigning…
                      </span>
                    ) : (
                      "Unassign"
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAssignSelected}
                    disabled={assignButtonDisabled}
                  >
                    {assignSubmissions.isPending ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Assigning…
                      </span>
                    ) : (
                      "Assign"
                    )}
                  </Button>
                </div>
              </div>
              {viewMode === "table" ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            aria-label="Select all visible submissions"
                            checked={
                              allVisibleSelected
                                ? true
                                : partiallyVisibleSelected
                                ? "indeterminate"
                                : false
                            }
                            onCheckedChange={handleToggleSelectAllVisible}
                            disabled={visibleSelectableIds.length === 0}
                          />
                        </TableHead>
                        <TableHead>Submission</TableHead>
                        <TableHead>Non-campaign clips</TableHead>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Creator</TableHead>
                        <TableHead>UGC</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Review</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedSubmissions.map((submission) => {
                        const PlatformIcon = getPlatformIcon(
                          submission.platform
                        );
                        const assignedToYou =
                          submission.reviewerAssignmentUserId ===
                          currentReviewerId;
                        const assignedToAnother = Boolean(
                          submission.reviewerAssignmentUserId && !assignedToYou
                        );
                        const isRowSelectable =
                          isSubmissionSelectable(submission);
                        const assignmentName =
                          submission.reviewerAssignmentUserId
                            ? getAssignmentDisplayName(submission)
                            : null;
                        const isLocked = assignedToAnother;
                      const isUnassigning =
                        unassigningId === submission.id &&
                        unassignSubmission.isPending;
                      const hasViewCap =
                        typeof submission.maxViewCap === "number" &&
                        submission.maxViewCap >= 0;
                      const displayViews = hasViewCap
                        ? Math.min(submission.views, submission.maxViewCap)
                        : submission.views;
                      const formattedCap = hasViewCap
                        ? submission.maxViewCap?.toLocaleString()
                        : null;
                      const isViewCapUpdating =
                        setSubmissionViewCap.isPending &&
                        setSubmissionViewCap.variables?.submissionId ===
                          submission.id;
                      return (
                        <TableRow key={submission.id}>
                            <TableCell>
                              <Checkbox
                                aria-label="Select submission"
                                checked={selectedSubmissionIds.includes(
                                  submission.id
                                )}
                                onCheckedChange={(checked) =>
                                  toggleSubmissionSelection(
                                    submission.id,
                                    checked === true
                                  )
                                }
                                disabled={!isRowSelectable}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-2">
                                <a
                                  href={submission.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
                                >
                                  View
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-muted/40">
                                    <PlatformIcon className="h-4 w-4" />
                                  </span>
                                  <div className="flex flex-col leading-tight">
                                    <span className="capitalize text-[11px] text-muted-foreground">
                                      {submission.platform || "Unknown"}
                                    </span>
                                    <span>
                                      {displayViews.toLocaleString()} views
                                    </span>
                                    {hasViewCap && formattedCap && (
                                      <span className="text-[11px] text-muted-foreground">
                                        Capped at {formattedCap}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            {/* Non-campaign clips — same column slot for every row,
                                so the layout stays aligned. Each clip is its own
                                mini-block with platform icon, view count, and a
                                View button (matches the campaign clip cell style). */}
                            <TableCell>
                              {(submission.nonCampaignClips ?? []).length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  {(submission.nonCampaignClips ?? []).map(
                                    (nc, idx) => {
                                      const NcPlatformIcon = getPlatformIcon(
                                        nc.platform
                                      );
                                      return (
                                        <div
                                          key={`${nc.url}-${idx}`}
                                          className="flex flex-col gap-1"
                                        >
                                          <a
                                            href={nc.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                                          >
                                            #{idx + 1} View
                                            <ExternalLink className="h-3.5 w-3.5" />
                                          </a>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/50 bg-muted/40">
                                              <NcPlatformIcon className="h-3.5 w-3.5" />
                                            </span>
                                            <span className="capitalize">
                                              {nc.platform}
                                            </span>
                                            <span>
                                              • {(nc.views ?? 0).toLocaleString()} views
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    }
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">
                                {submission.campaignTitle || "Unknown campaign"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarImage
                                    src={submission.clerkImageUrl ?? undefined}
                                  />
                                  <AvatarFallback>
                                    {(submission.clerkFirstName || "U")
                                      .slice(0, 2)
                                      .toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {submission.clerkFirstName ||
                                    submission.clerkLastName
                                      ? `${submission.clerkFirstName ?? ""} ${
                                          submission.clerkLastName ?? ""
                                        }`.trim()
                                      : "Unverified account"}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {submission.clerkEmail || submission.userId}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {submission.isUserGeneratedContent ? (
                                <Badge className="border-transparent bg-emerald-100 text-emerald-800 shadow-sm dark:bg-emerald-500/30 dark:text-emerald-50">
                                  Yes
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {formatDate(submission.createdAt)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Badge
                                  variant="outline"
                                  className={`${getStatusBadgeStyles(
                                    submission.status
                                  )} max-w-fit`}
                                >
                                  {submission.status || "Unknown"}
                                </Badge>
                                {submission.baselineFrozenViews != null && (
                                  <Badge
                                    variant="outline"
                                    className="max-w-fit border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-100"
                                    title={`${submission.baselineFrozenViews.toLocaleString()} views held frozen in the payout baseline — reward reclaimed, no longer earns`}
                                  >
                                    Views frozen (
                                    {submission.baselineFrozenViews.toLocaleString()}
                                    )
                                  </Badge>
                                )}
                                {(submission.reviewerClerkFirstName ||
                                  submission.reviewerClerkLastName ||
                                  submission.reviewerClerkEmail ||
                                  submission.reviewerDiscordId) && (
                                  <p className="text-xs text-muted-foreground">
                                    Reviewed by{" "}
                                    {[
                                      submission.reviewerClerkFirstName,
                                      submission.reviewerClerkLastName,
                                    ]
                                      .filter(Boolean)
                                      .join(" ") ||
                                      submission.reviewerClerkEmail ||
                                      submission.reviewerDiscordId}
                                  </p>
                                )}
                                {submission.reviewerAssignmentUserId && (
                                  <p
                                    className={cn(
                                      "text-xs",
                                      assignedToYou
                                        ? "text-primary"
                                        : "text-destructive"
                                    )}
                                  >
                                    {assignedToYou
                                      ? "Assigned to you"
                                      : `Assigned to ${assignmentName}`}
                                  </p>
                                )}
                                {submission.rejectedReason && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-bold">Reason:</span>{" "}
                                    {submission.rejectedReason}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {processingId === submission.id && (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                )}
                                {processingId !== submission.id && (
                                  <>
                                    {submission.status !== "rejected" && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          openRejectDialog(submission.id)
                                        }
                                        disabled={
                                          processingId === submission.id ||
                                          isLocked
                                        }
                                      >
                                        <X className="h-4 w-4 mr-1" />
                                        Reject
                                      </Button>
                                    )}
                                    {submission.status !== "approved" && (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          handleStatusChange(
                                            submission.id,
                                            "approved"
                                          )
                                        }
                                        disabled={
                                          processingId === submission.id ||
                                          isLocked
                                        }
                                      >
                                        <Check className="h-4 w-4 mr-1" />
                                        Approve
                                      </Button>
                                    )}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-8 w-8 p-0"
                                          aria-label="More actions"
                                          disabled={isLocked}
                                        >
                                          <MoreVertical className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          onClick={() =>
                                            setConvertDialog({
                                              open: true,
                                              submissionId: submission.id,
                                              url: submission.url,
                                            })
                                          }
                                        >
                                          <ArrowLeftRight className="mr-2 h-4 w-4" />
                                          Convert to non-campaign clip
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </>
                                )}
                              </div>
                              {canManageViewCaps && (
                                <div className="mt-2 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openViewCapDialog(submission)}
                                    disabled={isViewCapUpdating}
                                  >
                                    {isViewCapUpdating ? (
                                      <span className="flex items-center gap-1">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Saving…
                                      </span>
                                    ) : hasViewCap && formattedCap ? (
                                      "Update cap"
                                    ) : (
                                      "Set view cap"
                                    )}
                                  </Button>
                                </div>
                              )}
                              {isLocked && assignmentName && (
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                  <p className="text-destructive">
                                    Locked for {assignmentName}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() =>
                                      handleUnassignSubmission(submission.id)
                                    }
                                    disabled={isUnassigning}
                                  >
                                    {isUnassigning ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      "Unassign"
                                    )}
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-muted bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2 font-medium uppercase tracking-wide">
                      <Checkbox
                        aria-label="Select all visible submissions"
                        checked={
                          allVisibleSelected
                            ? true
                            : partiallyVisibleSelected
                            ? "indeterminate"
                            : false
                        }
                        onCheckedChange={handleToggleSelectAllVisible}
                        disabled={visibleSelectableIds.length === 0}
                      />
                      Select all visible submissions
                    </div>
                    <Badge variant="outline" className="text-muted-foreground">
                      Card view
                    </Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {paginatedSubmissions.map((submission) => {
                      const PlatformIcon = getPlatformIcon(submission.platform);
                      const assignedToYou =
                        submission.reviewerAssignmentUserId ===
                        currentReviewerId;
                      const assignedToAnother = Boolean(
                        submission.reviewerAssignmentUserId && !assignedToYou
                      );
                      const isRowSelectable =
                        isSubmissionSelectable(submission);
                      const assignmentName = submission.reviewerAssignmentUserId
                        ? getAssignmentDisplayName(submission)
                        : null;
                      const isLocked = assignedToAnother;
                      const isUnassigning =
                        unassigningId === submission.id &&
                        unassignSubmission.isPending;
                      const isSelected = selectedSubmissionIds.includes(
                        submission.id
                      );
                      const hasViewCap =
                        typeof submission.maxViewCap === "number" &&
                        submission.maxViewCap >= 0;
                      const displayViews = hasViewCap
                        ? Math.min(submission.views, submission.maxViewCap)
                        : submission.views;
                      const formattedCap = hasViewCap
                        ? submission.maxViewCap?.toLocaleString()
                        : null;
                      const isViewCapUpdating =
                        setSubmissionViewCap.isPending &&
                        setSubmissionViewCap.variables?.submissionId ===
                          submission.id;
                      return (
                        <Card
                          key={submission.id}
                          className="flex h-full flex-col gap-4 border-border/60 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                aria-label="Select submission"
                                checked={isSelected}
                                onCheckedChange={(checked) =>
                                  toggleSubmissionSelection(
                                    submission.id,
                                    checked === true
                                  )
                                }
                                disabled={!isRowSelectable}
                                className="mt-1"
                              />
                              <div>
                                <a
                                  href={submission.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
                                >
                                  Open submission
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-muted/40">
                                    <PlatformIcon className="h-4 w-4" />
                                  </span>
                                  <span className="capitalize">
                                    {submission.platform || "Unknown"}
                                  </span>
                                  <span>
                                    • {displayViews.toLocaleString()} views
                                    {hasViewCap && formattedCap ? (
                                      <span className="ml-1 text-[11px]">
                                        (Cap {formattedCap})
                                      </span>
                                    ) : null}
                                  </span>
                                  {submission.isUserGeneratedContent && (
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-600/30 bg-emerald-500/10 text-[11px] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30"
                                    >
                                      UGC
                                    </Badge>
                                  )}
                                </div>
                                {/* Non-campaign clips — one row per clip,
                                    same format as the campaign clip line:
                                    platform icon + URL + view count. */}
                                {(submission.nonCampaignClips ?? []).length > 0 ? (
                                  <div className="mt-2 space-y-2 rounded-md border border-blue-200/40 bg-blue-500/5 p-2">
                                    {(submission.nonCampaignClips ?? []).map(
                                      (nc, idx) => {
                                        const NcPlatformIcon = getPlatformIcon(
                                          nc.platform
                                        );
                                        return (
                                          <div
                                            key={`${nc.url}-${idx}`}
                                            className="flex flex-col gap-1"
                                          >
                                            <a
                                              href={nc.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                                            >
                                              Non-campaign #{idx + 1} — View
                                              <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/50 bg-muted/40">
                                                <NcPlatformIcon className="h-3.5 w-3.5" />
                                              </span>
                                              <span className="capitalize">
                                                {nc.platform}
                                              </span>
                                              <span>
                                                • {(nc.views ?? 0).toLocaleString()} views
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      }
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                "px-2",
                                getStatusBadgeStyles(submission.status)
                              )}
                            >
                              {submission.status || "Unknown"}
                            </Badge>
                          </div>

                          <div className="grid gap-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Campaign
                              </p>
                              <p className="font-medium">
                                {submission.campaignTitle || "Unknown campaign"}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarImage
                                  src={submission.clerkImageUrl ?? undefined}
                                />
                                <AvatarFallback>
                                  {(submission.clerkFirstName || "U")
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="space-y-0.5">
                                <p className="font-medium">
                                  {submission.clerkFirstName ||
                                  submission.clerkLastName
                                    ? `${submission.clerkFirstName ?? ""} ${
                                        submission.clerkLastName ?? ""
                                      }`.trim()
                                    : "Unverified account"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {submission.clerkEmail || submission.userId}
                                </p>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Submitted {formatDate(submission.createdAt)}
                            </div>
                            {(submission.reviewerClerkFirstName ||
                              submission.reviewerClerkLastName ||
                              submission.reviewerClerkEmail ||
                              submission.reviewerDiscordId) && (
                              <div className="text-xs text-muted-foreground">
                                Reviewed by{" "}
                                {[
                                  submission.reviewerClerkFirstName,
                                  submission.reviewerClerkLastName,
                                ]
                                  .filter(Boolean)
                                  .join(" ") ||
                                  submission.reviewerClerkEmail ||
                                  submission.reviewerDiscordId}
                              </div>
                            )}
                            {submission.reviewerAssignmentUserId && (
                              <p
                                className={cn(
                                  "text-xs font-medium",
                                  assignedToYou
                                    ? "text-primary"
                                    : "text-destructive"
                                )}
                              >
                                {assignedToYou
                                  ? "Assigned to you"
                                  : `Assigned to ${assignmentName}`}
                              </p>
                            )}
                            {submission.rejectedReason && (
                              <p className="text-xs text-muted-foreground">
                                <span className="font-semibold">Reason:</span>{" "}
                                {submission.rejectedReason}
                              </p>
                            )}
                          </div>

                          <div className="mt-2 flex flex-col gap-2">
                            {submission.isUserGeneratedContent === false && (
                              <span className="text-xs text-muted-foreground">
                                Creator marked this as non-UGC content.
                              </span>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              {isLocked && assignmentName ? (
                                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                  <span className="text-destructive">
                                    Locked for {assignmentName}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() =>
                                      handleUnassignSubmission(submission.id)
                                    }
                                    disabled={isUnassigning}
                                  >
                                    {isUnassigning ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      "Unassign"
                                    )}
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {submission.isUserGeneratedContent
                                    ? "UGC verified"
                                    : "No UGC extras"}
                                </span>
                              )}
                              <div className="flex flex-wrap justify-end gap-2">
                                {processingId === submission.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : (
                                  <>
                                    {submission.status !== "rejected" && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          openRejectDialog(submission.id)
                                        }
                                        disabled={isLocked}
                                      >
                                        <X className="mr-1 h-4 w-4" /> Reject
                                      </Button>
                                    )}
                                    {submission.status !== "approved" && (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          handleStatusChange(
                                            submission.id,
                                            "approved"
                                          )
                                        }
                                        disabled={isLocked}
                                      >
                                        <Check className="mr-1 h-4 w-4" />{" "}
                                        Approve
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                              {canManageViewCaps && (
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openViewCapDialog(submission)}
                                    disabled={isViewCapUpdating}
                                  >
                                    {isViewCapUpdating ? (
                                      <span className="flex items-center gap-1">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Saving…
                                      </span>
                                    ) : hasViewCap && formattedCap ? (
                                      "Update cap"
                                    ) : (
                                      "Set view cap"
                                    )}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
              {totalPages > 1 && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-muted-foreground">
                    Showing {displayFrom}-{displayTo} of {totalSubmissions}{" "}
                    submission
                    {totalSubmissions === 1 ? "" : "s"}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={goToPreviousPage}
                      disabled={currentPage === 1}
                      className="gap-1 px-3"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <div className="flex items-center gap-1">
                      {paginationItems.map((item) =>
                        typeof item === "number" ? (
                          <Button
                            key={`page-${item}`}
                            type="button"
                            variant={item === currentPage ? "default" : "ghost"}
                            size="icon"
                            className={cn(
                              "h-9 w-9 rounded-full p-0 text-base font-semibold",
                              item === currentPage
                                ? "bg-primary text-primary-foreground hover:bg-primary"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            aria-current={
                              item === currentPage ? "page" : undefined
                            }
                            onClick={() => {
                              if (item !== currentPage) {
                                setCurrentPage(item);
                              }
                            }}
                          >
                            {item}
                          </Button>
                        ) : (
                          <span
                            key={item}
                            className="px-2 text-lg font-semibold text-muted-foreground"
                          >
                            ...
                          </span>
                        )
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={goToNextPage}
                      disabled={currentPage === totalPages}
                      className="gap-1 px-3"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        </>
        )}
      </div>

      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            closeRejectDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject submission</DialogTitle>
            <DialogDescription>
              Share a short note so the creator knows what to fix.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              placeholder="Explain why this submission is being rejected"
              value={rejectDialog.reason}
              onChange={(event) =>
                setRejectDialog((prev) => ({
                  ...prev,
                  reason: event.target.value,
                }))
              }
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Resubmission options</Label>
            <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
              <Checkbox
                id="prevent-resubmission"
                checked={rejectDialog.preventResubmission}
                onCheckedChange={(checked) =>
                  setRejectDialog((prev) => ({
                    ...prev,
                    preventResubmission: checked === true,
                  }))
                }
              />
              <div className="space-y-1">
                <Label
                  htmlFor="prevent-resubmission"
                  className="text-sm font-medium leading-none"
                >
                  Prevent resubmission
                </Label>
                <p className="text-sm text-muted-foreground">
                  Block the creator from resubmitting this clip after rejection.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRejectDialog}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={isRejectDisabled}
            >
              {isRejectingCurrent ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rejecting…
                </span>
              ) : (
                "Reject submission"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to non-campaign clip — confirmation */}
      <Dialog
        open={convertDialog.open}
        onOpenChange={(open) => setConvertDialog((p) => ({ ...p, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Convert to non-campaign clip
            </DialogTitle>
            <DialogDescription>
              Moves this clip out of the campaign queue and into the
              non-campaign review queue as <strong>pending</strong>. Use this
              when a clipper uploaded a non-campaign clip as a campaign clip by
              mistake. Blocked if the clip has already earned reward — reject
              it first in that case.
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
                setConvertDialog({ open: false, submissionId: null, url: "" })
              }
              disabled={convertToNonCampaign.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                convertDialog.submissionId &&
                convertToNonCampaign.mutate({
                  submissionId: convertDialog.submissionId,
                })
              }
              disabled={
                convertToNonCampaign.isPending || !convertDialog.submissionId
              }
            >
              {convertToNonCampaign.isPending ? (
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

      {canManageViewCaps && (
        <Dialog
          open={viewCapDialog.open}
          onOpenChange={(open) => {
            if (!open && !setSubmissionViewCap.isPending) {
              closeViewCapDialog();
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set view cap</DialogTitle>
              <DialogDescription>
                Limit the maximum number of views we will count for this clip.
                Leave the input blank to remove the cap.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="view-cap-input">Maximum views</Label>
              <Input
                id="view-cap-input"
                type="number"
                min={0}
                placeholder="e.g. 5000"
                value={viewCapDialog.inputValue}
                onChange={(event) =>
                  setViewCapDialog((prev) => ({
                    ...prev,
                    inputValue: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Current recorded views:{" "}
                <span className="font-semibold">
                  {viewCapDialog.currentViews.toLocaleString()}
                </span>
              </p>
              {viewCapDialog.maxViewCap !== null && (
                <p className="text-xs text-muted-foreground">
                  Existing cap:{" "}
                  <span className="font-semibold">
                    {viewCapDialog.maxViewCap.toLocaleString()} views
                  </span>
                </p>
              )}
            </div>
            <DialogFooter>
              {viewCapDialog.maxViewCap !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearViewCap}
                  disabled={setSubmissionViewCap.isPending}
                >
                  {setSubmissionViewCap.isPending ? "Removing…" : "Remove cap"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={closeViewCapDialog}
                disabled={setSubmissionViewCap.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveViewCap}
                disabled={setSubmissionViewCap.isPending}
              >
                {setSubmissionViewCap.isPending ? "Saving…" : "Save cap"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AppLayout>
  );
};

export default AdminSubmissions;
