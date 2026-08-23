import { ReactNode, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface TermsDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  title?: string;
  description?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  loadingLabel?: string;
  content?: ReactNode;
  requireScroll?: boolean;
}

export const TermsDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
  title = "Terms & Conditions",
  description = "Please review and accept these terms before continuing.",
  cancelLabel = "Cancel",
  confirmLabel = "Accept",
  loadingLabel = "Processing",
  content,
  requireScroll = true,
}: TermsDialogProps) => {
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  const checkboxDisabled = useMemo(() => {
    if (isLoading) return true;
    return requireScroll && !isScrolledToBottom;
  }, [isLoading, requireScroll, isScrolledToBottom]);

  const canConfirm = useMemo(() => {
    return !checkboxDisabled && isChecked && !isLoading;
  }, [checkboxDisabled, isChecked, isLoading]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!requireScroll) return;
    const target = event.currentTarget;
    const scrolledToBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight <= 4;
    setIsScrolledToBottom(scrolledToBottom);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setIsScrolledToBottom(false);
      setIsChecked(false);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div
          className="max-h-64 overflow-y-auto space-y-3 rounded-md border p-3 text-sm text-muted-foreground"
          onScroll={handleScroll}
        >
          {content || (
            <>
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam
                egestas feugiat suscipit. Integer sed faucibus augue, sed congue
                neque. Donec viverra porttitor elit nec placerat.
              </p>
              <p>
                Aenean pharetra, ipsum at fermentum congue, massa libero
                pharetra nisi, at lobortis nisl orci ut ante. Praesent sit amet
                nisl pellentesque, dignissim nulla consequat, gravida orci.
              </p>
              <p>
                Integer non justo ac sapien ornare aliquet. Suspendisse potenti.
                Fusce facilisis metus eget odio commodo, a suscipit tellus
                pharetra. Pellentesque habitant morbi tristique senectus et
                netus.
              </p>
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam
                egestas feugiat suscipit. Integer sed faucibus augue, sed congue
                neque. Donec viverra porttitor elit nec placerat.
              </p>
              <p>
                Aenean pharetra, ipsum at fermentum congue, massa libero
                pharetra nisi, at lobortis nisl orci ut ante. Praesent sit amet
                nisl pellentesque, dignissim nulla consequat, gravida orci.
              </p>
              <p>
                Integer non justo ac sapien ornare aliquet. Suspendisse potenti.
                Fusce facilisis metus eget odio commodo, a suscipit tellus
                pharetra. Pellentesque habitant morbi tristique senectus et
                netus.
              </p>
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam
                egestas feugiat suscipit. Integer sed faucibus augue, sed congue
                neque. Donec viverra porttitor elit nec placerat.
              </p>
              <p>
                Aenean pharetra, ipsum at fermentum congue, massa libero
                pharetra nisi, at lobortis nisl orci ut ante. Praesent sit amet
                nisl pellentesque, dignissim nulla consequat, gravida orci.
              </p>
              <p>
                Integer non justo ac sapien ornare aliquet. Suspendisse potenti.
                Fusce facilisis metus eget odio commodo, a suscipit tellus
                pharetra. Pellentesque habitant morbi tristique senectus et
                netus.
              </p>
            </>
          )}
        </div>
        <div className="text-center">
          {checkboxDisabled && !isLoading && (
            <span className="mx-auto text-xs text-muted-foreground">
              (Please scroll to the bottom)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            id="terms-checkbox"
            checked={isChecked}
            onCheckedChange={(checked) => setIsChecked(Boolean(checked))}
            disabled={checkboxDisabled}
          />
          <label htmlFor="terms-checkbox" className="cursor-pointer">
            I have read and agree to the terms above.{" "}
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={() => {
              setIsChecked(false);
              setIsScrolledToBottom(false);
              void onConfirm();
            }}
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {loadingLabel}
              </span>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
