import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-6 place-items-center rounded-md bg-foreground font-mono text-[11px] font-bold text-background"
      >
        A
      </span>
      App Store Connect MCP
    </Link>
  );
}
