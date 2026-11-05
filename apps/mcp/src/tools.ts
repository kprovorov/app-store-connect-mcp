import type { AscRequest } from "@asc-mcp/asc";
import { Schema } from "effect";
import type { ToolGroup } from "./tool-groups";

export interface AscTool<I> {
  readonly name: string;
  readonly groups: readonly ToolGroup[];
  readonly title: string;
  readonly description: string;
  readonly input: Schema.Codec<I, unknown>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: true;
  };
  readonly toRequest: (input: I) => AscRequest;
}

const define = <I>(tool: AscTool<I>) => tool as unknown as AscTool<unknown>;

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const NEXT_PAGE = "Follow links.next with asc_get on the compact root, /full, or an explicit ?tools=asc_get view. Group and role preset views exclude this arbitrary-path tool.";

const id = (what: string) => Schema.NonEmptyString.annotate({ description: what });
const limit = Schema.optionalKey(
  Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 }))).annotate({
    description: "Results per page, 1 to 200",
  }),
);
const Platform = Schema.Literals(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]);
const platform = (description: string) => Platform.annotate({ description });

const segment = (value: string) => encodeURIComponent(value);

const query = (params: Record<string, string | number | undefined>) =>
  Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined));

export const ascGet = define({
  name: "asc_get",
  groups: [],
  title: "GET any App Store Connect resource",
  description:
    "Read-only GET against the App Store Connect API for anything the named tools do not cover. " +
    "path is a relative API path such as /v1/apps/{id}/appInfos, or a full links.next URL from an earlier result. " +
    "query holds JSON:API parameters, for example {\"filter[platform]\": \"IOS\", \"include\": \"app\", \"fields[builds]\": \"version,uploadedDate\", \"limit\": \"50\"}. " +
    "Related resources live at /v1/{type}/{id}/{relationship}. Apple enforces read-only access on its side for this tool. " +
    "Returns data, included, links.next, and meta.paging.",
  input: Schema.Struct({
    path: Schema.NonEmptyString.annotate({
      description: "Path starting with /v1/ (or /v2/, /v3/), or a links.next URL on https://api.appstoreconnect.apple.com",
    }),
    query: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String).annotate({ description: "Query parameters as strings" }),
    ),
  }),
  annotations: read,
  toRequest: (input) => ({ method: "GET", path: input.path, query: input.query ?? {}, scoped: true }),
});

export const ascTools: ReadonlyArray<AscTool<unknown>> = [
  ascGet,
  define({
    name: "list_apps",
    groups: ["apps"],
    title: "List apps",
    description:
      "Lists the apps this key can see, with name, bundleId, sku, and primaryLocale. The id of each app is the app_id other tools take. " +
      `Filter by exact bundle_id or name. ${NEXT_PAGE}`,
    input: Schema.Struct({
      bundle_id: Schema.optionalKey(id("Exact bundle ID, such as com.example.app")),
      name: Schema.optionalKey(id("Exact app name")),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: "/v1/apps",
      query: query({ "filter[bundleId]": input.bundle_id, "filter[name]": input.name, limit: input.limit }),
    }),
  }),
  define({
    name: "get_app",
    groups: ["apps"],
    title: "Get an app",
    description: "Returns one app's attributes (name, bundleId, sku, primaryLocale, contentRightsDeclaration, and more).",
    input: Schema.Struct({ app_id: id("App id from list_apps") }),
    annotations: read,
    toRequest: (input) => ({ method: "GET", path: `/v1/apps/${segment(input.app_id)}` }),
  }),
  define({
    name: "list_builds",
    groups: ["testflight"],
    title: "List builds",
    description:
      "Lists an app's uploaded builds, newest first, with version (the build number), uploadedDate, processingState, expired, and minOsVersion. " +
      `Filter by build number, by marketing version (pre_release_version, such as 2.3.0), or by processing state. ${NEXT_PAGE}`,
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      version: Schema.optionalKey(id("Build number, the CFBundleVersion")),
      pre_release_version: Schema.optionalKey(id("Marketing version, the CFBundleShortVersionString")),
      processing_state: Schema.optionalKey(Schema.Literals(["PROCESSING", "FAILED", "INVALID", "VALID"])),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: "/v1/builds",
      query: query({
        "filter[app]": input.app_id,
        "filter[version]": input.version,
        "filter[preReleaseVersion.version]": input.pre_release_version,
        "filter[processingState]": input.processing_state,
        sort: "-uploadedDate",
        limit: input.limit,
      }),
    }),
  }),
  define({
    name: "list_app_store_versions",
    groups: ["app-store"],
    title: "List App Store versions",
    description:
      "Lists an app's App Store versions with versionString, platform, appVersionState, releaseType, and createdDate. " +
      `Use a version id with list_version_localizations. ${NEXT_PAGE}`,
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      platform: Schema.optionalKey(platform("Only this platform")),
      version_string: Schema.optionalKey(id("Exact version string, such as 2.3.0")),
      state: Schema.optionalKey(
        Schema.Literals([
          "ACCEPTED",
          "DEVELOPER_REJECTED",
          "IN_REVIEW",
          "INVALID_BINARY",
          "METADATA_REJECTED",
          "PENDING_APPLE_RELEASE",
          "PENDING_DEVELOPER_RELEASE",
          "PREPARE_FOR_SUBMISSION",
          "PROCESSING_FOR_DISTRIBUTION",
          "READY_FOR_DISTRIBUTION",
          "READY_FOR_REVIEW",
          "REJECTED",
          "REPLACED_WITH_NEW_VERSION",
          "WAITING_FOR_EXPORT_COMPLIANCE",
          "WAITING_FOR_REVIEW",
        ]).annotate({ description: "Only versions in this appVersionState" }),
      ),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/apps/${segment(input.app_id)}/appStoreVersions`,
      query: query({
        "filter[platform]": input.platform,
        "filter[versionString]": input.version_string,
        "filter[appVersionState]": input.state,
        limit: input.limit,
      }),
    }),
  }),
  define({
    name: "list_version_localizations",
    groups: ["app-store"],
    title: "List version localizations",
    description:
      "Lists the per-locale App Store text of one version: description, keywords, whatsNew, promotionalText, marketingUrl, supportUrl. " +
      "The id of each entry is the localization_id update_version_localization takes.",
    input: Schema.Struct({
      version_id: id("App Store version id from list_app_store_versions"),
      locale: Schema.optionalKey(id("Only this locale, such as en-US")),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/appStoreVersions/${segment(input.version_id)}/appStoreVersionLocalizations`,
      query: query({ "filter[locale]": input.locale, limit: input.limit }),
    }),
  }),
  define({
    name: "list_review_submissions",
    groups: ["app-store"],
    title: "List review submissions",
    description:
      "Lists an app's App Review submissions with state (READY_FOR_REVIEW, WAITING_FOR_REVIEW, IN_REVIEW, UNRESOLVED_ISSUES, COMPLETE, ...), " +
      `platform, and submittedDate. Use a submission id with list_review_submission_items. ${NEXT_PAGE}`,
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      platform: Schema.optionalKey(platform("Only this platform")),
      state: Schema.optionalKey(
        Schema.Literals([
          "READY_FOR_REVIEW",
          "WAITING_FOR_REVIEW",
          "IN_REVIEW",
          "UNRESOLVED_ISSUES",
          "CANCELING",
          "COMPLETING",
          "COMPLETE",
        ]),
      ),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: "/v1/reviewSubmissions",
      query: query({
        "filter[app]": input.app_id,
        "filter[platform]": input.platform,
        "filter[state]": input.state,
        limit: input.limit,
      }),
    }),
  }),
  define({
    name: "list_review_submission_items",
    groups: ["app-store"],
    title: "List review submission items",
    description:
      "Lists what one review submission contains (App Store versions, in-app purchases, custom product pages, and so on) with each item's state.",
    input: Schema.Struct({ submission_id: id("Review submission id from list_review_submissions"), limit }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/reviewSubmissions/${segment(input.submission_id)}/items`,
      query: query({ limit: input.limit }),
    }),
  }),
  define({
    name: "list_customer_reviews",
    groups: ["app-store"],
    title: "List customer reviews",
    description:
      "Lists an app's App Store ratings and reviews with rating, title, body, reviewerNickname, territory, and createdDate. Newest first by default. " +
      `Filter by star rating, by territory, or by whether a developer response is published. ${NEXT_PAGE}`,
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      rating: Schema.optionalKey(
        Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 5 }))).annotate({ description: "Stars, 1 to 5" }),
      ),
      territory: Schema.optionalKey(id("Three-letter territory code, such as USA or DEU")),
      has_response: Schema.optionalKey(Schema.Boolean.annotate({ description: "true for answered reviews, false for unanswered" })),
      sort: Schema.optionalKey(Schema.Literals(["-createdDate", "createdDate", "-rating", "rating"])),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/apps/${segment(input.app_id)}/customerReviews`,
      query: query({
        "filter[rating]": input.rating,
        "filter[territory]": input.territory,
        "exists[publishedResponse]": input.has_response === undefined ? undefined : String(input.has_response),
        sort: input.sort ?? "-createdDate",
        limit: input.limit,
      }),
    }),
  }),
  define({
    name: "get_review_summary",
    groups: ["app-store"],
    title: "Get the review summary",
    description: "Returns Apple's generated summary of an app's customer reviews for one platform, optionally for one territory.",
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      platform: platform("Platform to summarize"),
      territory: Schema.optionalKey(id("Three-letter territory code, such as USA")),
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/apps/${segment(input.app_id)}/customerReviewSummarizations`,
      query: query({ "filter[platform]": input.platform, "filter[territory]": input.territory }),
    }),
  }),
  define({
    name: "list_beta_groups",
    groups: ["testflight"],
    title: "List TestFlight groups",
    description:
      "Lists an app's TestFlight beta groups with name, isInternalGroup, publicLinkEnabled, and publicLink. " +
      "The id of each group is the group_id the tester tools take.",
    input: Schema.Struct({ app_id: id("App id from list_apps"), limit }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/apps/${segment(input.app_id)}/betaGroups`,
      query: query({ limit: input.limit }),
    }),
  }),
  define({
    name: "list_beta_testers",
    groups: ["testflight"],
    title: "List TestFlight testers",
    description:
      "Lists TestFlight testers with firstName, lastName, email, inviteType, and state. " +
      `Filter by app, by group, or by exact email. ${NEXT_PAGE}`,
    input: Schema.Struct({
      app_id: Schema.optionalKey(id("Only testers of this app")),
      group_id: Schema.optionalKey(id("Only testers in this beta group")),
      email: Schema.optionalKey(id("Exact email address")),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: "/v1/betaTesters",
      query: query({
        "filter[apps]": input.app_id,
        "filter[betaGroups]": input.group_id,
        "filter[email]": input.email,
        limit: input.limit,
      }),
    }),
  }),
  define({
    name: "list_build_beta_localizations",
    groups: ["testflight"],
    title: "List a build's What to Test notes",
    description:
      "Lists one build's TestFlight What to Test text per locale (whatsNew, locale). " +
      "The id of each entry is the localization_id set_what_to_test takes to update it.",
    input: Schema.Struct({ build_id: id("Build id from list_builds"), limit }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/builds/${segment(input.build_id)}/betaBuildLocalizations`,
      query: query({ limit: input.limit }),
    }),
  }),
  define({
    name: "list_beta_feedback_crashes",
    groups: ["testflight"],
    title: "List TestFlight crash feedback",
    description:
      "Lists crashes TestFlight testers submitted for an app, newest first, with comment, deviceModel, osVersion, and createdDate. " +
      `Fetch the crash log with asc_get at /v1/betaFeedbackCrashSubmissions/{id}/crashLog. ${NEXT_PAGE}`,
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      build_id: Schema.optionalKey(id("Only crashes from this build")),
      limit,
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/apps/${segment(input.app_id)}/betaFeedbackCrashSubmissions`,
      query: query({ "filter[build]": input.build_id, sort: "-createdDate", limit: input.limit }),
    }),
  }),
  define({
    name: "list_ci_build_runs",
    groups: ["xcode-cloud"],
    title: "List Xcode Cloud build runs",
    description:
      "Lists Xcode Cloud build runs, newest first, with number, executionProgress, completionStatus, startReason, and dates. " +
      "Pass product_id for every workflow of a product, or workflow_id for one workflow. " +
      `Find product ids with asc_get at /v1/ciProducts. ${NEXT_PAGE}`,
    input: Schema.Struct({
      product_id: Schema.optionalKey(id("Xcode Cloud product id")),
      workflow_id: Schema.optionalKey(id("Xcode Cloud workflow id")),
      limit,
    }).pipe(
      Schema.check(
        Schema.makeFilter(
          (input: { product_id?: string; workflow_id?: string }) =>
            (input.product_id === undefined) !== (input.workflow_id === undefined) ||
            "Pass exactly one of product_id or workflow_id",
        ),
      ),
    ),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: input.workflow_id
        ? `/v1/ciWorkflows/${segment(input.workflow_id)}/buildRuns`
        : `/v1/ciProducts/${segment(input.product_id ?? "")}/buildRuns`,
      query: query({ sort: "-number", limit: input.limit }),
    }),
  }),
  define({
    name: "get_app_perf_metrics",
    groups: ["analytics"],
    title: "Get app performance metrics",
    description:
      "Returns Apple's power and performance metrics for an app (launch time, hangs, memory, battery, disk, and more) " +
      "as Xcode metrics JSON, not JSON:API. Narrow with metric_type to keep the result small.",
    input: Schema.Struct({
      app_id: id("App id from list_apps"),
      metric_type: Schema.optionalKey(
        Schema.Literals(["DISK", "HANG", "BATTERY", "LAUNCH", "MEMORY", "ANIMATION", "TERMINATION", "STORAGE"]),
      ),
      device_type: Schema.optionalKey(id("Device type, such as iPhone or iPad")),
    }),
    annotations: read,
    toRequest: (input) => ({
      method: "GET",
      path: `/v1/apps/${segment(input.app_id)}/perfPowerMetrics`,
      query: query({ "filter[metricType]": input.metric_type, "filter[deviceType]": input.device_type }),
    }),
  }),
  define({
    name: "reply_to_review",
    groups: ["app-store"],
    title: "Reply to a customer review",
    description:
      "Publishes a public developer response to a customer review. It replaces any existing response and appears on the App Store after a delay. " +
      "Read the current response first with asc_get at /v1/customerReviews/{id}/response. Needs a key with the Admin or Customer Support role.",
    input: Schema.Struct({
      review_id: id("Customer review id from list_customer_reviews"),
      response_body: id("The reply text, shown publicly"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    toRequest: (input) => ({
      method: "POST",
      path: "/v1/customerReviewResponses",
      body: {
        data: {
          type: "customerReviewResponses",
          attributes: { responseBody: input.response_body },
          relationships: { review: { data: { type: "customerReviews", id: input.review_id } } },
        },
      },
    }),
  }),
  define({
    name: "update_version_localization",
    groups: ["app-store"],
    title: "Update App Store text for a version",
    description:
      "Changes one locale's App Store text for one version. Only the fields you pass change. " +
      "Get localization_id from list_version_localizations. Apple rejects edits to fields locked by the version's state; the error detail names them.",
    input: Schema.Struct({
      localization_id: id("Localization id from list_version_localizations"),
      description: Schema.optionalKey(Schema.String),
      keywords: Schema.optionalKey(Schema.String.annotate({ description: "Comma-separated, 100 characters at most" })),
      whats_new: Schema.optionalKey(Schema.String.annotate({ description: "Release notes" })),
      promotional_text: Schema.optionalKey(Schema.String),
      marketing_url: Schema.optionalKey(Schema.String),
      support_url: Schema.optionalKey(Schema.String),
    }).pipe(
      Schema.check(
        Schema.makeFilter(
          (input: Record<string, unknown>) =>
            Object.keys(input).some((key) => key !== "localization_id") || "Pass at least one field to change",
        ),
      ),
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    toRequest: (input) => ({
      method: "PATCH",
      path: `/v1/appStoreVersionLocalizations/${segment(input.localization_id)}`,
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          id: input.localization_id,
          attributes: {
            description: input.description,
            keywords: input.keywords,
            whatsNew: input.whats_new,
            promotionalText: input.promotional_text,
            marketingUrl: input.marketing_url,
            supportUrl: input.support_url,
          },
        },
      },
    }),
  }),
  define({
    name: "set_what_to_test",
    groups: ["testflight"],
    title: "Set a build's What to Test notes",
    description:
      "Sets the TestFlight What to Test text for a build in one locale. To change an existing locale, pass its localization_id " +
      "from list_build_beta_localizations. To add a locale, pass build_id and locale instead.",
    input: Schema.Struct({
      whats_new: id("What testers should focus on"),
      localization_id: Schema.optionalKey(id("Existing localization id, to update it")),
      build_id: Schema.optionalKey(id("Build id, to add a locale")),
      locale: Schema.optionalKey(id("Locale to add, such as en-US. Needs build_id")),
    }).pipe(
      Schema.check(
        Schema.makeFilter(
          (input: { localization_id?: string; build_id?: string; locale?: string }) =>
            input.localization_id !== undefined
              ? (input.build_id === undefined && input.locale === undefined) ||
                "Pass localization_id alone, or build_id with locale"
              : (input.build_id !== undefined && input.locale !== undefined) ||
                "Pass localization_id alone, or build_id with locale",
        ),
      ),
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    toRequest: (input): AscRequest =>
      input.localization_id !== undefined
        ? {
            method: "PATCH",
            path: `/v1/betaBuildLocalizations/${segment(input.localization_id)}`,
            body: {
              data: { type: "betaBuildLocalizations", id: input.localization_id, attributes: { whatsNew: input.whats_new } },
            },
          }
        : {
            method: "POST",
            path: "/v1/betaBuildLocalizations",
            body: {
              data: {
                type: "betaBuildLocalizations",
                attributes: { whatsNew: input.whats_new, locale: input.locale },
                relationships: { build: { data: { type: "builds", id: input.build_id } } },
              },
            },
          },
  }),
  define({
    name: "add_beta_tester",
    groups: ["testflight"],
    title: "Invite a TestFlight tester",
    description:
      "Creates a TestFlight tester by email and adds them to one or more beta groups, which invites them to test. " +
      "Get group ids from list_beta_groups. External groups need an App Manager or higher key.",
    input: Schema.Struct({
      email: id("Tester's email address"),
      first_name: Schema.optionalKey(Schema.String),
      last_name: Schema.optionalKey(Schema.String),
      group_ids: Schema.NonEmptyArray(Schema.NonEmptyString).annotate({ description: "Beta group ids to add the tester to" }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    toRequest: (input) => ({
      method: "POST",
      path: "/v1/betaTesters",
      body: {
        data: {
          type: "betaTesters",
          attributes: { email: input.email, firstName: input.first_name, lastName: input.last_name },
          relationships: { betaGroups: { data: input.group_ids.map((groupId) => ({ type: "betaGroups", id: groupId })) } },
        },
      },
    }),
  }),
  define({
    name: "add_testers_to_group",
    groups: ["testflight"],
    title: "Add testers to a TestFlight group",
    description:
      "Adds existing TestFlight testers to a beta group. Get tester ids from list_beta_testers and the group id from list_beta_groups. " +
      "Returns an empty success.",
    input: Schema.Struct({
      group_id: id("Beta group id from list_beta_groups"),
      tester_ids: Schema.NonEmptyArray(Schema.NonEmptyString).annotate({ description: "Beta tester ids" }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    toRequest: (input) => ({
      method: "POST",
      path: `/v1/betaGroups/${segment(input.group_id)}/relationships/betaTesters`,
      body: { data: input.tester_ids.map((testerId) => ({ type: "betaTesters", id: testerId })) },
    }),
  }),
];
