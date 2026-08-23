export type RewardEligibleUser = {
  discordId: string;
  discordUsername?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
};

export const formatRewardEligibleUserLabel = (user?: RewardEligibleUser) => {
  if (!user) return "Select a user";
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (fullName) return `${fullName} (${user.discordId})`;
  if (user.email) return `${user.email} (${user.discordId})`;
  return user.discordId;
};
