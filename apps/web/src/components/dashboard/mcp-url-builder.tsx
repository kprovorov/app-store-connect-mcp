import { useId } from "react";
import { ChevronDownIcon } from "lucide-react";
import { groups, presets, type Preset, type ToolGroup } from "@asc-mcp/contracts/mcp";

import { Input } from "@/components/ui/input";
import type { McpSelection } from "@/lib/mcp-url";

const groupLabels: Record<ToolGroup, string> = {
  apps: "Apps",
  "app-store": "App Store metadata and reviews",
  testflight: "TestFlight",
  "xcode-cloud": "Xcode Cloud",
  analytics: "Analytics and reports",
  signing: "Signing and devices",
  monetization: "Purchases and subscriptions",
  "game-center": "Game Center",
  users: "Users and invitations",
  webhooks: "Webhooks",
  assets: "Screenshots and assets",
  distribution: "Distribution",
  connections: "API key connections",
  other: "Other resources",
};

const presetLabels: Record<Preset, { label: string; description: string }> = {
  dev: { label: "Developer", description: "Apps, builds, TestFlight, signing, distribution, and Xcode Cloud." },
  aso: { label: "App Store optimization", description: "App Store text, keywords, reviews, screenshots, and assets." },
  testflight: { label: "TestFlight", description: "Builds, beta groups, testers, and feedback." },
  analytics: { label: "Analytics", description: "Analytics, sales and finance reports, and performance metrics." },
  full: { label: "All tools (1,300+)", description: "Every Apple API endpoint and the convenience tools, exposed directly." },
};

const selectClassName = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-xs md:text-sm";
const checkboxClassName = "size-4 shrink-0 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function McpUrlBuilder({
  selection,
  onSelectionChange,
  readOnly,
  onReadOnlyChange,
  error,
}: {
  selection: McpSelection;
  onSelectionChange: (selection: McpSelection) => void;
  readOnly: boolean;
  onReadOnlyChange: (readOnly: boolean) => void;
  error?: string;
}) {
  const id = useId();
  const isFullCatalog = selection.kind === "preset" && selection.preset === "full";
  const description = selection.kind === "preset"
    ? presetLabels[selection.preset].description
    : selection.kind === "default"
      ? "Your agent starts with discover and execute, then finds the API tools it needs."
      : selection.kind === "groups"
        ? "Expose direct tools from the groups you check."
        : "Enter exact tool names, such as list_apps,get_app. Use discover to find more names.";

  function changeSelection(value: string) {
    if (value === "default") onSelectionChange({ kind: "default" });
    else if (value === "groups") onSelectionChange({ kind: "groups", groups: [] });
    else if (value === "tools") onSelectionChange({ kind: "tools", tools: "" });
    else if (Object.hasOwn(presets, value)) onSelectionChange({ kind: "preset", preset: value as Preset });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        The default URL exposes discover and execute. Customize groups or tools, or enable read-only mode.
      </p>
      <details open className="group space-y-4">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          Customize connection
          <ChevronDownIcon aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="space-y-4 border-l-2 pl-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-selection`} className="block text-sm font-medium">Tools to expose</label>
            <select
              id={`${id}-selection`}
              className={selectClassName}
              value={selection.kind === "preset" ? selection.preset : selection.kind}
              onChange={(event) => changeSelection(event.target.value)}
              aria-describedby={isFullCatalog ? `${id}-description ${id}-full-warning` : `${id}-description`}
            >
              <option value="default">Default discovery</option>
              <optgroup label="Presets">
                {(Object.keys(presets) as Preset[]).map((preset) => <option key={preset} value={preset}>{presetLabels[preset].label}</option>)}
              </optgroup>
              <option value="groups">Choose groups</option>
              <option value="tools">Specific tools</option>
            </select>
            <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p>
            {isFullCatalog && (
              <p id={`${id}-full-warning`} role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                The full catalog contains 1,300+ tools. Loading a large tool list uses more of your agent&apos;s context.
                Use Default discovery or a smaller preset for everyday tasks.
              </p>
            )}
          </div>

          {selection.kind === "groups" && (
            <fieldset aria-describedby={error ? `${id}-error` : undefined} className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Groups</legend>
              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((group) => (
                  <label key={group} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className={checkboxClassName}
                      checked={selection.groups.includes(group)}
                      onChange={(event) => onSelectionChange({
                        kind: "groups",
                        groups: event.target.checked ? [...selection.groups, group] : selection.groups.filter((value) => value !== group),
                      })}
                    />
                    {groupLabels[group]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {selection.kind === "tools" && (
            <div className="space-y-2">
              <label htmlFor={`${id}-tools`} className="block text-sm font-medium">Tool names</label>
              <Input
                id={`${id}-tools`}
                value={selection.tools}
                onChange={(event) => onSelectionChange({ kind: "tools", tools: event.target.value })}
                placeholder="list_apps,get_app"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : `${id}-description`}
              />
            </div>
          )}

          {error && <p id={`${id}-error`} role="status" className="text-sm text-destructive">{error}</p>}

          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={readOnly} onChange={(event) => onReadOnlyChange(event.target.checked)} className={`${checkboxClassName} mt-0.5`} />
            <span>
              <span className="block font-medium">Read-only mode</span>
              <span className="mt-0.5 block text-muted-foreground">Blocks writes and uploads for this connection.</span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            These settings apply only to the URL you copy. Your Apple API key permissions stay the same,
            and you can connect with a different URL.
          </p>
        </div>
      </details>
    </div>
  );
}
