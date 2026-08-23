import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";
import { formatPlatformLabel, timeAgo } from "@/lib/utils";
import { Loader2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

const formatDateTime = (value?: Date | string | null) => {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const getUserDisplayName = (record: {
  firstName?: string | null;
  lastName?: string | null;
  discordUsername?: string | null;
  email?: string | null;
  discordId?: string | null;
}) => {
  const fullName = `${record.firstName ?? ""} ${record.lastName ?? ""}`.trim();
  if (fullName) return fullName;
  if (record.discordUsername) return record.discordUsername;
  if (record.email) return record.email;
  return record.discordId ?? "Unknown user";
};

const getInitials = (
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null
) => {
  const value = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  if (value) {
    return value
      .split(" ")
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  if (fallback) {
    return fallback.slice(0, 2).toUpperCase();
  }
  return "??";
};

type HandlePlatform = "youtube" | "instagram" | "tiktok" | "x";

const AdminBannedEntities = () => {
  const [userPage, setUserPage] = useState(1);
  const [handlePage, setHandlePage] = useState(1);
  const [userSearch, setUserSearch] = useState("");
  const [handleSearch, setHandleSearch] = useState("");
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const {
    data: bannedUsers,
    isLoading: isLoadingBannedUsers,
    isFetching: isFetchingBannedUsers,
    error: bannedUsersError,
    refetch: refetchBannedUsers,
  } = trpc.user.listBannedUsers.useQuery();
  const {
    data: bannedHandles,
    isLoading: isLoadingBannedHandles,
    isFetching: isFetchingBannedHandles,
    error: bannedHandlesError,
    refetch: refetchBannedHandles,
  } = trpc.user.listBannedHandles.useQuery();

  const normalizedUserQuery = userSearch.trim().toLowerCase();
  const normalizedHandleQuery = handleSearch.trim().toLowerCase();
  const usersPerPage = 20;
  const handlesPerPage = 20;

  const filteredUsers = useMemo(() => {
    if (!bannedUsers) return [];
    if (!normalizedUserQuery) return bannedUsers;
    const terms = normalizedUserQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return bannedUsers;
    return bannedUsers.filter((ban) => {
      const haystack = [
        ban.userId,
        ban.reason ?? "",
        ban.createdBy ?? "",
        ban.user?.firstName ?? "",
        ban.user?.lastName ?? "",
        ban.user?.discordUsername ?? "",
        ban.user?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [bannedUsers, normalizedUserQuery]);

  const filteredHandles = useMemo(() => {
    if (!bannedHandles) return [];
    if (!normalizedHandleQuery) return bannedHandles;
    const terms = normalizedHandleQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return bannedHandles;
    return bannedHandles.filter((ban) => {
      const haystack = [
        ban.handle,
        ban.platform,
        ban.reason ?? "",
        ban.createdBy ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [bannedHandles, normalizedHandleQuery]);

  const userPages = Math.max(1, Math.ceil(filteredUsers.length / usersPerPage));
  const handlePages = Math.max(1, Math.ceil(filteredHandles.length / handlesPerPage));

  useEffect(() => {
    setUserPage(1);
  }, [normalizedUserQuery, bannedUsers?.length]);

  useEffect(() => {
    setHandlePage(1);
  }, [normalizedHandleQuery, bannedHandles?.length]);

  useEffect(() => {
    setUserPage((prev) => Math.min(prev, userPages));
  }, [userPages]);

  useEffect(() => {
    setHandlePage((prev) => Math.min(prev, handlePages));
  }, [handlePages]);

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * usersPerPage;
    return filteredUsers.slice(start, start + usersPerPage);
  }, [filteredUsers, userPage, usersPerPage]);

  const pagedHandles = useMemo(() => {
    const start = (handlePage - 1) * handlesPerPage;
    return filteredHandles.slice(start, start + handlesPerPage);
  }, [filteredHandles, handlePage, handlesPerPage]);

  const unbanUserMutation = trpc.user.unbanUser.useMutation({
    onSuccess: () => {
      utils.user.listBannedUsers.invalidate();
      toast({ title: "Ban lifted" });
    },
    onError: (error) => {
      toast({
        title: "Failed to lift ban",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const unbanHandleMutation = trpc.user.unbanHandle.useMutation({
    onSuccess: () => {
      utils.user.listBannedHandles.invalidate();
      toast({ title: "Handle unbanned" });
    },
    onError: (error) => {
      toast({
        title: "Failed to lift handle ban",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUnbanUser = (userId: string) => {
    unbanUserMutation.mutate({ userId });
  };

  const handleUnbanHandle = (platform: string, handle: string) => {
    unbanHandleMutation.mutate({
      platform: platform as HandlePlatform,
      handle,
    });
  };

  const renderBannedUsersContent = () => {
    if (isLoadingBannedUsers) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading banned users…
        </div>
      );
    }

    if (bannedUsersError) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load banned users. Please try again.
        </div>
      );
    }

    if (filteredUsers.length === 0) {
      const hasAnyBans = (bannedUsers?.length ?? 0) > 0;
      const hasQuery = Boolean(normalizedUserQuery);
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {hasAnyBans && hasQuery
            ? "No users match your search."
            : "No users are currently banned."}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Banned</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedUsers.map((ban) => (
              <TableRow key={ban.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={ban.user?.imageUrl ?? undefined} alt={getUserDisplayName(ban.user ?? {})} />
                      <AvatarFallback>
                        {getInitials(
                          ban.user?.firstName,
                          ban.user?.lastName,
                          ban.user?.discordUsername ?? ban.user?.email ?? ban.user?.discordId ?? ban.userId
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium leading-none">
                        {getUserDisplayName({
                          firstName: ban.user?.firstName,
                          lastName: ban.user?.lastName,
                          discordUsername: ban.user?.discordUsername,
                          email: ban.user?.email,
                          discordId: ban.user?.discordId ?? ban.userId,
                        })}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {ban.user?.discordUsername ? `@${ban.user.discordUsername}` : ban.user?.email ?? ban.userId}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="font-mono">
                          {ban.userId}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                    {ban.reason ?? "No reason provided"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm font-medium">{formatDateTime(ban.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">{timeAgo(ban.createdAt)}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{ban.createdBy ?? "Unknown"}</div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUnbanUser(ban.userId)}
                    disabled={unbanUserMutation.isPending && unbanUserMutation.variables?.userId === ban.userId}
                  >
                    {unbanUserMutation.isPending &&
                    unbanUserMutation.variables?.userId === ban.userId ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Lifting…
                      </span>
                    ) : (
                      "Lift ban"
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-2 py-3 text-sm text-muted-foreground">
          <span>
            Showing {(pagedUsers.length && (userPage - 1) * usersPerPage + 1) || 0}-
            {(pagedUsers.length && (userPage - 1) * usersPerPage + pagedUsers.length) || 0} of
            {" "}
            {filteredUsers.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
              disabled={userPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              Page {userPage} of {userPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUserPage((prev) => Math.min(userPages, prev + 1))}
              disabled={userPage === userPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderBannedHandlesContent = () => {
    if (isLoadingBannedHandles) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading banned handles…
        </div>
      );
    }

    if (bannedHandlesError) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load banned handles. Please try again.
        </div>
      );
    }

    if (filteredHandles.length === 0) {
      const hasAnyBans = (bannedHandles?.length ?? 0) > 0;
      const hasQuery = Boolean(normalizedHandleQuery);
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {hasAnyBans && hasQuery
            ? "No handles match your search."
            : "No handles are currently banned."}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Handle</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Banned</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedHandles.map((ban) => (
              <TableRow key={ban.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">@{ban.handle}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Badge variant="outline">{formatPlatformLabel(ban.platform)}</Badge>
                      <span className="text-xs text-muted-foreground">Added {timeAgo(ban.createdAt)}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                    {ban.reason ?? "No reason provided"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm font-medium">{formatDateTime(ban.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">{timeAgo(ban.createdAt)}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{ban.createdBy ?? "Unknown"}</div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUnbanHandle(ban.platform, ban.handle)}
                    disabled={
                      unbanHandleMutation.isPending &&
                      unbanHandleMutation.variables?.handle === ban.handle &&
                      unbanHandleMutation.variables?.platform === ban.platform
                    }
                  >
                    {unbanHandleMutation.isPending &&
                    unbanHandleMutation.variables?.handle === ban.handle &&
                    unbanHandleMutation.variables?.platform === ban.platform ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Lifting…
                      </span>
                    ) : (
                      "Lift ban"
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-2 py-3 text-sm text-muted-foreground">
          <span>
            Showing {(pagedHandles.length && (handlePage - 1) * handlesPerPage + 1) || 0}-
            {(pagedHandles.length && (handlePage - 1) * handlesPerPage + pagedHandles.length) || 0} of
            {" "}
            {filteredHandles.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHandlePage((prev) => Math.max(1, prev - 1))}
              disabled={handlePage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              Page {handlePage} of {handlePages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHandlePage((prev) => Math.min(handlePages, prev + 1))}
              disabled={handlePage === handlePages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Banned users & handles</h1>
          <p className="text-muted-foreground">
            Review and manage account-level and handle-level bans across the community.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Banned users</CardTitle>
              <CardDescription>
                {isFetchingBannedUsers
                  ? "Refreshing list…"
                  : `${bannedUsers?.length ?? 0} user${(bannedUsers?.length ?? 0) === 1 ? "" : "s"} banned`}
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Input
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search by name, email, or user ID"
                className="min-w-0 sm:w-64"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchBannedUsers()}
                disabled={isFetchingBannedUsers}
              >
                {isFetchingBannedUsers ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </span>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>{renderBannedUsersContent()}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Banned handles</CardTitle>
              <CardDescription>
                {isFetchingBannedHandles
                  ? "Refreshing list…"
                  : `${bannedHandles?.length ?? 0} handle${(bannedHandles?.length ?? 0) === 1 ? "" : "s"} banned`}
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Input
                value={handleSearch}
                onChange={(event) => setHandleSearch(event.target.value)}
                placeholder="Search by handle, platform, or reason"
                className="min-w-0 sm:w-64"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchBannedHandles()}
                disabled={isFetchingBannedHandles}
              >
                {isFetchingBannedHandles ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </span>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>{renderBannedHandlesContent()}</CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminBannedEntities;
