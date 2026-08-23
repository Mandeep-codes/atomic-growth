import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  Megaphone,
} from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import {
  notificationMetadataSchema,
  type Notification,
  type NotificationMetadata,
} from "./NotificationSchema";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/formatCurrency";

type ToneConfig = {
  icon: typeof Info;
  badgeClassName: string;
  accentClassName: string;
  buttonVariant: ButtonProps["variant"];
};

const toneByAlertType: Record<NotificationMetadata["alertType"], ToneConfig> = {
  success: {
    icon: CheckCircle2,
    badgeClassName: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
    accentClassName: "text-emerald-600",
    buttonVariant: "default",
  },
  warning: {
    icon: AlertTriangle,
    badgeClassName: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
    accentClassName: "text-amber-600",
    buttonVariant: "secondary",
  },
  info: {
    icon: Megaphone,
    badgeClassName: "text-sky-600 bg-sky-100 dark:bg-sky-900/30",
    accentClassName: "text-sky-600",
    buttonVariant: "outline",
  },
};

type NotificationCta = {
  label: string;
  href: string;
  external?: boolean;
  variant?: ButtonProps["variant"];
};

const buildCta = (notification: Notification): NotificationCta | null => {
  switch (notification.metadata.type) {
    case "submission-approved":
      return {
        label: "View clip",
        href: notification.metadata.submissionUrl,
        external: true,
      };
    case "submission-rejected":
      return {
        label: "View clip",
        href: notification.metadata.submissionUrl,
        variant: "outline",
        external: true,
      };
    case "demographics-verification-reminder":
      return {
        label: "Verify now",
        href: "/demographics/verify",
      };
    case "earnings-update":
      return {
        label: "View earnings",
        href: "/earnings",
      };
    case "payout-initiated": {
      return {
        label: "View Earnings",
        href: "/earnings",
      };
    }
    case "withdrawal-refunded": {
      return {
        label: "View Earnings",
        href: "/earnings",
      };
    }
    default:
      return null;
  }
};

// A malformed notification must cost us the banner, not the whole page —
// without this boundary one bad metadata row unmounts the entire app.
class SpotlightErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("NotificationsSpotlight crashed — hiding the banner", error);
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

export const NotificationsSpotlight = (props: {
  notifications: Notification[];
}) => (
  <SpotlightErrorBoundary>
    <NotificationsSpotlightInner {...props} />
  </SpotlightErrorBoundary>
);

const NotificationsSpotlightInner = ({
  notifications,
}: {
  notifications: Notification[];
}) => {
  const dismissNotification = trpc.notifications.dismiss.useMutation();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    return new Set(
      notifications
        .filter((notification) => notification.dismissedAt)
        .map((notification) => notification.id)
    );
  });

  const visibleNotifications = useMemo(() => {
    return notifications.filter(
      (notification) => !dismissedIds.has(notification.id)
    );
  }, [notifications, dismissedIds]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const parsed = notificationMetadataSchema
      .array()
      .safeParse(notifications.map((notification) => notification.metadata));
    if (!parsed.success) {
      console.warn("Failed to parse notification metadata", parsed.error);
    }
  }, [notifications]);

  useEffect(() => {
    setDismissedIds((prev) => {
      const serverDismissedIds = new Set(
        notifications
          .filter((notification) => notification.dismissedAt)
          .map((notification) => notification.id)
      );
      const next = new Set<string>();
      notifications.forEach((notification) => {
        if (
          serverDismissedIds.has(notification.id) ||
          prev.has(notification.id)
        ) {
          next.add(notification.id);
        }
      });
      return next;
    });
  }, [notifications]);

  useEffect(() => {
    if (visibleNotifications.length === 0) {
      setActiveIndex(0);
      return;
    }

    if (activeIndex > visibleNotifications.length - 1) {
      setActiveIndex(Math.max(visibleNotifications.length - 1, 0));
    }
  }, [visibleNotifications, activeIndex]);

  if (visibleNotifications.length === 0) {
    return null;
  }

  const activeNotification = visibleNotifications[activeIndex]!;
  // metadata comes straight from the DB json column, not through the zod
  // schema — an unknown/missing alertType must degrade to a tone, not throw.
  const tone =
    toneByAlertType[activeNotification.metadata.alertType] ??
    toneByAlertType.info;
  const Icon = tone.icon;
  const cta = buildCta(activeNotification);

  const handleDismiss = (notificationId: string) => {
    const totalBeforeDismiss = visibleNotifications.length;
    const previousActiveIndex = activeIndex;
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(notificationId);
      return next;
    });

    setActiveIndex((current) => {
      if (totalBeforeDismiss <= 1) {
        return 0;
      }

      if (current === totalBeforeDismiss - 1) {
        return Math.max(current - 1, 0);
      }

      return current;
    });

    trackEvent({
      event: "notification_dismissed",
      properties: {
        notificationId,
      },
    });

    dismissNotification.mutate(
      { notificationId },
      {
        onError: (error) => {
          console.error("Failed to dismiss notification", error);
          setDismissedIds((prev) => {
            const next = new Set(prev);
            next.delete(notificationId);
            return next;
          });
          setActiveIndex(previousActiveIndex);
        },
      }
    );
  };

  const navigateTo = (direction: "next" | "prev") => {
    setActiveIndex((current) => {
      const total = visibleNotifications.length;
      if (total === 0) {
        return 0;
      }

      if (direction === "next") {
        return current === total - 1 ? 0 : current + 1;
      }

      return current === 0 ? total - 1 : current - 1;
    });
  };

  const renderCta = () => {
    if (!cta) {
      return null;
    }

    const isExternal = cta.external ?? /^https?:\/\//i.test(cta.href);
    const onClick = () => {
      trackEvent({
        event: "notification_cta_clicked",
        properties: {
          notificationId: activeNotification.id,
          destination: cta.href,
          external: isExternal,
        },
      });
    };

    if (isExternal) {
      return (
        <Button
          asChild
          size="sm"
          className="mt-4"
          variant={cta.variant ?? tone.buttonVariant}
        >
          <a href={cta.href} target="_blank" rel="noreferrer" onClick={onClick}>
            {cta.label}
          </a>
        </Button>
      );
    }

    return (
      <Button
        asChild
        size="sm"
        className="mt-4"
        variant={cta.variant ?? tone.buttonVariant}
      >
        <Link to={cta.href} onClick={onClick}>
          {cta.label}
        </Link>
      </Button>
    );
  };

  return (
    <Card className="rounded-3xl border border-border/60 bg-card/60 p-3 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-2xl",
                tone.accentClassName
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Badge className={cn("uppercase p-2", tone.badgeClassName)}>
                  {activeNotification.title}
                </Badge>
              </div>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {activeNotification.metadata.type !== "earnings-update"
                  ? activeNotification.description
                  : `You just earned ${formatCurrency(
                      activeNotification.metadata.amount
                    )} 🎉`}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeNotification.metadata.type === "submission-rejected" &&
                  activeNotification.metadata.rejectionReason &&
                  activeNotification.metadata.rejectionReason !== "" &&
                  activeNotification.metadata.rejectionReason !== "." && (
                    <p>
                      <span className="font-medium">Reason:</span>{" "}
                      {activeNotification.metadata.rejectionReason}
                    </p>
                  )}
                {activeNotification.metadata.type === "submission-rejected" &&
                  activeNotification.metadata.reviewer && (
                    <p>
                      <span className="font-medium">Reviewer:</span>{" "}
                      {activeNotification.metadata.reviewer}
                    </p>
                  )}
              </p>
              {renderCta()}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => navigateTo("prev")}
              aria-label="Previous notification"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => navigateTo("next")}
              aria-label="Next notification"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => handleDismiss(activeNotification.id)}
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex w-full justify-end">
        <span className="text-xs text-muted-foreground">
          {activeIndex + 1} of {visibleNotifications.length}
        </span>
      </div>
    </Card>
  );
};
