import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { Loader2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AppRouter } from "../../../backend/src/routers";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { parseYouTubeUrl } from "@/lib/youtube";
import { CountryPicker } from "@/components/CountryPicker";

// Top 6 countries that consistently appear across all Atomik campaign
// demographics rollups (India, US, UK, Canada, Germany, Australia together
// cover ~92% of typical audience). Pre-populated as form rows so mods
// rarely need to type a country name.
const TOP_6_COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Germany",
  "Australia",
];

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  {
    label: "Created",
    value: "created",
    description: "Reward earned, snapshot created",
  },
  {
    label: "Awaiting",
    value: "active",
    description: "Demographics request activated",
  },
  {
    label: "Approved",
    value: "approved",
    description: "Demographics are confirmed",
  },
  {
    label: "Needs review",
    value: "needs-human-review",
    description: "Awaiting moderator review",
  },
  {
    label: "Rejected",
    value: "rejected",
    description: "Verification was declined",
  },
  {
    label: "Cancelled",
    value: "cancelled",
    description: "Request was voided",
  },
] as const;

const APPROVAL_METHOD_FILTERS = [
  { label: "All approval methods", value: "all" },
  { label: "Moderator approval", value: "mod" },
  { label: "Creator approval", value: "user" },
  { label: "API approval", value: "api" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
type ApprovalMethodFilter = (typeof APPROVAL_METHOD_FILTERS)[number]["value"];
type ApprovalMethodValue = Exclude<ApprovalMethodFilter, "all">;

type RouterInput = inferRouterInputs<AppRouter>;
type RouterOutput = inferRouterOutputs<AppRouter>;
type AdminListClaimsInput = NonNullable<
  RouterInput["demographicsVerification"]["adminListClaims"]
>;
type AdminClaimsResponse =
  RouterOutput["demographicsVerification"]["adminListClaims"];
type AdminClaim = AdminClaimsResponse["data"][number];

const statusMeta: Record<
  AdminClaim["status"] | "unknown",
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  created: { label: "Created", variant: "secondary" },
  active: { label: "Awaiting", variant: "default" },
  pending: { label: "Pending confirmation", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  "needs-human-review": { label: "Needs review", variant: "destructive" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  unknown: { label: "Unknown", variant: "secondary" },
};

const approvalMethodLabels: Record<ApprovalMethodValue, string> = {
  mod: "Approved by moderator",
  user: "Approved via creator attestation",
  api: "Approved via API import",
};

const formatDate = (value?: Date | string | null) => {
  if (!value) return "N/A";
  const parsed = new Date(value);
  return parsed.toLocaleString();
};

const getOwnerDisplay = (claim: AdminClaim) => {
  const fullName = [claim.ownerFirstName, claim.ownerLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) return fullName;
  if (claim.ownerEmail) return claim.ownerEmail;
  return claim.userId;
};

const AdminDemographicsVerification = () => {
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("needs-human-review");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [approvalMethodFilter, setApprovalMethodFilter] =
    useState<ApprovalMethodFilter>("all");
  const [campaignFilter, setCampaignFilter] = useState<string | null>(null);
  // Default "actionable". Unscoped, this list counted every row ever created:
  // "Awaiting" read 472 while only 78 belonged to a running campaign on the
  // current cycle, so the total barely moved however much was cleared and it
  // looked as though approvals were coming back. Rows a clipper has actually
  // FILED are never hidden — those are a moderator's job whenever they arrived.
  const [scope, setScope] = useState<"actionable" | "all">("actionable");
  const [page, setPage] = useState(1);
  const [ownerSearchInput, setOwnerSearchInput] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setOwnerSearch(ownerSearchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [ownerSearchInput, setPage]);

  const { data: campaignList, isLoading: isLoadingCampaignList } =
    trpc.campaigns.getAll.useQuery();

  const campaignFilterOptions = useMemo(() => {
    const allCampaigns = (campaignList ?? []).map((campaign) => ({
      id: campaign.id,
      title: campaign.title || "Untitled campaign",
    }));

    return [{ id: "all", title: "All campaigns" }, ...allCampaigns];
  }, [campaignList]);

  const queryInput = useMemo<AdminListClaimsInput>(() => {
    const input: AdminListClaimsInput = {
      status: statusFilter,
      page,
      limit: PAGE_SIZE,
    };

    if (approvalMethodFilter !== "all") {
      input.approvalMethod = approvalMethodFilter;
    }

    if (campaignFilter) {
      input.campaignId = campaignFilter;
    }

    input.scope = scope;

    const trimmedSearch = ownerSearch.trim();
    if (trimmedSearch.length > 0) {
      input.search = trimmedSearch;
    }

    return input;
  }, [approvalMethodFilter, campaignFilter, ownerSearch, page, scope, statusFilter]);

  const {
    data: claimsResponse,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = trpc.demographicsVerification.adminListClaims.useQuery(queryInput, {
    keepPreviousData: true,
  });

  const claims = claimsResponse?.data ?? [];
  const total = claimsResponse?.total ?? 0;
  const limit = claimsResponse?.limit ?? PAGE_SIZE;
  const currentPage = claimsResponse?.page ?? page;
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const pageStart = total === 0 ? 0 : (currentPage - 1) * limit + 1;
  const pageEnd = total === 0 ? 0 : pageStart + claims.length - 1;
  const showingRangeText =
    total === 0
      ? "Showing 0 requests"
      : `Showing ${pageStart}-${pageEnd} of ${total} requests`;

  useEffect(() => {
    if (!claimsResponse) return;

    if (total === 0 && page !== 1) {
      setPage(1);
      return;
    }

    if (total > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [claimsResponse, page, total, totalPages]);

  const { data: selectedClaim, isLoading: isDetailsLoading } =
    trpc.demographicsVerification.adminGetClaim.useQuery(
      { id: selectedClaimId ?? "" },
      { enabled: detailsOpen && Boolean(selectedClaimId) }
    );

  const demographicsCountries = useMemo(() => {
    if (!selectedClaim?.parsedData?.countries) return [];
    return [...selectedClaim.parsedData.countries].sort(
      (a, b) => b.percentage - a.percentage
    );
  }, [selectedClaim?.parsedData]);

  const claimCampaignOptions = useMemo(() => {
    if (!claims) return [];
    const seen = new Map<string, string | undefined>();
    claims.forEach((claim) => {
      if (claim.campaignId) {
        seen.set(claim.campaignId, claim.campaignTitle ?? undefined);
      }
    });
    return Array.from(seen.entries()).map(([id, title]) => ({
      id,
      title: title ?? "Untitled campaign",
    }));
  }, [claims]);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null
  );

  // Reports filed through the older submit path recorded a 0 view total. The
  // rollup weights each report by that number, so those rows count for nothing
  // until they're repaired — and approving one bakes the 0 in for good.
  const snapshotStatus =
    trpc.demographicsVerification.repairViewSnapshotsStatus.useQuery();
  const repairSnapshotsMutation =
    trpc.demographicsVerification.repairViewSnapshots.useMutation({
      onSuccess: (result) => {
        toast({
          title: `Repaired ${result.repaired} view snapshot${result.repaired === 1 ? "" : "s"}`,
          description:
            result.leftAtZero > 0
              ? `${result.leftAtZero} left at 0 — those accounts have no approved views, so 0 is correct.`
              : "Every report awaiting review now carries its real view total.",
        });
        void snapshotStatus.refetch();
        refetch();
      },
      onError: (error) => {
        toast({
          title: "Repair failed",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const updateCampaignMutation =
    trpc.demographicsVerification.updateCampaignDemographics.useMutation({
      onSuccess: () => {
        toast({
          title: "Campaign demographics updated",
          description: "Campaign-level demographics were refreshed.",
        });
      },
      onError: (error) => {
        toast({
          title: "Failed to update",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const handleUpdateCampaign = async (campaignId?: string | null) => {
    if (!campaignId) {
      toast({
        title: "Missing campaign",
        description: "This verification is not linked to a campaign.",
        variant: "destructive",
      });
      return;
    }
    await updateCampaignMutation.mutateAsync({ campaignId });
  };

  const updateStatusMutation =
    trpc.demographicsVerification.adminUpdateStatus.useMutation({
      onSuccess: () => {
        toast({
          title: "Request updated",
          description: "The verification status has been updated.",
        });
        refetch();
      },
      onError: (error) => {
        toast({
          title: "Unable to update",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const handleRejectClaim = async (claimId: string) => {
    await updateStatusMutation.mutateAsync({ id: claimId, status: "rejected" });
  };

  const handleModApproveClaim = async (claimId: string) => {
    await updateStatusMutation.mutateAsync({
      id: claimId,
      approvalMethod: "mod",
      status: "approved",
    });
  };

  const handleCancelClaim = async (claimId: string) => {
    await updateStatusMutation.mutateAsync({
      id: claimId,
      status: "cancelled",
    });
  };

  // ── Country breakdown form state (used in the review dialog) ──
  const [demographics, setDemographics] = useState<Record<string, string>>({});
  const [customCountries, setCustomCountries] = useState<string[]>([]);

  // Prefill the form when a claim opens (handles re-review of already-graded
  // claims). Resets when dialog closes so old data doesn't bleed into the
  // next claim.
  useEffect(() => {
    if (!detailsOpen) {
      setDemographics({});
      setCustomCountries([]);
      return;
    }
    if (!selectedClaim?.parsedData?.countries) return;
    const next: Record<string, string> = {};
    const custom: string[] = [];
    selectedClaim.parsedData.countries.forEach((c) => {
      if (!c?.country || c.country === "Other") return;
      next[c.country] = String(c.percentage);
      if (!TOP_6_COUNTRIES.includes(c.country)) custom.push(c.country);
    });
    setDemographics(next);
    setCustomCountries(custom);
  }, [detailsOpen, selectedClaim?.id, selectedClaim?.parsedData]);

  // Parse the submitted YouTube URL once so the dialog can branch on
  // horizontal vs vertical (Short) layout without re-parsing in JSX.
  const selectedVideo = useMemo(() => {
    if (!selectedClaim?.recordingUrl) return null;
    return parseYouTubeUrl(selectedClaim.recordingUrl);
  }, [selectedClaim?.recordingUrl]);

  const totalEnteredPct = useMemo(() => {
    return Object.values(demographics).reduce((acc, v) => {
      const n = parseFloat(v);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [demographics]);

  const otherPercentage = Math.max(0, 100 - totalEnteredPct);

  const handleRemoveCustomCountry = (country: string) => {
    setCustomCountries(customCountries.filter((c) => c !== country));
    const next = { ...demographics };
    delete next[country];
    setDemographics(next);
  };

  const buildParsedDataPayload = () => {
    const result: { country: string; percentage: number }[] = [];
    [...TOP_6_COUNTRIES, ...customCountries].forEach((c) => {
      const v = parseFloat(demographics[c] ?? "");
      if (Number.isFinite(v) && v > 0) {
        result.push({ country: c, percentage: v });
      }
    });
    if (otherPercentage > 0) {
      result.push({
        country: "Other",
        percentage: Number(otherPercentage.toFixed(2)),
      });
    }
    return result.length > 0 ? { countries: result } : undefined;
  };

  const handleDialogApprove = async () => {
    if (!selectedClaim) return;
    if (totalEnteredPct > 100) {
      toast({
        variant: "destructive",
        title: "Country percentages exceed 100%",
        description: "Adjust the entered values so the total is 100% or less.",
      });
      return;
    }
    await updateStatusMutation.mutateAsync({
      id: selectedClaim.id,
      approvalMethod: "mod",
      status: "approved",
      parsedData: buildParsedDataPayload(),
    });
    closeDetails();
  };

  const handleDialogReject = async () => {
    if (!selectedClaim) return;
    await updateStatusMutation.mutateAsync({
      id: selectedClaim.id,
      status: "rejected",
    });
    closeDetails();
  };

  const handleDialogCancel = async () => {
    if (!selectedClaim) return;
    await updateStatusMutation.mutateAsync({
      id: selectedClaim.id,
      status: "cancelled",
    });
    closeDetails();
  };

  // Deep-link support: /admin/demographics-verification?openClaim=demo-claim-001
  // auto-opens the review dialog. Useful for QA, demos, and sharing links.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const claimToOpen = searchParams.get("openClaim");
    if (claimToOpen && !detailsOpen) {
      setSelectedClaimId(claimToOpen);
      setDetailsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openDetails = (claimId: string) => {
    setSelectedClaimId(claimId);
    setDetailsOpen(true);
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    setSelectedClaimId(null);
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-muted-foreground">
                Admin • Demographics
              </p>
              <h1 className="text-3xl font-semibold">
                Review audience demographics
              </h1>
              <p className="text-muted-foreground">
                Monitor every demographics verification request submitted by
                creators across campaigns.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={statusFilter}
                onValueChange={(value: StatusFilter) => {
                  setStatusFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      <div className="flex flex-col text-left">
                        <span className="font-medium text-foreground">
                          {filter.label}
                        </span>
                        {statusFilter !== filter.value && (
                          <span className="text-xs text-muted-foreground">
                            {filter.description}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={scope}
                onValueChange={(value: "actionable" | "all") => {
                  setScope(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="actionable">
                    Actionable only
                  </SelectItem>
                  <SelectItem value="all">
                    Include closed campaigns &amp; old cycles
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={approvalMethodFilter}
                onValueChange={(value: ApprovalMethodFilter) => {
                  setApprovalMethodFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Approval method" />
                </SelectTrigger>
                <SelectContent>
                  {APPROVAL_METHOD_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={campaignFilter ?? "all"}
                onValueChange={(value) => {
                  const nextValue = value === "all" ? null : value;
                  setCampaignFilter(nextValue);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  className="w-[240px]"
                  disabled={isLoadingCampaignList}
                >
                  <SelectValue
                    placeholder={
                      isLoadingCampaignList ? "Loading campaigns..." : "Campaign"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {campaignFilterOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="search"
                placeholder="Search creators"
                value={ownerSearchInput}
                onChange={(event) => setOwnerSearchInput(event.target.value)}
                className="w-full min-w-[220px] md:w-64"
                aria-label="Search handles"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
                  </span>
                ) : (
                  "Refresh"
                )}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Verification requests</CardTitle>
                  <CardDescription>{showingRangeText}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading verification requests...
                </div>
              ) : isError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  We couldn't load demographics verifications. Please try again.
                </div>
              ) : claims && claims.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Creator</TableHead>
                        <TableHead>Handle</TableHead>
                        <TableHead className="text-right">
                          Views snapshot
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claims.map((claim) => {
                        const meta =
                          statusMeta[claim.status] ?? statusMeta.unknown;
                        return (
                          <TableRow key={claim.id}>
                            <TableCell>
                              <div className="font-medium">
                                {claim.campaignTitle ?? "Campaign"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Requested {formatDate(claim.createdAt)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">
                                {getOwnerDisplay(claim)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {claim.ownerEmail ?? claim.userId}
                              </div>
                            </TableCell>
                            <TableCell>
                              @
                              {claim.verifiedHandle ??
                                claim.verifiedUsername ??
                                "unknown"}
                            </TableCell>
                            <TableCell className="text-right">
                              {typeof claim.viewsFromSnapshot === "number"
                                ? claim.viewsFromSnapshot.toLocaleString()
                                : "N/A"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={meta.variant}>{meta.label}</Badge>
                              {claim.status === "approved" &&
                                claim.approvalMethod && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {approvalMethodLabels[
                                      claim.approvalMethod as ApprovalMethodValue
                                    ] ?? `Approved via ${claim.approvalMethod}`}
                                  </p>
                                )}
                            </TableCell>
                            <TableCell>{formatDate(claim.updatedAt)}</TableCell>
                            <TableCell className="text-right">
                              <div className="space-y-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => openDetails(claim.id)}
                                >
                                  View details
                                </Button>
                                <div className="flex gap-2">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={updateStatusMutation.isPending}
                                    onClick={() =>
                                      handleModApproveClaim(claim.id)
                                    }
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={updateStatusMutation.isPending}
                                    onClick={() => handleRejectClaim(claim.id)}
                                  >
                                    Reject
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={updateStatusMutation.isPending}
                                    onClick={() => handleCancelClaim(claim.id)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {showingRangeText} • Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1 || isFetching}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPage((prev) =>
                            totalPages === 0
                              ? prev
                              : Math.min(totalPages, prev + 1)
                          )
                        }
                        disabled={currentPage >= totalPages || isFetching}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <p className="text-base font-medium text-foreground">
                    No demographics requests match this filter
                  </p>
                  <p className="max-w-md text-sm">
                    Try selecting another status or check back later when
                    creators upload new verification screenshots.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          {(snapshotStatus.data?.awaitingRepair ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Fix missing view snapshots</CardTitle>
                <CardDescription>
                  {snapshotStatus.data?.awaitingRepair} report
                  {snapshotStatus.data?.awaitingRepair === 1 ? "" : "s"} awaiting
                  review {snapshotStatus.data?.awaitingRepair === 1 ? "shows" : "show"}{" "}
                  0 views because an older version of the submission form never
                  recorded the total. The campaign rollup weights each report by
                  this number, so these currently count for nothing — and
                  approving one locks the 0 in. Run this before reviewing them.
                  {(snapshotStatus.data?.approvedAtZero ?? 0) > 0 && (
                    <>
                      {" "}
                      ({snapshotStatus.data?.approvedAtZero} already-approved
                      report
                      {snapshotStatus.data?.approvedAtZero === 1 ? " is" : "s are"}{" "}
                      also at 0 and are deliberately left alone — changing them
                      would move demographics that may already have gone to a
                      client.)
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => repairSnapshotsMutation.mutate()}
                  disabled={repairSnapshotsMutation.isPending}
                >
                  {repairSnapshotsMutation.isPending
                    ? "Repairing..."
                    : `Repair ${snapshotStatus.data?.awaitingRepair} snapshot${snapshotStatus.data?.awaitingRepair === 1 ? "" : "s"}`}
                </Button>
              </CardContent>
            </Card>
          )}
          {claimCampaignOptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Update campaign demographics</CardTitle>
                <CardDescription>
                  Refresh the aggregated demographics for a selected campaign.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="w-full sm:max-w-sm">
                  <Select
                    value={selectedCampaignId ?? undefined}
                    onValueChange={(value) => setSelectedCampaignId(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      {claimCampaignOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => handleUpdateCampaign(selectedCampaignId)}
                  disabled={
                    !selectedCampaignId || updateCampaignMutation.isPending
                  }
                >
                  {updateCampaignMutation.isPending
                    ? "Updating..."
                    : "Run update"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Dialog
        open={detailsOpen}
        onOpenChange={(open) => (open ? setDetailsOpen(true) : closeDetails())}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Demographics review</DialogTitle>
            <DialogDescription>
              {selectedClaim
                ? `${selectedClaim.campaignTitle ?? "Campaign"} • @${
                    selectedClaim.verifiedHandle ??
                    selectedClaim.verifiedUsername ??
                    "unknown"
                  }`
                : "Watch the recording and decide whether the audience country breakdown is acceptable."}
            </DialogDescription>
          </DialogHeader>
          {isDetailsLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading details...
            </div>
          ) : selectedClaim ? (
            <div className="space-y-3">
              {selectedClaim.exemptionReason ? (
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="text-xs uppercase text-muted-foreground">
                    Exemption request reason
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground">
                    {selectedClaim.exemptionReason}
                  </p>
                </div>
              ) : null}

              {/* What the clipper submitted — shown prominently so the mod
                   can compare against the video before touching the form. */}
              {demographicsCountries.length > 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Clipper submitted these values
                  </p>
                  <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">
                    Watch the video and confirm each percentage matches. Edit
                    in the form below if anything is wrong.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {demographicsCountries.map((c) => (
                      <span
                        key={c.country}
                        className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                      >
                        {c.country}: {c.percentage}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    Clipper did not submit a country breakdown
                  </p>
                  <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                    Watch the video and enter the percentages yourself in the
                    form below.
                  </p>
                </div>
              )}

              {/* Vertical videos: video on left, form on right (wider video).
                   Horizontal videos: stacked (video on top, form below). */}
              <div
                className={
                  selectedVideo?.isShort
                    ? "flex items-start gap-4"
                    : "space-y-3"
                }
              >
                <div className={selectedVideo?.isShort ? "shrink-0" : ""}>
                  {!selectedClaim.recordingUrl ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No recording submitted yet.
                    </p>
                  ) : !selectedVideo ? (
                    <a
                      href={selectedClaim.recordingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm text-primary underline break-all"
                    >
                      {selectedClaim.recordingUrl}
                    </a>
                  ) : (
                    <div className="space-y-1">
                      <div
                        className={
                          selectedVideo.isShort
                            ? "aspect-[9/16] w-[280px] overflow-hidden rounded-lg border bg-black"
                            : "mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-lg border bg-black"
                        }
                      >
                        <iframe
                          src={selectedVideo.embedUrl}
                          title="Demographics screen recording"
                          className="h-full w-full"
                          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                      <div className="text-center">
                        <a
                          href={selectedClaim.recordingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground underline break-all"
                        >
                          Open on YouTube ↗
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Country breakdown form */}
                <div
                  className={
                    (selectedVideo?.isShort ? "flex-1 " : "") +
                    "space-y-3 rounded-lg border bg-muted/30 p-4"
                  }
                >
                <div>
                  <h3 className="text-sm font-semibold">
                    Confirm / edit the country breakdown
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Pre-filled from the clipper's submission (if any). Edit
                    any value that's wrong, and add countries the clipper
                    missed using "+ Add other country".
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  {TOP_6_COUNTRIES.map((country) => (
                    <div
                      key={country}
                      className="grid grid-cols-[1fr_56px] sm:grid-cols-[1fr_70px] items-center gap-2"
                    >
                      <span className="text-sm">{country}</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        placeholder="0"
                        value={demographics[country] ?? ""}
                        onChange={(e) =>
                          setDemographics({
                            ...demographics,
                            [country]: e.target.value,
                          })
                        }
                        className="h-8 text-right"
                      />
                    </div>
                  ))}

                  {customCountries.map((country) => (
                    <div
                      key={country}
                      className="grid grid-cols-[1fr_48px_32px] sm:grid-cols-[1fr_70px_28px] items-center gap-1"
                    >
                      <span className="text-sm truncate">{country}</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        placeholder="0"
                        value={demographics[country] ?? ""}
                        onChange={(e) =>
                          setDemographics({
                            ...demographics,
                            [country]: e.target.value,
                          })
                        }
                        className="h-8 text-right"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => handleRemoveCustomCountry(country)}
                        title="Remove this country"
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Other - auto-calculated, spans full width */}
                <div className="grid grid-cols-[1fr_70px] items-center gap-2 border-t pt-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    Other (auto-calculated)
                  </span>
                  <div className="text-right text-sm font-mono">
                    {otherPercentage.toFixed(1)}
                  </div>
                </div>

                {/* + Add other country — searchable dropdown from canonical ISO list */}
                <CountryPicker
                  excluded={[...TOP_6_COUNTRIES, ...customCountries]}
                  onPick={(country) => {
                    if (
                      !TOP_6_COUNTRIES.includes(country) &&
                      !customCountries.includes(country)
                    ) {
                      setCustomCountries([...customCountries, country]);
                    }
                  }}
                />

                <div className="flex items-center justify-between border-t pt-2 text-xs">
                  <span className="text-muted-foreground">
                    Total entered: {totalEnteredPct.toFixed(1)}% + Other{" "}
                    {otherPercentage.toFixed(1)}% ={" "}
                    {(totalEnteredPct + otherPercentage).toFixed(1)}%
                  </span>
                  {totalEnteredPct > 100 && (
                    <span className="text-destructive">
                      ⚠ Over 100% — adjust before approving
                    </span>
                  )}
                </div>
                </div>
              </div>

              {/* In-dialog action buttons */}
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button
                  variant="ghost"
                  onClick={handleDialogCancel}
                  disabled={updateStatusMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDialogReject}
                  disabled={updateStatusMutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  onClick={handleDialogApprove}
                  disabled={
                    updateStatusMutation.isPending || totalEnteredPct > 100
                  }
                >
                  {updateStatusMutation.isPending
                    ? "Saving..."
                    : "Approve with this breakdown"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a verification request to view its details.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default AdminDemographicsVerification;
