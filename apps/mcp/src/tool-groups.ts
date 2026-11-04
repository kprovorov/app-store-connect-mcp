import type { Operation } from "./catalog-builder";

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

const resourceFamilies: ReadonlyArray<readonly [RegExp, ToolGroup]> = [
  [/^(analytics|salesReports$|financeReports$|perfPowerMetrics$|performanceOverviews$|metrics$|diagnostic)/, "analytics"],
  [/^(beta|build|preReleaseVersions$)/, "testflight"],
  [/^(ci|scm)/, "xcode-cloud"],
  [/^(bundleId|certificates$|profiles$|devices$|merchantIds$|passTypeIds$)/, "signing"],
  [/^(gameCenter)/, "game-center"],
  [/^(inAppPurchase|subscription|promotedPurchases$|winBackOffers$|sandboxTester)/, "monetization"],
  [/^(users$|userInvitations$|actors$)/, "users"],
  [/^(webhook|marketplaceWebhook)/, "webhooks"],
  [/^(appAsset|appScreenshot|appPreview|assetLibrary$|placements$)/, "assets"],
  [/^(alternativeDistribution|backgroundAsset|appEncryption)/, "distribution"],
  [/^(appStore|appInfo|appCategories$|appClip|appCustomProduct|appEvent|appTags$|accessibilityDeclarations$|ageRatingDeclarations$|customerReview|reviewSubmission|appAvailabilit|appPrice|endAppAvailabilit|endUserLicense|territor|nominations$|routingAppCoverage|searchKeywords$)/, "app-store"],
  [/^(apps$|androidToIosAppMappingDetails$|marketplaceSearchDetails?$)/, "apps"],
];

export const operationGroups = (operation: Operation): readonly ToolGroup[] => {
  const segments = operation.path.split("/").filter((part) => part && !part.startsWith("{") && part !== "relationships");
  const root = segments[1] ?? "";
  const resource = root === "apps" ? segments[2] ?? root : root;
  const analyticsResource = segments.slice(1).some((segment) => resourceFamilies.find(([pattern]) => pattern.test(segment))?.[1] === "analytics");
  return [analyticsResource ? "analytics" : resourceFamilies.find(([pattern]) => pattern.test(resource))?.[1] ?? "other"];
};
