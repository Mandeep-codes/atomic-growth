import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";

const formatDateInputValue = (value?: Date | string | null) => {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const AdminInfluencerCampaignEditor = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEditing = Boolean(campaignId);

  const utils = trpc.useUtils();

  const campaignQuery = trpc.influencerSubmissions.getCampaign.useQuery(
    { campaignId: campaignId ?? "" },
    { enabled: isEditing }
  );

  const createCampaign = trpc.influencerSubmissions.createCampaign.useMutation();
  const updateCampaign = trpc.influencerSubmissions.updateCampaign.useMutation();

  const [title, setTitle] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (campaignQuery.data && isEditing) {
      setTitle(campaignQuery.data.title ?? "");
      setEndDate(formatDateInputValue(campaignQuery.data.end_date));
      setHasPassword(Boolean(campaignQuery.data.hasPassword));
      setPasswordInput("");
      setRemovePassword(false);
    }
  }, [campaignQuery.data, isEditing]);

  const isLoading = useMemo(() => {
    if (isEditing) {
      return campaignQuery.isLoading || campaignQuery.isFetching;
    }
    return false;
  }, [campaignQuery.isFetching, campaignQuery.isLoading, isEditing]);

  const isSubmitting = createCampaign.isLoading || updateCampaign.isLoading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!title.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a campaign title before saving.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (isEditing && campaignId) {
        const payload: Parameters<typeof updateCampaign.mutateAsync>[0] = {
          campaignId,
          title,
          endDate: endDate || null,
        };

        if (removePassword) {
          payload.password = "";
        } else if (passwordInput.trim()) {
          payload.password = passwordInput.trim();
        }

        await updateCampaign.mutateAsync(payload);
        toast({
          title: "Campaign updated",
          description: "The campaign details were saved.",
        });
        if (removePassword) {
          setHasPassword(false);
        } else if (passwordInput.trim()) {
          setHasPassword(true);
        }
      } else {
        await createCampaign.mutateAsync({
          title,
          endDate: endDate || null,
          password: passwordInput.trim() || undefined,
        });
        toast({
          title: "Campaign created",
          description: "A new influencer campaign is ready.",
        });
        setHasPassword(Boolean(passwordInput.trim()));
      }

      await utils.influencerSubmissions.listCampaigns.invalidate();
      if (campaignId) {
        await Promise.all([
          utils.influencerSubmissions.getCampaign.invalidate({ campaignId }),
          utils.influencerSubmissions.getCampaignDetails.invalidate({ campaignId }),
        ]);
      }
      setPasswordInput("");
      setRemovePassword(false);
      navigate("/admin/influencer-campaigns");
    } catch (error) {
      console.error(error);
      toast({
        title: "Unable to save",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  let body: ReactNode = null;

  if (isLoading) {
    body = (
      <div className="flex justify-center py-20">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading campaign…
        </span>
      </div>
    );
  } else if (campaignQuery.isError) {
    body = (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          Unable to load this campaign. Please try again.
        </CardContent>
      </Card>
    );
  } else {
    body = (
      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>
              {isEditing ? "Edit influencer campaign" : "Create influencer campaign"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Campaign title</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Top AI creators Q1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Leaving this blank keeps the campaign open-ended.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaignPassword">Campaign password</Label>
              <div className="relative">
                <Input
                  id="campaignPassword"
                  type={showPassword ? "text" : "password"}
                  value={passwordInput}
                  placeholder={
                    hasPassword
                      ? "Enter a new password to replace the current one"
                      : "Optional: set a password to restrict access"
                  }
                  disabled={removePassword}
                  onChange={(event) => {
                    setPasswordInput(event.target.value);
                    if (removePassword) {
                      setRemovePassword(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? "Hide campaign password"
                      : "Show campaign password"
                  }
                  disabled={removePassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {removePassword
                  ? "The password will be removed once you save."
                  : hasPassword
                    ? "A password is currently set. Enter a new one to change it or remove it below."
                    : "Leave blank to keep the campaign accessible to anyone with the link."}
              </p>
              {hasPassword && (
                <Button
                  type="button"
                  variant={removePassword ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => {
                    setRemovePassword(!removePassword);
                    setPasswordInput("");
                  }}
                >
                  {removePassword ? "Undo password removal" : "Remove password"}
                </Button>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between gap-3">
            <Button type="button" variant="outline" asChild disabled={isSubmitting}>
              <Link to="/admin/influencer-campaigns">Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                isEditing ? "Save changes" : "Create campaign"
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">
              {isEditing ? "Edit campaign" : "Create campaign"}
            </h1>
            <p className="text-muted-foreground">
              {isEditing
                ? "Update an existing influencer campaign."
                : "Set up a new influencer campaign for sourced creators."}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/admin/influencer-campaigns">Back to campaigns</Link>
          </Button>
        </div>
        {body}
      </div>
    </AppLayout>
  );
};

export default AdminInfluencerCampaignEditor;
