import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ALL_COUNTRIES } from "@/lib/countries";

interface CountryPickerProps {
  excluded: string[];
  onPick: (country: string) => void;
  disabled?: boolean;
  buttonLabel?: string;
}

// Searchable dropdown for adding a country not already in the form.
// Forces the user to pick from the canonical ISO list so no typos
// or spelling variants ("USA" vs "United States", "UK" vs "United
// Kingdom") slip through.
export const CountryPicker = ({
  excluded,
  onPick,
  disabled = false,
  buttonLabel = "+ Add other country",
}: CountryPickerProps) => {
  const [open, setOpen] = useState(false);

  const excludedLower = new Set(excluded.map((c) => c.toLowerCase()));
  const available = ALL_COUNTRIES.filter(
    (c) => !excludedLower.has(c.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          type="button"
          className="justify-between"
        >
          <span className="flex items-center gap-1">
            <Plus className="h-3 w-3" />
            {buttonLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search countries..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {available.map((country) => (
                <CommandItem
                  key={country}
                  value={country}
                  onSelect={() => {
                    onPick(country);
                    setOpen(false);
                  }}
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  {country}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
