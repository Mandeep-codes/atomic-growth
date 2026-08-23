import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import confetti from "canvas-confetti";
import { Banknote, Repeat, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

const Step3Finish = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const atomikLogoRef = useRef<HTMLImageElement>(null);

  const confettiFn = () => {
    if (!atomikLogoRef.current) return;

    const rect = atomikLogoRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    confetti({
      spread: 360,
      ticks: 60,
      gravity: 0,
      decay: 0.95,
      origin: { x: x / window.innerWidth, y: y / window.innerHeight },
      startVelocity: 15,
      colors: ["#FFE400", "#FFBD00", "#E89400", "#FFCA6C", "#FDFFB8"],
      particleCount: 50,
      scalar: 1.2,
      shapes: ["star"],
    });
  };

  // CONFETTI!
  useEffect(() => {
    confettiFn();
    setTimeout(() => {
      confettiFn();
    }, 400);
  }, []);

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-semibold">
          Submission received!
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* Was a hardcoded CDN URL, so this one logo ignored every update to
              public/atomik.png and kept serving the old mark from a
              DigitalOcean bucket nobody redeploys. Now it reads the same local
              asset as the nav, the landing page and the favicon, so swapping
              that one file updates every logo in the app. */}
          <img
            ref={atomikLogoRef}
            src="/atomik.png"
            alt="Submission completed"
            className="size-10 rounded-full object-cover cursor-pointer"
            onClick={confettiFn}
          />
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">
              What’s next?
            </p>
            <p className="text-sm text-muted-foreground">
              Keep the momentum going. Here are a few quick next steps.
            </p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex h-full flex-col rounded-lg border border-border/70 bg-card/60 p-4 text-left shadow-sm">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-primary/10 p-2 text-primary">
                <Repeat className="h-4 w-4" />
              </span>
              <p className="font-semibold text-foreground">
                Submit another clip
              </p>
            </div>
            <p className="mt-2 mb-6 text-sm text-muted-foreground">
              Have more content ready? Add it now to climb the leaderboard.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-auto w-full"
              onClick={() => {
                if (campaignId) {
                  navigate(`/campaign/${campaignId}/submit`);
                } else {
                  navigate("/");
                }
              }}
            >
              Submit another
            </Button>
          </div>

          <div className="flex h-full flex-col rounded-lg border border-border/70 bg-card/60 p-4 text-left shadow-sm">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-primary/10 p-2 text-primary">
                <Banknote className="h-4 w-4" />
              </span>
              <p className="font-semibold text-foreground">View my campaigns</p>
            </div>
            <p className="mt-2 mb-6 text-sm text-muted-foreground">
              View your campaign history and see how your posts are performing.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-auto w-full"
              onClick={() => navigate("/submissions")}
            >
              My Campaigns
            </Button>
          </div>

          <div className="flex h-full flex-col rounded-lg border border-border/70 bg-card/60 p-4 text-left shadow-sm">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-primary/10 p-2 text-primary">
                <Users className="h-4 w-4" />
              </span>
              <p className="font-semibold text-foreground">
                Join us on Discord
              </p>
            </div>
            <p className="mt-2 mb-6 text-sm text-muted-foreground">
              Chat with the Atomik community, get tips, and be the first to know
              about new campaigns.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-auto w-full"
              onClick={() =>
                window.open(
                  "https://discord.com/channels/1395157211839201400/1395362775534014525",
                  "_blank"
                )
              }
            >
              Open Discord
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default Step3Finish;
