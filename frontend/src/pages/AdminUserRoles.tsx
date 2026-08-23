import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { RewardEligibleUserSelect } from "@/components/RewardEligibleUserSelect";
import { type RewardEligibleUser } from "@/lib/rewardUsers";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const getUserDisplayName = (user: {
  firstName?: string | null;
  lastName?: string | null;
  userHandle?: string | null;
  email?: string | null;
  userId: string;
}) => {
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (fullName) return fullName;
  return user.userHandle || user.email || user.userId;
};

const getInitials = (value: string) => {
  if (!value) return "UC";
  const letters = value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase());
  if (letters.length === 0) return value.slice(0, 2).toUpperCase();
  return letters.slice(0, 2).join("") || value.slice(0, 2).toUpperCase();
};

const MIN_USER_SEARCH_CHARS = 2;

const AdminUserRoles = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<RewardEligibleUser | null>(
    null
  );
  const [userSearchInput, setUserSearchInput] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [removingRoleId, setRemovingRoleId] = useState<string | null>(null);

  const { data: availableRoles, isLoading: isLoadingRoles } =
    trpc.roles.getRoles.useQuery();
  const debouncedUserSearch = useDebouncedValue(userSearchInput, 400);
  const trimmedUserSearch = debouncedUserSearch.trim();
  const shouldFetchUsers = trimmedUserSearch.length >= MIN_USER_SEARCH_CHARS;
  const {
    data: searchedUsers = [],
    isFetching: isSearchingUsers,
    error: usersError,
  } = trpc.user.listUsers.useQuery(
    { query: trimmedUserSearch, limit: 20 },
    { enabled: shouldFetchUsers }
  );
  const assignableUsers = shouldFetchUsers ? searchedUsers : [];
  const usersErrorMessage =
    usersError && shouldFetchUsers ? "Failed to search users" : undefined;
  const {
    data: assignments,
    isLoading: isLoadingAssignments,
    isFetching: isFetchingAssignments,
  } = trpc.roles.getUserRoles.useQuery();

  const assignRoleMutation = trpc.roles.assignRole.useMutation({
    onSuccess: () => {
      utils.roles.getUserRoles.invalidate();
      toast({ title: "Role assigned" });
      setSelectedRoleId("");
      setSelectedUserId("");
      setSelectedUser(null);
      setUserSearchInput("");
    },
    onError: (error) => {
      toast({
        title: "Unable to assign role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeRoleMutation = trpc.roles.removeUserRole.useMutation({
    onSuccess: () => {
      utils.roles.getUserRoles.invalidate();
      toast({ title: "Role removed" });
    },
    onError: (error) => {
      toast({
        title: "Unable to remove role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sortedAssignments = useMemo(() => {
    return [...(assignments ?? [])].sort(
      (a, b) =>
        new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime()
    );
  }, [assignments]);

  const groupedAssignments = useMemo(() => {
    const map = new Map<
      string,
      {
        userId: string;
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        imageUrl?: string | null;
        userHandle?: string | null;
        userPlatform?: string | null;
        roles: { id: string; roleName: string; assignedAt: Date | string }[];
      }
    >();

    sortedAssignments.forEach((assignment) => {
      const existing = map.get(assignment.userId);
      if (!existing) {
        map.set(assignment.userId, {
          userId: assignment.userId,
          email: assignment.email,
          firstName: assignment.firstName,
          lastName: assignment.lastName,
          imageUrl: assignment.imageUrl,
          roles: [],
        });
      }
      map.get(assignment.userId)!.roles.push({
        id: assignment.id,
        roleName: assignment.roleName,
        assignedAt: assignment.assignedAt,
      });
    });

    return Array.from(map.values()).sort((a, b) =>
      getUserDisplayName(a).localeCompare(getUserDisplayName(b))
    );
  }, [sortedAssignments]);

  const handleAssignRole = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUserId || !selectedRoleId) return;

    assignRoleMutation.mutate({
      userId: selectedUserId,
      roleId: selectedRoleId,
    });
  };

  const isSubmitting = assignRoleMutation.isPending;

  const handleRemoveRole = (assignmentId: string) => {
    setRemovingRoleId(assignmentId);
    removeRoleMutation.mutate(
      { userRoleId: assignmentId },
      {
        onSettled: () => setRemovingRoleId(null),
      }
    );
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">User Roles</h1>
          <p className="text-muted-foreground">
            Assign roles to users to control access to admin features.
          </p>
          <p className="text-sm text-muted-foreground">
            Changes sync to Clerk on a short cache. It can take a few minutes
            for new assignments to appear there.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Assign a Role</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-[2fr,2fr,auto]"
              onSubmit={handleAssignRole}
            >
              <div className="space-y-2">
                <Label>User</Label>
                <div>
                  <RewardEligibleUserSelect
                    users={assignableUsers}
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                    onUserSelected={(user) => {
                      setSelectedUser(user);
                      setUserSearchInput("");
                    }}
                    selectedUser={selectedUser}
                    searchQuery={userSearchInput}
                    onSearchQueryChange={setUserSearchInput}
                    isSearching={isSearchingUsers}
                    minSearchChars={MIN_USER_SEARCH_CHARS}
                    errorMessage={usersErrorMessage}
                    disabled={
                      isSubmitting
                    }
                    buttonClassName="w-full"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-select">Role</Label>
                <Select
                  value={selectedRoleId}
                  onValueChange={(value) => setSelectedRoleId(value)}
                  disabled={
                    isLoadingRoles || (availableRoles?.length ?? 0) === 0
                  }
                >
                  <SelectTrigger id="role-select">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles?.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{role.name}</span>
                          {role.description && (
                            <span className="text-xs text-muted-foreground">
                              {role.description}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!selectedUserId || !selectedRoleId || isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Assigning
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Assign Role
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Current Assignments</CardTitle>
              <p className="text-sm text-muted-foreground">
                Manage existing user-role assignments.
              </p>
            </div>
            {(isLoadingAssignments || isFetchingAssignments) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoadingAssignments ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : groupedAssignments.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No role assignments found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead className="text-right">Assignments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedAssignments.map((user) => {
                      const displayName = getUserDisplayName(user);
                      const initials = getInitials(displayName);
                      const latestAssignment = user.roles.reduce(
                        (latest, role) => {
                          const roleDate = new Date(role.assignedAt);
                          return roleDate > latest ? roleDate : latest;
                        },
                        new Date(0)
                      );

                      return (
                        <TableRow key={user.userId}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarImage src={user.imageUrl ?? undefined} />
                                <AvatarFallback>{initials}</AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">
                                    {displayName}
                                  </span>
                                  {user.userHandle && (
                                    <Badge
                                      variant="secondary"
                                      className="capitalize"
                                    >
                                      {user.userPlatform || ""} ·{" "}
                                      {user.userHandle}
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-sm text-muted-foreground">
                                  {user.email || "No email"}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground">
                                  {user.userId}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {user.roles.map((role) => (
                                <Badge
                                  key={role.id}
                                  variant="secondary"
                                  className="flex items-center gap-2 capitalize"
                                >
                                  <span>{role.roleName}</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => handleRemoveRole(role.id)}
                                    disabled={
                                      removingRoleId === role.id &&
                                      removeRoleMutation.isPending
                                    }
                                  >
                                    {removingRoleId === role.id &&
                                    removeRoleMutation.isPending ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {latestAssignment.getTime() > 0
                                ? latestAssignment.toLocaleString()
                                : "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {user.roles.length} role
                            {user.roles.length === 1 ? "" : "s"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminUserRoles;
