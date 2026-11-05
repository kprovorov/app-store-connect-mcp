export const groups = ["apps", "app-store", "testflight", "xcode-cloud", "analytics", "signing", "monetization", "game-center", "users", "webhooks", "assets", "distribution", "connections", "other"] as const;
export type ToolGroup = (typeof groups)[number];

export const presets = {
  dev: ["apps", "testflight", "xcode-cloud", "signing", "distribution", "connections"],
  aso: ["apps", "app-store", "assets", "connections"],
  testflight: ["apps", "testflight", "connections"],
  analytics: ["apps", "analytics", "connections"],
  full: groups,
} as const satisfies Record<string, readonly ToolGroup[]>;
export type Preset = keyof typeof presets;
