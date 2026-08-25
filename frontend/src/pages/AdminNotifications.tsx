import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Megaphone, ShieldAlert, Sparkles, Loader2 } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";

const announcementTypeOptions = [
  {
    value: "announcement" as const,
    label: "Announcement",
    description: "General updates, launches, or celebrations.",
    icon: Megaphone,
  },
  {
    value: "issue-alert" as const,
    label: "Issue alert",
    description: "Service disruptions or anything users should avoid.",
    icon: ShieldAlert,
  },
];

type AnnouncementType = (typeof announcementTypeOptions)[number]["value"];

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const typeToBadge: Record<AnnouncementType, { label: string; variant: BadgeVariant }> = {
  announcement: { label: "Announcement", variant: "secondary" },
  "issue-alert": { label: "Issue alert", variant: "destructive" },
};

// "" means platform-wide - the historic behaviour and still the default.
// Select uses "" as a sentinel rather than undefined so the control stays
// controlled and the placeholder renders.
const ALL_CAMPAIGNS = "";

const defaultFormState = {
  title: "",
  description: "",
  type: announcementTypeOptions[0]!.value,
  expiresMinutes: "",
  campaignId: ALL_CAMPAIGNS,
};

const AdminNotifications = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [formState, setFormState] = useState(defaultFormState);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const {
    data: announcements = [],
    isLoading,
    isFetching,
    error,
  } = trpc.notifications.listAnnouncements.useQuery();

  // Scoped posts only reach clippers who joined that campaign, so the picker
  // lists live campaigns first - a post scoped to an ended campaign would be
  // written and then seen by nobody.
  const { data: campaigns } = trpc.campaigns.getAll.useQuery();
  const campaignOptions = useMemo(() => {
    const rows = campaigns ?? [];
    return [
      ...rows.filter((c) => c.active && !c.ended),
      ...rows.filter((c) => c.ended),
    ];
  }, [campaigns]);

  const createAnnouncement = trpc.notifications.createAnnouncement.useMutation({
    onSuccess: async () => {
      toast({
        title: "Announcement published",
        description: "Users will start seeing it right away.",
      });
      setFormState((prev) => ({
        ...defaultFormState,
        type: prev.type,
      }));
      await utils.notifications.listAnnouncements.invalidate();
    },
    onError: (mutationError) => {
      toast({
        title: "Unable to publish announcement",
        description: mutationError.message,
        variant: "destructive",
      });
    },
  });

  const dismissAnnouncement = trpc.notifications.dismissAnnouncement.useMutation({
    onSuccess: async () => {
      toast({ title: "Announcement archived" });
      await utils.notifications.listAnnouncements.invalidate();
    },
    onError: (mutationError) => {
      toast({
        title: "Unable to dismiss announcement",
        description: mutationError.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { title, description, type, expiresMinutes, campaignId } = formState;

    if (!title.trim() || !description.trim()) {
      toast({
        title: "Missing information",
        description: "Give the announcement a title and description.",
        variant: "destructive",
      });
      return;
    }

    const parsedExpiration = expiresMinutes.trim()
      ? Number(expiresMinutes)
      : undefined;

    if (parsedExpiration !== undefined) {
      if (!Number.isFinite(parsedExpiration) || parsedExpiration <= 0) {
        toast({
          title: "Invalid expiration",
          description: "Expiration must be a positive number of minutes.",
          variant: "destructive",
        });
        return;
      }
    }

    await createAnnouncement.mutateAsync({
      title: title.trim(),
      description: description.trim(),
      type,
      expiresMinutes: parsedExpiration,
      // Omitted entirely when platform-wide, so the metadata written matches
      // what every pre-existing announcement row looks like.
      campaignId: campaignId || undefined,
    });
  };

  const isSubmitting = createAnnouncement.isPending;

  const announcementRows = useMemo(() => {
    return announcements.map((announcement) => {
      const type = announcement.metadata?.type as AnnouncementType | undefined;
      const createdAt = new Date(announcement.createdAt);
      const expiresMinutes = announcement.expiresMinutes ?? undefined;
      const expiresAt =
        expiresMinutes && !Number.isNaN(expiresMinutes)
          ? new Date(createdAt.getTime() + expiresMinutes * 60000)
          : null;

      let statusLabel = "Active";
      let statusVariant: BadgeVariant = "secondary";

      if (announcement.dismissedAt) {
        statusLabel = "Archived";
        statusVariant = "outline";
      } else if (expiresAt) {
        if (expiresAt < new Date()) {
          statusLabel = "Expired";
          statusVariant = "outline";
        } else {
          statusLabel = `Expires ${formatDistanceToNow(expiresAt, {
            addSuffix: true,
          })}`;
          statusVariant = "secondary";
        }
      } else {
        statusVariant = "secondary";
      }

      return {
        id: announcement.id,
        title: announcement.title,
        description: announcement.description,
        type,
        createdLabel: formatDistanceToNow(createdAt, { addSuffix: true }),
        statusLabel,
        statusVariant,
        isDismissed: Boolean(announcement.dismissedAt),
      };
    });
  }, [announcements]);

  const handleDismissAnnouncement = async (announcementId: string) => {
    setDismissingId(announcementId);
    try {
      await dismissAnnouncement.mutateAsync({ announcementId });
    } finally {
      setDismissingId((current) => (current === announcementId ? null : current));
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            <p className="text-sm font-medium text-muted-foreground">
              Notifications
            </p>
          </div>
          <h1 className="text-3xl font-semibold">Global announcements</h1>
          <p className="text-muted-foreground">
            Publish alerts and updates that every user will see in their
            notifications carousel.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Create announcement</CardTitle>
              <CardDescription>
                Pick a tone, add a short description, and optionally set an
                expiration in minutes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={formState.type}
                    onValueChange={(next) =>
                      setFormState((prev) => ({ ...prev, type: next as AnnouncementType }))
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {announcementTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex flex-col text-left">
                            <span className="font-medium">{option.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select
                    value={formState.campaignId}
                    onValueChange={(next) =>
                      setFormState((prev) => ({
                        ...prev,
                        campaignId: next === ALL_CAMPAIGNS ? ALL_CAMPAIGNS : next,
                      }))
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Everyone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CAMPAIGNS}>
                        <div className="flex flex-col text-left">
                          <span className="font-medium">Everyone</span>
                          <span className="text-xs text-muted-foreground">
                            Shown to every clipper, like the Discord posts
                          </span>
                        </div>
                      </SelectItem>
                      {campaignOptions.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id}>
                          <div className="flex flex-col text-left">
                            <span className="font-medium">
                              {campaign.title || "Untitled campaign"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {campaign.ended
                                ? "Ended - only past participants will see this"
                                : "Only clippers who joined this campaign"}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="announcement-title">Title</Label>
                  <Input
                    id="announcement-title"
                    placeholder="Payments update"
                    value={formState.title}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="announcement-description">Description</Label>
                  <Textarea
                    id="announcement-description"
                    placeholder="Share a short summary that explains what changed"
                    value={formState.description}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    disabled={isSubmitting}
                    rows={4}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="announcement-expiration">
                    Expires (minutes)
                  </Label>
                  <Input
                    id="announcement-expiration"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="Optional"
                    value={formState.expiresMinutes}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        expiresMinutes: event.target.value,
                      }))
                    }
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to keep the announcement live until you archive
                    it.
                  </p>
                </div>

                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Publish announcement
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
              <CardDescription>
                Users see these messages mixed with their personal notifications.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">
                  Announcement tones
                </h4>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <span className="font-medium text-foreground">Issue alerts</span>{" "}
                    are highlighted in orange to set expectations during
                    outages.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Announcements</span>{" "}
                    use a neutral accent for launches or reminders.
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">
                  Expiration
                </h4>
                <p>
                  When the timer ends the card disappears for everyone. If no
                  timer is set, it stays visible until you archive or delete it
                  in the database.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">
                  Dismissal
                </h4>
                <p>
                  Creators can dismiss announcements individually—once dismissed,
                  they won&apos;t see the same card again.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Recent announcements</CardTitle>
              <CardDescription>
                Showing the last {announcements.length} entries from newest to
                oldest.
              </CardDescription>
            </div>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Couldn&apos;t load announcements</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : announcements.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                No announcements yet. Create the first one above.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcementRows.map((row) => (
                  <TableRow key={row.id}>
                      <TableCell>
                        {row.type ? (
                          <Badge variant={typeToBadge[row.type].variant}>
                            {typeToBadge[row.type].label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Unknown
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{row.title}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {row.description}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.statusVariant}>{row.statusLabel}</Badge>
                      </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.createdLabel}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.isDismissed ? (
                        <span className="text-xs text-muted-foreground">Archived</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={dismissingId === row.id || dismissAnnouncement.isPending}
                          onClick={() => handleDismissAnnouncement(row.id)}
                        >
                          {dismissingId === row.id ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Dismiss
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminNotifications;
