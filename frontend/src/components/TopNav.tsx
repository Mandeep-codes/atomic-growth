import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useRole } from "@/hooks/useRole";
import { trackEvent } from "@/lib/analytics";
import { formatCurrency } from "@/lib/formatCurrency";
import {
  ADMIN_NAV,
  PRIMARY_NAV,
  SECONDARY_NAV,
  isNavActive,
  type NavItem,
} from "@/lib/navItems";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LogOut, Menu, Shield } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const initialsOf = (name: string, email: string) => {
  const source = name.trim() || email.trim();
  if (!source) return "AC";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
};

/**
 * The app's only navigation surface.
 *
 * The sidebar is gone (see AppLayout). Everything it held moved here, but not
 * all at the same weight: the four routes a clipper uses week to week sit
 * inline on desktop, the setup screens sit behind "Menu", and the twenty-entry
 * admin tree sits behind its own "Admin" button that only staff ever see.
 *
 * That split is the fix. The old drawer showed all twenty-seven at once with
 * identical weight, which is what people were getting lost in.
 */
export function TopNav() {
  const { user, signOut } = useAuth();
  const { roles } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { enabled: demographicsVerificationEnabled } = useFeatureFlag(
    "DEMOGRAPHICS_VERIFICATION"
  );

  // Navigate AFTER the sign out resolves, so "/" is rendered with the session
  // already gone and shows the landing page rather than flashing the dashboard
  // on the way out. replace: true so Back does not walk into the signed-in app.
  const handleSignOut = async () => {
    trackEvent({ event: "topnav_sign_out_clicked" });
    await signOut();
    navigate("/", { replace: true });
  };

  const { data: claimable } = trpc.demographicsVerification.getClaimable.useQuery(
    undefined,
    { enabled: Boolean(user) }
  );

  const isSignedIn = Boolean(user);
  const isStaff = isSignedIn && roles.length > 0;
  const displayName = user?.user_metadata.display_name ?? "";
  const email = user?.email ?? "";

  const flagOn = (flag?: string) =>
    flag === "DEMOGRAPHICS_VERIFICATION" ? demographicsVerificationEnabled : true;

  const visible = (items: NavItem[]) =>
    items.filter(
      (item) => (!item.requiresAuth || isSignedIn) && flagOn(item.flag)
    );

  const primary = visible(PRIMARY_NAV);
  const secondary = visible(SECONDARY_NAV);
  // Owner-locked panels stay out of the menu; the sidebar gated them on a
  // backend owner check that fires 401 on public pages, so rather than move
  // that fragile check here they are reachable by direct URL only.
  const admin = ADMIN_NAV.filter((item) => !item.ownerOnly);

  const renderMenuItem = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <DropdownMenuItem key={item.path} asChild>
        <Link
          to={item.path}
          className={cn(
            "flex cursor-pointer items-center gap-2.5 text-sm",
            isNavActive(location.pathname, item) && "font-semibold"
          )}
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{item.title}</span>
        </Link>
      </DropdownMenuItem>
    );
  };

  return (
    <header className="sticky top-0 z-30 h-20 w-full border-b border-border/60 bg-background/60 backdrop-blur-md">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 lg:gap-6">
          <Link
            to="/"
            className="group flex min-w-0 items-center gap-2.5 focus:outline-none"
          >
            <img
              src="/atomik.png"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 shrink-0 object-contain transition-transform duration-200 group-hover:scale-110 dark:invert-0 invert"
            />
            {/* Wordmark stays in normal case, matching the brand lockup —
                the uppercase-italic treatment is for section headings only.
                Hidden below sm now that nav links share the row. */}
            <span className="hidden truncate text-2xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-foreground/80 sm:inline sm:text-[1.75rem]">
              Atomik Clips
            </span>
          </Link>

          {/* Inline links, desktop only. Four is the ceiling on purpose. */}
          {isSignedIn ? (
            <nav
              aria-label="Main"
              className="hidden items-center gap-1 lg:flex"
            >
              {primary.map((item) => {
                const active = isNavActive(location.pathname, item);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-muted font-semibold text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {item.title}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>

        {isSignedIn ? (
          <div className="flex items-center gap-2 sm:gap-3">
            <div data-tour="wallet" className="hidden flex-col items-end pr-1 sm:flex">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Wallet balance
              </span>
              <span className="font-mono text-base font-bold leading-none text-foreground">
                {claimable ? formatCurrency(claimable.balance) : "—"}
              </span>
            </div>

            {/* Admin tree. Staff only, and clearly labelled as a separate
                place rather than mixed into the clipper's own routes. */}
            {isStaff ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-full border border-border/60 px-3 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:h-11 sm:px-4"
                  >
                    <Shield className="h-4 w-4" />
                    <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] sm:inline">
                      Admin
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[70vh] w-64 overflow-y-auto"
                >
                  <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Staff tools
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {admin.map(renderMenuItem)}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {/* Everything else: the primary four collapse in here below lg,
                the setup screens live here at every width. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Menu"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:h-11 sm:w-11"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <div className="lg:hidden">
                  {primary.map(renderMenuItem)}
                  <DropdownMenuSeparator />
                </div>
                {secondary.map(renderMenuItem)}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="cursor-pointer text-sm">
                    Profile
                  </Link>
                </DropdownMenuItem>
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-sm">Theme</span>
                  <ThemeToggle />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <Link
              to="/profile"
              title={displayName || email}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted font-mono text-xs font-bold text-foreground transition-colors hover:border-foreground/40 sm:h-11 sm:w-11"
            >
              {initialsOf(displayName, email)}
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              title="Log out"
              aria-label="Log out"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:h-11 sm:w-11"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default TopNav;
