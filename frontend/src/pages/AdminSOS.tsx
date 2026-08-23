import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

const AdminSOS = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: status, isLoading } =
    trpc.siteSettings.getMaintenanceStatus.useQuery(undefined, {
      refetchInterval: 10_000,
    });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const setMode = trpc.siteSettings.setMaintenanceMode.useMutation({
    onSuccess: async () => {
      await utils.siteSettings.getMaintenanceStatus.invalidate();
      setConfirmOpen(false);
    },
    onError: (e) =>
      toast({
        title: "Failed",
        description: e.message || "Could not update maintenance mode.",
        variant: "destructive",
      }),
  });

  const enabled = status?.enabled ?? false;

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
            <ShieldAlert className="h-7 w-7 text-red-600" />
            SOS — Emergency access control
          </h1>
          <p className="mt-2 text-muted-foreground">
            Instantly take the site offline for everyone except SOS holders.
            Use only in an emergency.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading status…
          </div>
        ) : (
          <Card
            className={
              enabled
                ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
                : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
            }
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {enabled ? (
                  <>
                    <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
                    Maintenance mode is ON
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    Site is live
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {enabled
                  ? "Everyone without the SOS role is currently locked out and seeing the maintenance screen."
                  : "Everyone can access the site normally."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {enabled && status?.enabledAt ? (
                <p className="text-sm text-muted-foreground">
                  Turned on {new Date(status.enabledAt).toLocaleString()}
                  {status.enabledBy ? ` by ${status.enabledBy}` : ""}.
                  {status.message ? ` Message: “${status.message}”` : ""}
                </p>
              ) : null}

              {!enabled ? (
                <div className="space-y-2">
                  <Label htmlFor="sos-message">
                    Optional message shown to blocked users
                  </Label>
                  <Textarea
                    id="sos-message"
                    placeholder="The website is under maintenance and will be back up in a few moments."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                {enabled ? (
                  <Button
                    size="lg"
                    variant="default"
                    disabled={setMode.isPending}
                    onClick={() => setMode.mutate({ enabled: false })}
                  >
                    {setMode.isPending ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-5 w-5" />
                    )}
                    Restore access for everyone
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="destructive"
                    className="text-base font-semibold"
                    onClick={() => setConfirmOpen(true)}
                  >
                    <ShieldAlert className="mr-2 h-5 w-5" />
                    Stop access — block everyone else
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setPreviewOpen(true)}
                >
                  Preview blocked-user screen
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirm turning maintenance ON */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Stop access for everyone?
            </DialogTitle>
            <DialogDescription>
              This immediately blocks every user who does not have the SOS role.
              They&apos;ll see a maintenance screen until you restore access.
              You and other SOS holders keep full access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={setMode.isPending}
              onClick={() =>
                setMode.mutate({
                  enabled: true,
                  message: message.trim() || undefined,
                })
              }
            >
              {setMode.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stopping…
                </span>
              ) : (
                "Yes, stop access now"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview of what blocked users see */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          <div className="relative h-[420px]">
            <MaintenanceScreen
              inline
              message={message.trim() || status?.message}
            />
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default AdminSOS;
