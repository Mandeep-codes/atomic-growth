import {
  Activity, BadgeCheck, Ban, Banknote, BarChart3, ClipboardCheck, Coins,
  FileText, Gamepad2, Gift, Globe, Home, ListOrdered, Lock, Megaphone,
  Rows2, Send, Shield, ShieldAlert, Trash2, UserCog, UserPlus, Users,
  Wallet, Wrench, type LucideIcon,
} from "lucide-react";

// Nav model lifted verbatim out of AppSidebar. Paths, titles and icons are
// unchanged, so every existing deep link still resolves.

export type NavItem = {
  title: string;
  icon: LucideIcon;
  path: string;
  requiresAuth?: boolean;
  exact?: boolean;
  flag?: string;
  ownerOnly?: boolean;
};

// Shown inline in the top bar on desktop. Demographics sits here rather than
// in the menu because it gates the US audience bonus — a clipper whose report
// lapses silently drops from $0.25 to $0.10 per 1,000, so it needs to be
// somewhere they'll notice, not two clicks deep.
//
// Five is the practical ceiling at this label length. A sixth, or a longer
// title, will start crowding the wallet balance before the lg breakpoint
// collapses the row into the menu.
export const PRIMARY_NAV: NavItem[] = [
  { title: "Home", icon: Home, path: "/", exact: true },
  { title: "My Campaigns", icon: FileText, path: "/submissions", requiresAuth: true },
  { title: "Earnings", icon: Coins, path: "/earnings", requiresAuth: true },
  { title: "Receive Payments", icon: Banknote, path: "/bank-accounts", requiresAuth: true },
  { title: "Social Verification", icon: BadgeCheck, path: "/verification", requiresAuth: true },
  { title: "Demographic Verification", icon: Users, path: "/demographics-verification", requiresAuth: true, flag: "DEMOGRAPHICS_VERIFICATION" },
];

export const SECONDARY_NAV: NavItem[] = [
  { title: "Referrals", icon: UserPlus, path: "/referrals", requiresAuth: true },
];

export const ADMIN_NAV: NavItem[] = [
  { title: "Clipping Campaigns", icon: Shield, path: "/campaigns" },
  { title: "Review Clip Submissions", icon: ClipboardCheck, path: "/admin/submissions" },
  { title: "Review Clip v2", icon: Gamepad2, path: "/admin/review-clip-v2" },
  { title: "Private Campaigns", icon: Lock, path: "/admin/private-campaigns" },
  { title: "Review Clipper Demographics", icon: BarChart3, path: "/admin/demographics" },
  { title: "US Demographics", icon: Globe, path: "/admin/us-demographics", ownerOnly: true },
  { title: "Clipper Activity", icon: Activity, path: "/admin/clipper-activity" },
  { title: "Deleted Clip Reserves", icon: Trash2, path: "/admin/deleted-clip-reserves" },
  { title: "Leaderboard Tools", icon: Wrench, path: "/admin/leaderboard-tools" },
  { title: "Influencer Campaigns", icon: Rows2, path: "/admin/influencer-campaigns" },
  { title: "Influencer Submissions", icon: ListOrdered, path: "/admin/influencer-submissions" },
  { title: "Announcements", icon: Megaphone, path: "/admin/notifications" },
  { title: "Ad Hoc Rewards", icon: Gift, path: "/admin/manual-rewards" },
  { title: "User Activity", icon: Activity, path: "/admin/user-activity" },
  { title: "Banned Users", icon: Ban, path: "/admin/banned-entities" },
  { title: "User Roles", icon: UserCog, path: "/admin/user-roles" },
  { title: "Wise Payouts", icon: Send, path: "/admin/payouts" },
  { title: "Crypto Payouts", icon: Wallet, path: "/admin/crypto-payouts" },
  { title: "SOS — Emergency", icon: ShieldAlert, path: "/admin/sos" },
  { title: "Stable ID backfill", icon: ShieldAlert, path: "/admin/stable-id" },
];

export const isNavActive = (pathname: string, item: NavItem) =>
  item.exact || item.path === "/"
    ? pathname === item.path
    : pathname.startsWith(item.path);
