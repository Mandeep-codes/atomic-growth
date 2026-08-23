import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatRewardEligibleUserLabel,
  type RewardEligibleUser,
} from "@/lib/rewardUsers";

type RewardEligibleUserSelectProps = {
  users: RewardEligibleUser[];
  value?: string;
  onValueChange: (userId: string) => void;
  onUserSelected?: (user: RewardEligibleUser) => void;
  disabled?: boolean;
  isLoading?: boolean;
  errorMessage?: string;
  placeholder?: string;
  buttonClassName?: string;
  selectedUser?: RewardEligibleUser | null;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  isSearching?: boolean;
  minSearchChars?: number;
};

export const RewardEligibleUserSelect = ({
  users,
  value,
  onValueChange,
  onUserSelected,
  disabled,
  isLoading,
  errorMessage,
  placeholder = "Select a user",
  buttonClassName,
  selectedUser: selectedUserOverride,
  searchQuery,
  onSearchQueryChange,
  isSearching,
  minSearchChars = 0,
}: RewardEligibleUserSelectProps) => {
  const [open, setOpen] = useState(false);
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const resolvedSearchQuery = searchQuery ?? internalSearchQuery;
  const handleSearchChange = (nextValue: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(nextValue);
    }
    if (searchQuery === undefined) {
      setInternalSearchQuery(nextValue);
    }
  };
  const selectedUser = useMemo(() => {
    if (selectedUserOverride) return selectedUserOverride;
    return users.find((user) => user.discordId === value);
  }, [selectedUserOverride, users, value]);
  const trimmedSearchLength = resolvedSearchQuery.trim().length;
  const needsMoreInput =
    minSearchChars > 0 && trimmedSearchLength < minSearchChars;
  const emptyStateMessage = isSearching
    ? "Searching…"
    : needsMoreInput
    ? `Type at least ${minSearchChars} characters to search`
    : "No user found.";
  const hasResults = users.length > 0;

  const buttonLabel = isLoading
    ? "Loading users..."
    : errorMessage
    ? errorMessage
    : formatRewardEligibleUserLabel(selectedUser) || placeholder;

  const isDisabled = disabled || isLoading || Boolean(errorMessage);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            "w-full justify-between max-w-[360px]",
            buttonClassName
          )}
          disabled={isDisabled}
        >
          <span className="truncate text-left">{buttonLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={resolvedSearchQuery}
            onValueChange={handleSearchChange}
            placeholder="Search by name, email, or ID"
          />
          <CommandList>
            {hasResults ? (
              <CommandGroup>
                {users.map((user) => (
                  <CommandItem
                    key={user.discordId}
                    value={`${user.discordId} ${user.email ?? ""} ${
                      user.firstName ?? ""
                    } ${user.lastName ?? ""}`}
                    onSelect={() => {
                      onValueChange(user.discordId);
                      onUserSelected?.(user);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === user.discordId ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {formatRewardEligibleUserLabel(user)}
                      </span>
                      {user.email && (
                        <span className="text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      )}
                      {user.discordUsername && (
                        <span className="text-xs text-muted-foreground">
                          {user.discordUsername}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>{emptyStateMessage}</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
