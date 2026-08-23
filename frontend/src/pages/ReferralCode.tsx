import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  Copy,
  Share2,
  Instagram,
  Twitter,
  Youtube,
  Music2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ReferralCodePage = () => {
  const { toast } = useToast();
  const {
    data: referralCodeData,
    isLoading: isLoadingCode,
    refetch: refetchReferralCode,
  } = trpc.referrals.getMyReferralCode.useQuery();
  const { data: referralStatus, refetch: refetchReferralStatus } =
    trpc.referrals.getMyReferralStatus.useQuery();
  const { mutateAsync: createReferralCode, isPending: isCreating } =
    trpc.referrals.createReferralCode.useMutation();
  const { mutateAsync: applyReferralCode, isPending: isApplyingReferral } =
    trpc.referrals.attachReferralToUser.useMutation();
  const {
    mutateAsync: regenerateShareCard,
    isPending: isRegeneratingShareCard,
  } = trpc.referrals.regenerateShareCard.useMutation();

  const [referralCodeInput, setReferralCodeInput] = useState("");

  const referralCode = referralCodeData?.code ?? null;
  const shareCardUrl = referralCodeData?.shareCardUrl ?? null;
  const { data: referredUsersData, isLoading: isLoadingReferredUsers } =
    trpc.referrals.getMyReferredUsers.useQuery(undefined, {
      enabled: Boolean(referralCode),
    });
  const referralLink = useMemo(() => {
    if (!referralCode || typeof window === "undefined") {
      return null;
    }
    const url = new URL(window.location.origin);
    url.searchParams.set("referral_code", referralCode);
    return url.toString();
  }, [referralCode]);

  const boostEndsAtLabel = referralStatus?.boostEndsAt
    ? new Date(referralStatus.boostEndsAt).toLocaleString()
    : null;

  const referredUsers = referredUsersData ?? [];

  const referredByLabel = useMemo(() => {
    if (!referralStatus) {
      return null;
    }
    return (
      referralStatus.referrerDiscordUsername ||
      referralStatus.referrerEmail ||
      referralStatus.referrerDiscordId ||
      "Another creator"
    );
  }, [referralStatus]);

  const handleCreateReferralCode = async () => {
    try {
      const result = await createReferralCode();
      toast({
        title: "Referral code created",
        description: `Your code ${result.code} is ready to share.`,
      });
      await refetchReferralCode();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to create a referral code.";
      toast({
        title: "Couldn't create referral code",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleRegenerateShareCard = async () => {
    try {
      await regenerateShareCard();
      toast({
        title: "Share image refreshed",
        description: "Your card now reflects the latest total earned.",
      });
      await refetchReferralCode();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to regenerate the share card.";
      toast({
        title: "Couldn't refresh share image",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleCopy = async (value: string, label: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast({
        title: "Clipboard unavailable",
        description: "Copy this manually from the text field.",
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: `${label} copied`,
        description: value,
      });
    } catch (error) {
      console.error("Failed to copy to clipboard", error);
      toast({
        title: "Copy failed",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleShare = async (value: string | null) => {
    if (!value) {
      toast({
        title: "Share unavailable",
        description: "We couldn't build the referral link.",
        variant: "destructive",
      });
      return;
    }

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join me on Atomik Clips",
          text: "Use my referral link to sign up",
          url: value,
        });
        toast({ title: "Referral link shared" });
        return;
      } catch (error) {
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (!isAbort) {
          console.error("Failed to invoke share dialog", error);
          toast({
            title: "Share unavailable",
            description: "Copy the link instead.",
            variant: "destructive",
          });
        }
      }
    }

    await handleCopy(value, "Referral link");
  };

  const handleApplyReferralCode = async () => {
    const trimmed = referralCodeInput.trim();
    if (!trimmed) {
      toast({
        title: "Enter a referral code",
        description: "Paste the code you received before applying it.",
      });
      return;
    }

    try {
      const result = await applyReferralCode({ code: trimmed });

      if (result.attached) {
        toast({
          title: "Referral applied",
          description: "Thanks for letting us know who referred you!",
        });
        setReferralCodeInput("");
        await refetchReferralStatus();
        return;
      }

      const reasonMessages: Record<string, string> = {
        FEATURE_NOT_ELIGIBLE:
          "Referral codes only work for accounts created after the referral program launched.",
        HAS_REWARDS:
          "Referral codes must be applied before earning any rewards.",
        SELF_REFERRAL: "You can't refer yourself.",
        ALREADY_ATTACHED: "Your account already has a referral applied.",
      };

      const message = reasonMessages[result.reason ?? ""];
      toast({
        title: "Referral not applied",
        description: message ?? "Please double-check the code and try again.",
        variant: "destructive",
      });
    } catch (error) {
      console.error("Failed to apply referral code", error);
      toast({
        title: "Couldn't apply referral",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-6 py-4 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Referral Codes</h1>
          <p className="text-muted-foreground">
            Share your personal referral link to earn <b>10%</b> of your
            friends' view rewards. Referred creators enjoy a{" "}
            <b>10% earnings boost</b> for their first 10 days.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your referral code</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingCode ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your
                code...
              </div>
            ) : referralCode ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border bg-muted px-4 py-2 text-2xl font-semibold tracking-widest">
                    {referralCode}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(referralCode, "Referral code")}
                  >
                    <Copy className="h-4 w-4 mr-2" /> Copy code
                  </Button>
                </div>
                {referralLink ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-sm">
                      {referralLink}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleCopy(referralLink, "Referral link")
                        }
                      >
                        <Copy className="h-4 w-4 mr-2" /> Copy link
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleShare(referralLink)}
                      >
                        <Share2 className="h-4 w-4 mr-2" /> Share
                      </Button>
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Share this link anywhere—anyone who starts getting views will
                  earn you rewards.
                </p>
                {shareCardUrl ? (
                  <div className="rounded-xl border border-dashed border-muted bg-muted/15 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      SHARE ON SOCIAL MEDIA
                    </p>
                    {/* <p className="mt-2 text-sm font-medium text-foreground">
                      Join me on Atomik Growth and collect your boost.
                    </p> */}
                    <div className="mt-3 flex flex-wrap gap-2 text-muted-foreground">
                      {[Instagram, Twitter].map((Icon, index) => (
                        <span
                          key={`share-platform-${index}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/50 bg-background/80"
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                      ))}
                    </div>

                    <a
                      href={shareCardUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 block overflow-hidden rounded-2xl border border-border/60 bg-background transition hover:ring-2 hover:ring-primary/30"
                    >
                      <img
                        src={shareCardUrl}
                        alt="Sample referral share card"
                        className="block h-auto w-full"
                        loading="lazy"
                      />
                    </a>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        Need a fresh screenshot after a payout? Regenerate it
                        anytime.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {/* <Button asChild size="sm" variant="secondary">
                          <a
                            href={shareCardUrl}
                            download
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download image
                          </a>
                        </Button> */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRegeneratingShareCard}
                          onClick={handleRegenerateShareCard}
                        >
                          {isRegeneratingShareCard ? (
                            <>
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              Updating...
                            </>
                          ) : (
                            "Regenerate image"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {referredUsers.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Creators using your code
                      </p>
                      {isLoadingReferredUsers ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Syncing
                        </span>
                      ) : null}
                    </div>
                    {isLoadingReferredUsers ? (
                      <p className="text-sm text-muted-foreground">
                        Checking for referred creators...
                      </p>
                    ) : referredUsers.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Creator</TableHead>
                            <TableHead className="text-right">
                              Referred on
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {referredUsers.map((user) => {
                            const displayName =
                              user.discordUsername ||
                              user.referredUserId ||
                              "Unknown user";
                            const referredAtLabel = new Date(
                              user.referredAt
                            ).toLocaleDateString();

                            return (
                              <TableRow key={user.id}>
                                <TableCell className="font-medium">
                                  {displayName}
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                  {referredAtLabel}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No creators have applied your code yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  You haven't created a referral code yet.
                </p>
                <Button
                  onClick={handleCreateReferralCode}
                  disabled={isCreating}
                  size="lg"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    "Generate referral code"
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Were you referred?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {referralStatus ? (
              <Alert>
                <AlertTitle>Referral applied</AlertTitle>
                <AlertDescription>
                  {`You were referred by ${referredByLabel}.`}
                  {boostEndsAtLabel
                    ? ` Your 10% earnings boost lasts until ${boostEndsAtLabel}.`
                    : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Enter the referral code that was shared with you. Codes only work
              for new accounts that haven't earned rewards yet.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder="Enter referral code"
                value={referralCodeInput}
                onChange={(event) => setReferralCodeInput(event.target.value)}
                className="sm:flex-1"
              />
              <Button
                onClick={handleApplyReferralCode}
                disabled={isApplyingReferral}
                className="sm:w-auto"
              >
                {isApplyingReferral ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Applying...
                  </>
                ) : (
                  "Apply code"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ReferralCodePage;
