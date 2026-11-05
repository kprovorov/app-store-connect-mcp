"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function CopyButton({ value, label = "Copy", disabled = false }: { value: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={copied ? "Copied" : label}
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => toast.error("Couldn't copy. Select the text and copy it by hand."),
        )
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
