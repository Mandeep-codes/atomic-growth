import { useState } from "react";
import { Loader2, Plus, Trash2, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
// Single source of truth for country names — the API validates against this
// exact enum, so a free-text box would let an admin type "USA" or "uk" and get
// a validation error with no way to discover the accepted spelling.
// Imported from countries.ts, NOT from demographic.ts: this is a value import,
// so the bundler pulls the file into the frontend build, and demographic.ts
// imports zod — which does not resolve from outside frontend/ on the deploy
// host. countries.ts is deliberately import-free for that reason.
import { COUNTRIES as COUNTRY_LIST } from "../../../backend/src/lib/zod-schemas/countries";

const COUNTRIES = COUNTRY_LIST as unknown as string[];

interface Props {
  campaignId: string;
  /** Hide the create/delete controls — used on the read-only stats page. */
  readOnly?: boolean;
}

type CountryDraft = { country: string; minPercentage: string };

const emptyDraft = (): { name: string; bonus: string; countries: CountryDraft[] } => ({
  name: "",
  bonus: "",
  countries: [{ country: "", minPercentage: "" }],
});

/**
 * Geo payout criteria for one campaign, plus a live preview of which connected
 * accounts currently qualify. The preview is read-only — it prices nothing — so
 * thresholds can be tuned and re-checked before any money is affected.
 */
export const CampaignGeoRulesManager = ({ campaignId, readOnly }: Props) => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState(emptyDraft());

  // Auto-refresh: a clipper completing the two-step process (submit → mod
  // approval) changes who qualifies and what clears. An admin watching this
  // panel should see that happen without hunting for a refresh button.
  // Also refetches whenever the tab regains focus, which covers the common
  // case of approving in one tab and watching in another.
  const preview = trpc.campaigns.previewGeoQualification.useQuery(
    { campaignId },
    { refetchInterval: 10_000, refetchOnWindowFocus: true }
  );

  const refresh = () => {
    void utils.campaigns.previewGeoQualification.invalidate({ campaignId });
  };

  const createRule = trpc.campaigns.createGeoRule.useMutation({
    onSuccess: () => {
      toast({ title: "Criteria added" });
      setDraft(emptyDraft());
      refresh();
    },
    onError: (error) =>
      toast({
        title: "Could not add criteria",
        description: error.message,
        variant: "destructive",
      }),
  });

  const deleteRule = trpc.campaigns.deleteGeoRule.useMutation({
    onSuccess: () => {
      toast({ title: "Criteria removed" });
      refresh();
    },
    onError: (error) =>
      toast({
        title: "Could not remove criteria",
        description: error.message,
        variant: "destructive",
      }),
  });

  const submit = () => {
    createRule.mutate({
      campaignId,
      name: draft.name || null,
      matchMode: "each",
      bonusCpmPer1000: Number(draft.bonus),
      minCombinedPercentage: 0,
      countries: draft.countries
        .filter((c) => c.country.trim())
        .map((c) => ({
          country: c.country.trim() as never,
          minPercentage: Number(c.minPercentage),
        })),
    });
  };

  const rules = preview.data?.rules ?? [];
  const accounts = preview.data?.accounts ?? [];

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Geo payout criteria</CardTitle>
            <CardDescription>
              Set audience conditions per campaign. An account whose latest
              approved weekly demographics meet a criterion earns{" "}
              <strong>base + extra</strong> CPM for that week. If several match,
              the highest extra applies.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* ── Existing criteria ── */}
        <div className="space-y-3">
          {preview.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rules.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No criteria yet — this campaign pays the base rate to everyone.
            </p>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {rule.name || "Untitled criteria"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {(rule.countries ?? [])
                      .map(
                        (c: { country: string; min_percentage?: number }) =>
                          `${c.country} ≥ ${c.min_percentage ?? 0}%`
                      )
                      .join("  AND  ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="secondary" className="text-sm">
                    + ${Number(rule.bonus_cpm_per_1000).toFixed(2)} / 1,000
                  </Badge>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        deleteRule.mutate({ campaignId, ruleId: rule.id })
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Add a criterion ── */}
        {!readOnly && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                placeholder="Tier 1 — US + UK"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Extra CPM per 1,000 views ($)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.25"
                value={draft.bonus}
                onChange={(e) => setDraft({ ...draft, bonus: e.target.value })}
              />
            </div>
          </div>

          <Label>Countries — every condition must be met</Label>
          {draft.countries.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select
                value={c.country}
                onValueChange={(value) => {
                  const next = [...draft.countries];
                  next[i] = { ...next[i], country: value };
                  setDraft({ ...draft, countries: next });
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a country…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES
                    // Hide countries already used in this rule — duplicates are
                    // rejected by the API, so offering them is a dead end.
                    .filter(
                      (name) =>
                        name === c.country ||
                        !draft.countries.some((other) => other.country === name)
                    )
                    .map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                className="w-24"
                placeholder="min %"
                value={c.minPercentage}
                onChange={(e) => {
                  const next = [...draft.countries];
                  next[i] = { ...next[i], minPercentage: e.target.value };
                  setDraft({ ...draft, countries: next });
                }}
              />
              <span className="text-sm text-muted-foreground">%</span>
              {draft.countries.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      countries: draft.countries.filter((_, j) => j !== i),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  countries: [
                    ...draft.countries,
                    { country: "", minPercentage: "" },
                  ],
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add country
            </Button>
            <Button
              size="sm"
              onClick={submit}
              // Guard the obvious mistakes in the UI rather than bouncing the
              // admin off a server-side validation error.
              disabled={
                createRule.isLoading ||
                !Number(draft.bonus) ||
                draft.countries.some(
                  (c) => !c.country || !Number(c.minPercentage)
                )
              }
            >
              {createRule.isLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save criteria
            </Button>
          </div>
        </div>
        )}

        {/* ── Who qualifies right now ── */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-semibold">Who qualifies right now</h4>
            <Badge variant="outline">
              {preview.data?.qualifiedCount ?? 0} of{" "}
              {preview.data?.totalCount ?? 0} accounts
            </Badge>
          </div>

          {accounts.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No connected accounts with approved clips on this campaign yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-4">Account</th>
                    <th className="py-2 pr-4">Top countries (approved)</th>
                    <th className="py-2 pr-4">This week</th>
                    <th className="py-2 pr-4">Qualified</th>
                    <th className="py-2 pr-4 text-right">Base</th>
                    <th className="py-2 pr-4 text-right">Extra</th>
                    <th className="py-2 pr-4 text-right">Effective</th>
                    <th className="py-2 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.verifiedUserId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {a.handle}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {a.platform}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {a.hasApprovedReport
                          ? a.topCountries
                              .map((c) => `${c.country} ${c.percentage}%`)
                              .join(", ")
                          : "— no approved demographics —"}
                      </td>
                      {/* Step 1 — has this week's report been filed/approved? */}
                      <td className="py-2 pr-4">
                        {a.thisCycleStatus === "approved" ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">
                            Approved
                          </Badge>
                        ) : a.thisCycleStatus === "missing" ? (
                          <Badge variant="outline">Not submitted</Badge>
                        ) : a.thisCycleStatus === "rejected" ? (
                          <Badge variant="destructive">Rejected</Badge>
                        ) : (
                          <Badge variant="secondary">Under review</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {a.accountDisabled ? (
                          <Badge variant="destructive">Account disabled</Badge>
                        ) : a.qualifiedRuleId ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">
                            {a.qualifiedRuleName || "Qualified"}
                          </Badge>
                        ) : a.lostQualification ? (
                          // Qualified last week, not this week — this is the
                          // account whose held bonus gets withheld at the
                          // second check. Called out explicitly because it's
                          // the case an admin has to explain to a clipper.
                          <Badge variant="destructive">
                            Dropped out — bonus stops
                          </Badge>
                        ) : (
                          <Badge variant="outline">Base only</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        ${a.baseCpm.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {a.bonusCpm > 0 ? (
                          <span className="font-medium text-emerald-600">
                            + ${a.bonusCpm.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold">
                        ${a.effectiveCpm.toFixed(2)}
                      </td>
                      {/* Step 2 outcome — what the clearance actually did. */}
                      <td className="py-2 text-right text-xs">
                        {a.heldAmount > 0 && (
                          <div className="text-amber-700 dark:text-amber-400">
                            ${a.heldAmount.toFixed(2)} held
                          </div>
                        )}
                        {a.clearedAmount > 0 && (
                          <div className="text-emerald-600">
                            ${a.clearedAmount.toFixed(2)} released
                          </div>
                        )}
                        {a.cancelledAmount > 0 && (
                          <div className="text-destructive">
                            ${a.cancelledAmount.toFixed(2)} bonus withheld
                          </div>
                        )}
                        {a.heldAmount === 0 &&
                          a.clearedAmount === 0 &&
                          a.cancelledAmount === 0 && (
                            <span className="text-muted-foreground">—</span>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
