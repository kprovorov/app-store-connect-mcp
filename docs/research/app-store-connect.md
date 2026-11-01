# App Store Connect API research

This doc answers what our hosted MCP server needs from the App Store Connect (ASC) API. It covers how a user connects a key, the limits we work within, where the spec lives, the tool catalog, and what to ship first.

Research date is 2026-11-01. The spec version is 4.5.1. Every endpoint path below appears in that spec. The last section says how that was checked.

Labels used in this doc:

- **unverified** means no primary source confirmed the claim.
- **inferred** means the claim follows from a primary source but the source does not state it directly.

## 1. How a user connects ASC

### There is no third-party OAuth

ASC has no OAuth flow for third-party apps. The spec declares one security scheme, `itc-bearer-token`, an HTTP bearer JWT. Apple's docs describe only API keys that the customer creates and signs tokens with. Our server must hold the customer's private key and sign JWTs on their behalf.

Sources: [Creating API Keys for App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api), `components.securitySchemes` in the [OpenAPI spec](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip).

### One-time prerequisite

The Account Holder must request API access once per team. The path is **Users and Access** > **Integrations** > **Request Access**. Apple reviews each request case by case. A user whose team never did this cannot create any key.

Source: [App Store Connect API (Help)](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/).

### Team keys

- **Who can create one.** Account Holder or Admin.
- **UI path.** **Users and Access** > **Integrations** > **App Store Connect API** > **Team Keys** > **Generate API Key** (or **+** if a key exists). Enter a name, pick the role under **Access**, then click **Generate**.
- **Scope.** A team key reaches every app in the account. You cannot limit it to some apps.
- **Roles.** Apple says the roles for keys are the same roles that apply to users. The `UserRole` enum in the spec lists `ADMIN`, `FINANCE`, `ACCOUNT_HOLDER`, `SALES`, `MARKETING`, `APP_MANAGER`, `DEVELOPER`, `ACCESS_TO_REPORTS`, `CUSTOMER_SUPPORT`, `CREATE_APPS`, `CLOUD_MANAGED_DEVELOPER_ID`, `CLOUD_MANAGED_APP_DISTRIBUTION`, and `GENERATE_INDIVIDUAL_KEYS`. Which of these the key form offers is unverified. A developer forum post says Customer Support cannot be assigned to a team key. That claim is unverified. Whether the form allows one role or several is also unverified.
- **Role naming drift.** The role matrix calls the role "Sales". The Analytics docs call it "Sales and Reports". Release notes 4.3 and 4.4 deprecate `ACCESS_TO_REPORTS`, but the enum still has it.
- **Editing.** You cannot change a key's name or role after creation. To change either, revoke the key and make a new one.
- **Credentials we collect.** Issuer ID (shown at the top of the Integrations page), key ID, and the `.p8` private key.

### Individual keys

- **Who can create one.** Account Holder, Admin, App Manager, Customer Support, Developer, or Marketing. The user also needs the **Generate Individual API Keys** permission, which every user has by default. An Admin can remove it.
- **UI path.** Click your username at the top right, then **Edit Profile** > **Individual API Key** > **Generate Key**.
- **Scope.** The key carries the user's own roles and app access.
- **Limit.** Each user can have one active individual key.
- **Blocked areas.** Individual keys cannot call Provisioning endpoints, Sales and Finance endpoints, or `notaryTool`.
- **Credentials we collect.** Key ID and the `.p8` private key. There is no issuer ID.

### The `.p8` download is one-time

The private key downloads once. The download link disappears after that. Apple keeps no copy. If the customer loses the file, they must revoke the key and create a new one. Our connect form must accept the file contents and never show them again.

### Revocation

Account Holder or Admin can revoke any key at **Users and Access** > **Integrations** > **Individual Keys** or **Team Keys** > **Edit** > select keys > **Revoke Key**. A user can revoke their own individual key from **Edit Profile**. A revoked key cannot be restored. Revoked keys stay listed for 30 days.

Apple's API doc for revocation still says the **Keys** tab. The Help page and the key-creation doc say **Integrations**. Treat **Integrations** as current.

ASC has no endpoint or event that reports a revoked key. We expect a revoked key to fail with `401` on the next call (inferred). We should then mark the connection broken and tell the user.

Sources: [Revoking API Keys](https://developer.apple.com/documentation/appstoreconnectapi/revoking-api-keys), [App Store Connect API (Help)](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/).

### JWT format

Header for both key types:

```json
{ "alg": "ES256", "kid": "<key ID>", "typ": "JWT" }
```

Payload for a team key:

```json
{
	"iss": "<issuer ID>",
	"iat": 1528407600,
	"exp": 1528408800,
	"aud": "appstoreconnect-v1",
	"scope": ["GET /v1/apps?filter[platform]=IOS"]
}
```

Payload for an individual key. It has `sub` and no `iss`:

```json
{
	"sub": "user",
	"iat": 1528407600,
	"exp": 1528408800,
	"aud": "appstoreconnect-v1"
}
```

Rules from Apple:

- Sign with ES256 using the `.p8` key that matches `kid`.
- ASC computes lifetime as `exp - iat`. It rejects most tokens with a lifetime over 20 minutes.
- `scope` is optional. Each entry is `GET`, a path, and an optional query string. ASC rejects a scoped token for any request that matches no entry. Query order does not matter. ASC ignores `limit`, `cursor`, and `sort` when it matches.
- Tokens with a GET-only scope may live up to six months, but only for Xcode Cloud and power and performance resources. We do not need this.
- Apple recommends reusing one token for many requests until it expires.
- Send the token as `Authorization: Bearer <token>`.

Source: [Generating Tokens for API Requests](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests).

### What our users should create

Role permissions come from Apple's role matrix ([Roles](https://developer.apple.com/help/account/access/roles/)). No single role below Admin covers everything an agent wants:

| Need | Roles with full access |
| --- | --- |
| Edit App Store details (description, keywords, what's new) | Account Holder, Admin, App Manager, Marketing, Customer Support |
| Submit apps | Account Holder, Admin, App Manager |
| Manage external TestFlight groups and builds | Account Holder, Admin, App Manager (Developer and Marketing are read-only) |
| Manage internal TestFlight groups | Account Holder, Admin, App Manager, Developer, Marketing |
| View ratings and reviews | Account Holder, Admin, App Manager, Developer, Marketing, Customer Support |
| Respond to customer reviews | Account Holder, Admin, Customer Support |
| Edit pricing and availability | Account Holder, Admin, App Manager (Marketing is read-only) |
| View sales and trends, app analytics | Account Holder, Admin, Finance, Sales |
| View payments and financial reports | Account Holder, Admin, Finance |
| Manage webhooks | Account Holder, Admin, App Manager |
| Manage Users and Access | Account Holder, Admin |

Recommendation:

1. **Default to a team key with the App Manager role.** It covers apps, builds, TestFlight, metadata, submissions, pricing, IAP, webhooks, and reading reviews. It cannot manage users. That limit is good for an agent.
2. **Add a second team key with the Sales or Finance role** for reports. Sales and Finance endpoints reject individual keys. Our plan already allows several connections per org, so this fits.
3. **Use Admin only if the customer wants review replies** or user management. App Manager cannot respond to reviews. Customer Support can, but whether a team key can hold that role is unverified. Test it with a real key before we promise review replies on a non-Admin key.
4. **Offer individual keys as the option for app-limited access.** An agency that sees only some of a client's apps needs this. The downsides are real. The key has no Sales and Finance or Provisioning access. Each user has only one key. The key's access follows the user's roles. That the key stops working when the user leaves the team is inferred, not stated by Apple.
5. **Tell users to create a key just for us.** The rate limit is per key, so a key shared with their CI shares one hourly budget.

The connect form also needs the **vendor number** for sales and finance reports. `filter[vendorNumber]` is required on both report endpoints, and no endpoint in the spec returns it.

The plan validates keys with `GET /v1/apps?limit=1`. Whether a Sales-only or Finance-only key may call that endpoint is unverified.

## 2. Operational limits

### Rate limits

Every response carries an `X-Rate-Limit` header like this:

```
user-hour-lim:3500;user-hour-rem:500;
```

- `user-hour-lim` is the hourly request limit for the API key. Apple says actual limits vary.
- `user-hour-rem` is what remains in the rolling hour, meaning the last 60 minutes.
- Going over returns HTTP `429` with error code `RATE_LIMIT_EXCEEDED`.
- The limit applies per API key. Each connection has its own budget, and every agent using that connection shares it.

Our server should parse the header on every response, store the remainder per connection, and return a clear error to the agent on `429` instead of retrying in a loop.

Source: [Identifying Rate Limits](https://developer.apple.com/documentation/appstoreconnectapi/identifying-rate-limits).

### Pagination

- List responses include `links.self`, and `links.next` when more pages exist. `links.next` is a full URL. Follow it as is.
- `meta.paging` has `limit`, an optional `total`, and an optional `nextCursor`.
- `limit` has a maximum of 200 on 456 GET operations in the spec.
- Nine price-point operations allow up to 8000. They are `GET /v2/inAppPurchases/{id}/pricePoints`, `GET /v1/subscriptions/{id}/pricePoints`, `GET /v1/inAppPurchasePricePoints/{id}/equalizations`, `GET /v1/subscriptionPricePoints/{id}/equalizations`, `GET /v1/subscriptionPricePoints/{id}/adjustedEqualizations`, and their four `relationships` twins.
- Included relationships take `limit[<relationship>]` with a maximum of 50.

Sources: [Large Data Sets](https://developer.apple.com/documentation/appstoreconnectapi/large-data-sets), `PagedDocumentLinks` and `PagingInformation` schemas and `limit` parameters in the spec.

### Error format

Failed requests return a 4xx or 5xx status and an `ErrorResponse` body:

```json
{ "errors": [ { "status": "429", "code": "RATE_LIMIT_EXCEEDED", "title": "...", "detail": "..." } ] }
```

`status`, `code`, `title`, and `detail` are required on each error. `id`, `source` (a JSON pointer or a parameter name), `links`, and `meta` are optional. Apple says to branch on the HTTP status first, then on `code`. Our tools should pass `code`, `detail`, and `source` back to the agent, because `detail` usually names the bad field.

Sources: [Interpreting and Handling Errors](https://developer.apple.com/documentation/appstoreconnectapi/interpreting-and-handling-errors), `ErrorResponse` schema in the spec.

### Sparse fieldsets, include, filter, sort

The API is JSON:API-shaped. Every list endpoint uses the same query parameters:

- `fields[<type>]=a,b` returns only those attributes. For example, `fields[apps]=name,bundleId`.
- `include=rel1,rel2` puts related resources in `included[]`.
- `filter[<attr>]=v1,v2` filters results. Some filters are required. `GET /v1/reviewSubmissions` requires `filter[app]`, for example.
- `exists[<attr>]=true` filters on presence.
- `sort=attr` or `sort=-attr` sorts. Each endpoint lists its allowed sort keys.

Sparse fieldsets matter for us. Full resources are large, and trimming them saves agent context. Each tool should send a default `fields[...]` list.

Source: `GET /v1/apps` parameters in the spec, which every list endpoint mirrors.

### Responses that are not JSON:API

| Endpoint | Content type | Notes |
| --- | --- | --- |
| `GET /v1/salesReports` | `application/a-gzip` | Gzip of a tab-delimited text file |
| `GET /v1/financeReports` | `application/a-gzip` | Gzip of a tab-delimited text file |
| `GET /v1/apps/{id}/perfPowerMetrics`, `GET /v1/builds/{id}/perfPowerMetrics` | `application/vnd.apple.xcode-metrics+json` | JSON, not JSON:API |
| `GET /v1/apps/{id}/performanceOverviews` | `application/vnd.apple.xcode-overview+json` | JSON, not JSON:API |
| `GET /v1/diagnosticSignatures/{id}/logs` | `application/vnd.apple.diagnostic-logs+json` | JSON, not JSON:API |
| Analytics report segments | Signed `url` attribute | Files are `.txt.gz`, tab-delimited |

Each sales report type allows only some `reportSubType`, `frequency`, and `version` values. For example, `SALES` + `SUMMARY` + any frequency + `1_0`, or `SUBSCRIPTION` + `SUMMARY` + `DAILY` + `1_3`. Our tool should encode Apple's table as a lookup, not leave it to the agent.

Report tools must gunzip, parse the TSV, and return a capped number of rows or a summary. A raw monthly report can be large.

Sources: response content types in the spec, [Download sales and trends reports](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-salesreports), [Download and view reports (Help)](https://developer.apple.com/help/app-store-connect/view-sales-and-trends/download-and-view-reports/), [Analytics Reports API (Help)](https://developer.apple.com/help/app-store-connect-analytics/overview/analytics-reports-api/).

## 3. Where the OpenAPI spec lives

- URL: `https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`
- The zip holds one file, `openapi.oas.json`. It is OpenAPI 3.0.1.
- `info.version` is `4.5.1`. The file inside the zip is dated October 6, 2026.
- It has 1001 paths and 1303 operations. The server is `https://api.appstoreconnect.apple.com/`.
- The zip name has no version, so pin by `info.version` and commit a copy when we generate types.

Changes from release notes 4.0 through 4.5.1 that affect us:

- **4.0** added webhooks, beta feedback (crash and screenshot submissions), customer review summarizations, and accessibility declarations. It removed creating an App Store version submission. Use review submissions instead. The spec now has only `DELETE /v1/appStoreVersionSubmissions/{id}`.
- **4.1** added build uploads (`/v1/buildUploads`) and app tags, plus webhook events for build uploads and beta build state.
- **4.2** added Game Center items in review submissions, IAP offer codes, and Android-to-iOS app mapping. Alternative distribution webhook events arrived, and the older alternative distribution notifications were deprecated.
- **4.4.1** made IAPs, subscriptions, and subscription groups versioned. It deprecated v1 IAP and subscription localizations and images, plus the IAP and subscription submission resources. Use the v2 version-scoped endpoints and `reviewSubmissionItems`.
- **4.5** added `GET /v1/apps/{id}/performanceOverviews` and Game Center score moderation.
- **4.5.1** added the App Asset Library. It deprecated App Screenshot Sets, App Screenshots, App Preview Sets, App Previews, App Event Screenshots, and App Event Video Clips.

Apple's WWDC26 guide mentions a Retention Messaging API. It is not in this spec. Treat it as a separate API.

Sources: [OpenAPI spec zip](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip), [Release notes index](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-release-notes), [4.5.1](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes), [4.5](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-release-notes), [4.4.1](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-4-1-release-notes), [4.2](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-2-release-notes), [4.1](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-1-release-notes), [4.0](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-0-release-notes), [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store).

## 4. Tool catalog

How to read this table:

- **Kind** is `read`, `write`, or `destructive`. A `destructive` tool deletes something, changes access, or affects a release.
- **Tier 1** tools are read-only and ship first. **Tier 2** tools are safe writes. **Tier 3** tools are destructive or release-affecting. Hold Tier 3 back or put it behind an explicit opt-in.
- **Min role** comes from Apple's role matrix ([Roles](https://developer.apple.com/help/account/access/roles/)). The matrix has few "view" rows, so most read roles are inferred. Treat any role marked inferred as a guess until we test it with a real key.
- Each path below is one call unless the notes say otherwise.

### Apps and app info

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_apps` | `GET /v1/apps` | Any app-scoped role (inferred) | read | 1 |
| `get_app` | `GET /v1/apps/{id}` | Any app-scoped role (inferred) | read | 1 |
| `list_app_infos` | `GET /v1/apps/{id}/appInfos` | Developer (inferred) | read | 1 |
| `list_app_info_localizations` | `GET /v1/appInfos/{id}/appInfoLocalizations` | Developer (inferred) | read | 1 |
| `get_age_rating_declaration` | `GET /v1/appInfos/{id}/ageRatingDeclaration` | Developer (inferred) | read | 1 |
| `update_app_info_localization` (name, subtitle, privacy URLs) | `PATCH /v1/appInfoLocalizations/{id}` | Marketing | write | 2 |

### Builds

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_builds` | `GET /v1/builds` (use `filter[app]`) | Developer (inferred) | read | 1 |
| `get_build` | `GET /v1/builds/{id}` | Developer (inferred) | read | 1 |
| `list_pre_release_versions` | `GET /v1/preReleaseVersions` | Developer (inferred) | read | 1 |
| `list_build_uploads` | `GET /v1/apps/{id}/buildUploads` | Developer (inferred) | read | 1 |
| `set_build_encryption` (`usesNonExemptEncryption`) | `PATCH /v1/builds/{id}` | App Manager | write | 2 |
| `expire_build` (`expired: true`) | `PATCH /v1/builds/{id}` | App Manager | destructive | 3 |

### TestFlight

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_beta_groups` | `GET /v1/apps/{id}/betaGroups` | Developer (read-only in matrix) | read | 1 |
| `list_beta_testers` | `GET /v1/betaTesters` (`filter[apps]`, `filter[betaGroups]`) | Developer (inferred) | read | 1 |
| `list_build_beta_localizations` | `GET /v1/builds/{id}/betaBuildLocalizations` | Developer (inferred) | read | 1 |
| `get_build_beta_detail` | `GET /v1/builds/{id}/buildBetaDetail` | Developer (inferred) | read | 1 |
| `list_beta_feedback_screenshots` | `GET /v1/apps/{id}/betaFeedbackScreenshotSubmissions` | Developer (inferred) | read | 1 |
| `list_beta_feedback_crashes` | `GET /v1/apps/{id}/betaFeedbackCrashSubmissions` | Developer (inferred) | read | 1 |
| `get_beta_crash_log` | `GET /v1/betaFeedbackCrashSubmissions/{id}/crashLog` | Developer (inferred) | read | 1 |
| `get_beta_tester_usage` | `GET /v1/apps/{id}/metrics/betaTesterUsages` | Developer (inferred) | read | 1 |
| `create_beta_group` | `POST /v1/betaGroups` | Developer (internal), App Manager (external) | write | 2 |
| `add_beta_tester` (create and assign to groups) | `POST /v1/betaTesters` | Developer (internal), App Manager (external) | write | 2 |
| `add_testers_to_group` | `POST /v1/betaGroups/{id}/relationships/betaTesters` | Developer (internal), App Manager (external) | write | 2 |
| `remove_testers_from_group` | `DELETE /v1/betaGroups/{id}/relationships/betaTesters` | Developer (internal), App Manager (external) | write | 2 |
| `send_beta_invitation` | `POST /v1/betaTesterInvitations` | App Manager (inferred) | write | 2 |
| `set_what_to_test` (create) | `POST /v1/betaBuildLocalizations` | App Manager | write | 2 |
| `set_what_to_test` (update `whatsNew`) | `PATCH /v1/betaBuildLocalizations/{id}` | App Manager | write | 2 |
| `notify_beta_testers` | `POST /v1/buildBetaNotifications` | App Manager (inferred) | write | 2 |
| `add_build_to_groups` | `POST /v1/builds/{id}/relationships/betaGroups` | Developer (internal), App Manager (external) | write | 2 for internal groups, 3 for external |
| `submit_beta_app_review` | `POST /v1/betaAppReviewSubmissions` | App Manager | destructive | 3 |
| `delete_beta_tester` | `DELETE /v1/betaTesters/{id}` | App Manager (inferred) | destructive | 3 |
| `delete_beta_group` | `DELETE /v1/betaGroups/{id}` | App Manager (inferred) | destructive | 3 |

`add_build_to_groups` sends the build to real testers once it reaches an external group, so the tool should check the group's internal flag and gate external groups.

### App Store versions and localizations

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_app_store_versions` | `GET /v1/apps/{id}/appStoreVersions` | Developer (inferred) | read | 1 |
| `get_app_store_version` | `GET /v1/appStoreVersions/{id}` | Developer (inferred) | read | 1 |
| `get_version_build` | `GET /v1/appStoreVersions/{id}/build` | Developer (inferred) | read | 1 |
| `list_version_localizations` | `GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations` | Developer (inferred) | read | 1 |
| `get_review_detail` | `GET /v1/appStoreVersions/{id}/appStoreReviewDetail` | Developer (inferred) | read | 1 |
| `create_app_store_version` | `POST /v1/appStoreVersions` | Marketing | write | 2 |
| `update_app_store_version` (version string, copyright, release type) | `PATCH /v1/appStoreVersions/{id}` | Marketing | write | 2 |
| `select_build_for_version` | `PATCH /v1/appStoreVersions/{id}/relationships/build` | App Manager (inferred) | write | 2 |
| `create_version_localization` | `POST /v1/appStoreVersionLocalizations` | Marketing | write | 2 |
| `update_version_localization` (description, keywords, whatsNew, promotionalText, URLs) | `PATCH /v1/appStoreVersionLocalizations/{id}` | Marketing | write | 2 |
| `update_review_detail` (contact, demo account, notes) | `PATCH /v1/appStoreReviewDetails/{id}` | App Manager (inferred) | write | 2 |
| `delete_version_localization` | `DELETE /v1/appStoreVersionLocalizations/{id}` | Marketing | destructive | 3 |
| `delete_app_store_version` | `DELETE /v1/appStoreVersions/{id}` | App Manager (inferred) | destructive | 3 |

Which localization fields can change on a live version is unverified. Expect `409` errors when a field is locked, and pass `detail` back to the agent.

### Review submissions and phased release

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_review_submissions` | `GET /v1/reviewSubmissions` (requires `filter[app]`) | Developer (inferred) | read | 1 |
| `get_review_submission` | `GET /v1/reviewSubmissions/{id}` | Developer (inferred) | read | 1 |
| `list_review_submission_items` | `GET /v1/reviewSubmissions/{id}/items` | Developer (inferred) | read | 1 |
| `get_phased_release` | `GET /v1/appStoreVersions/{id}/appStoreVersionPhasedRelease` | Developer (inferred) | read | 1 |
| `submit_for_review` (multi-step) | `POST /v1/reviewSubmissions`, then `POST /v1/reviewSubmissionItems`, then `PATCH /v1/reviewSubmissions/{id}` with `submitted: true` | App Manager | destructive | 3 |
| `cancel_review_submission` | `PATCH /v1/reviewSubmissions/{id}` with `canceled: true` | App Manager | destructive | 3 |
| `remove_review_submission_item` | `DELETE /v1/reviewSubmissionItems/{id}` | App Manager | destructive | 3 |
| `release_version` (manual release after approval) | `POST /v1/appStoreVersionReleaseRequests` | App Manager (inferred) | destructive | 3 |
| `enable_phased_release` | `POST /v1/appStoreVersionPhasedReleases` | App Manager (inferred) | destructive | 3 |
| `set_phased_release_state` (`ACTIVE`, `PAUSED`, `COMPLETE`) | `PATCH /v1/appStoreVersionPhasedReleases/{id}` | App Manager (inferred) | destructive | 3 |
| `remove_phased_release` | `DELETE /v1/appStoreVersionPhasedReleases/{id}` | App Manager (inferred) | destructive | 3 |

A review submission item can point at an App Store version, custom product page version, experiment, in-app event, asset library image or video, background asset version, Game Center version, IAP version, subscription version, or subscription group version.

### Customer reviews and responses

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_customer_reviews` | `GET /v1/apps/{id}/customerReviews` (`filter[rating]`, `filter[territory]`, `exists[publishedResponse]`, `sort`) | Developer | read | 1 |
| `list_version_reviews` | `GET /v1/appStoreVersions/{id}/customerReviews` | Developer | read | 1 |
| `get_customer_review` | `GET /v1/customerReviews/{id}` | Developer | read | 1 |
| `get_review_response` | `GET /v1/customerReviews/{id}/response` | Developer | read | 1 |
| `get_review_summary` | `GET /v1/apps/{id}/customerReviewSummarizations` (requires `filter[platform]`) | Developer (inferred) | read | 1 |
| `reply_to_review` | `POST /v1/customerReviewResponses` | Admin or Customer Support | write | 2 |
| `delete_review_response` | `DELETE /v1/customerReviewResponses/{id}` | Admin or Customer Support (inferred) | destructive | 3 |

`POST /v1/customerReviewResponses` overwrites an existing response, and the reply shows publicly on the App Store after a delay. It is Tier 2 per our rubric, but the tool should show the agent the existing response first.

### In-app purchases and subscriptions

Use the v2 and version-scoped endpoints. The v1 localization, image, and submission resources are deprecated as of 4.4.1.

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_in_app_purchases` | `GET /v1/apps/{id}/inAppPurchasesV2` | Developer (inferred) | read | 1 |
| `get_in_app_purchase` | `GET /v2/inAppPurchases/{id}` | Developer (inferred) | read | 1 |
| `list_iap_versions` | `GET /v2/inAppPurchases/{id}/versions` | Developer (inferred) | read | 1 |
| `list_iap_version_localizations` | `GET /v1/inAppPurchaseVersions/{id}/localizations` | Developer (inferred) | read | 1 |
| `get_iap_price_schedule` | `GET /v2/inAppPurchases/{id}/iapPriceSchedule` | Developer (inferred) | read | 1 |
| `list_subscription_groups` | `GET /v1/apps/{id}/subscriptionGroups` | Developer (inferred) | read | 1 |
| `list_subscriptions` | `GET /v1/subscriptionGroups/{id}/subscriptions` | Developer (inferred) | read | 1 |
| `get_subscription` | `GET /v1/subscriptions/{id}` | Developer (inferred) | read | 1 |
| `list_subscription_prices` | `GET /v1/subscriptions/{id}/prices` | Developer (inferred) | read | 1 |
| `list_subscription_offers` | `GET /v1/subscriptions/{id}/introductoryOffers`, `GET /v1/subscriptions/{id}/promotionalOffers`, `GET /v1/subscriptions/{id}/offerCodes`, `GET /v1/subscriptions/{id}/winBackOffers` | Developer (inferred) | read | 1 |
| `create_in_app_purchase` | `POST /v2/inAppPurchases` | Developer | write | 2 |
| `create_iap_version` | `POST /v1/inAppPurchaseVersions` | App Manager (inferred) | write | 2 |
| `update_iap_localization` | `PATCH /v2/inAppPurchaseLocalizations/{id}` | App Manager | write | 2 |
| `create_subscription_version` | `POST /v1/subscriptionVersions` | App Manager (inferred) | write | 2 |
| `update_subscription_localization` | `PATCH /v2/subscriptionLocalizations/{id}` | App Manager | write | 2 |
| `set_subscription_price` | `POST /v1/subscriptionPrices` | App Manager | destructive | 3 |
| `create_subscription_offer_code` | `POST /v1/subscriptionOfferCodes` | App Manager (inferred) | destructive | 3 |
| `delete_in_app_purchase` | `DELETE /v2/inAppPurchases/{id}` | App Manager (inferred) | destructive | 3 |
| `delete_subscription` | `DELETE /v1/subscriptions/{id}` | App Manager (inferred) | destructive | 3 |

To submit an IAP or subscription, use `submit_for_review` with an `inAppPurchaseVersion`, `subscriptionVersion`, or `subscriptionGroupVersion` item.

### Pricing and availability

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `get_app_price_schedule` | `GET /v1/apps/{id}/appPriceSchedule` | Marketing (read-only in matrix) | read | 1 |
| `list_app_manual_prices` | `GET /v1/appPriceSchedules/{id}/manualPrices` | Marketing (read-only in matrix) | read | 1 |
| `list_app_price_points` | `GET /v1/apps/{id}/appPricePoints` | Marketing (read-only in matrix) | read | 1 |
| `get_app_availability` | `GET /v1/apps/{id}/appAvailabilityV2` | Marketing (read-only in matrix) | read | 1 |
| `list_territory_availabilities` | `GET /v2/appAvailabilities/{id}/territoryAvailabilities` | Marketing (read-only in matrix) | read | 1 |
| `list_territories` | `GET /v1/territories` | Any role (inferred) | read | 1 |
| `set_app_price_schedule` | `POST /v1/appPriceSchedules` | App Manager | destructive | 3 |
| `set_app_availability` | `POST /v2/appAvailabilities` | App Manager | destructive | 3 |
| `update_territory_availability` | `PATCH /v1/territoryAvailabilities/{id}` | App Manager | destructive | 3 |

### Users and access

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_users` | `GET /v1/users` | Any role (matrix: everyone can view Users and Access) | read | 1 |
| `list_user_visible_apps` | `GET /v1/users/{id}/visibleApps` | Any role | read | 1 |
| `list_user_invitations` | `GET /v1/userInvitations` | Any role | read | 1 |
| `list_sandbox_testers` | `GET /v2/sandboxTesters` | Developer | read | 1 |
| `clear_sandbox_purchase_history` | `POST /v2/sandboxTestersClearPurchaseHistoryRequest` | Developer | write | 2 |
| `invite_user` | `POST /v1/userInvitations` | Admin | destructive | 3 |
| `update_user_roles` | `PATCH /v1/users/{id}` | Admin | destructive | 3 |
| `remove_user` | `DELETE /v1/users/{id}` | Admin | destructive | 3 |
| `cancel_user_invitation` | `DELETE /v1/userInvitations/{id}` | Admin | destructive | 3 |

Any write in this group changes who can reach the customer's account, so even the invite counts as Tier 3.

### Sales and finance reports

Team keys only. These need the vendor number.

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `download_sales_report` | `GET /v1/salesReports` | Sales | read | 1 (second key) |
| `download_finance_report` | `GET /v1/financeReports` | Finance | read | 1 (second key) |

### Analytics Reports API

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_analytics_report_requests` | `GET /v1/apps/{id}/analyticsReportRequests` | Sales or Finance | read | 1 |
| `list_analytics_reports` | `GET /v1/analyticsReportRequests/{id}/reports` | Sales or Finance | read | 1 |
| `list_analytics_report_instances` | `GET /v1/analyticsReports/{id}/instances` | Sales or Finance | read | 1 |
| `list_analytics_report_segments` | `GET /v1/analyticsReportInstances/{id}/segments` | Sales or Finance | read | 1 |
| `request_analytics_reports` | `POST /v1/analyticsReportRequests` | Admin | write | 2 |
| `delete_analytics_report_request` | `DELETE /v1/analyticsReportRequests/{id}` | Admin | destructive | 3 |

This is a poor first-tier fit. The flow is request, wait 24 to 48 hours, list reports, list instances by `granularity` and `processingDate`, list segments, then download each signed URL and gunzip it. An agent cannot finish that in one session. A request also stops with `stoppedDueToInactivity` if nobody reads it for a long time. Only Admin can create the request, so an App Manager key cannot start it. If we want analytics, our platform should create one `ONGOING` request per app and expose a single "read latest report" tool on top.

Sources: [Analytics](https://developer.apple.com/documentation/appstoreconnectapi/analytics), [Downloading Analytics Reports](https://developer.apple.com/documentation/appstoreconnectapi/downloading-analytics-reports).

### Provisioning

Team keys only. Individual keys cannot call these. The matrix gates them behind "Certificates, Identifiers & Profiles" access, which is a separate user permission. Whether an App Manager team key gets that access is unverified. Admin is the safe assumption.

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_bundle_ids` | `GET /v1/bundleIds` | Admin (App Manager unverified) | read | 1 |
| `list_bundle_id_capabilities` | `GET /v1/bundleIds/{id}/bundleIdCapabilities` | Admin (App Manager unverified) | read | 1 |
| `list_certificates` | `GET /v1/certificates` | Admin (App Manager unverified) | read | 1 |
| `list_devices` | `GET /v1/devices` | Admin (App Manager unverified) | read | 1 |
| `list_profiles` | `GET /v1/profiles` | Admin (App Manager unverified) | read | 1 |
| `register_device` | `POST /v1/devices` | Admin (App Manager unverified) | write | 2 |
| `create_bundle_id` | `POST /v1/bundleIds` | Admin (App Manager unverified) | write | 2 |
| `create_profile` | `POST /v1/profiles` | Admin (App Manager unverified) | write | 2 |
| `create_certificate` (needs a CSR) | `POST /v1/certificates` | Admin (App Manager unverified) | destructive | 3 |
| `disable_device` | `PATCH /v1/devices/{id}` | Admin (App Manager unverified) | destructive | 3 |
| `revoke_certificate` | `DELETE /v1/certificates/{id}` | Admin (App Manager unverified) | destructive | 3 |
| `delete_profile` | `DELETE /v1/profiles/{id}` | Admin (App Manager unverified) | destructive | 3 |
| `delete_bundle_id` | `DELETE /v1/bundleIds/{id}` | Admin (App Manager unverified) | destructive | 3 |

`create_certificate` needs a CSR, and the private key for that CSR would have to live somewhere. That is a poor fit for a hosted agent tool.

### Xcode Cloud

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_ci_products` | `GET /v1/ciProducts` | Developer (read-only in matrix) | read | 1 |
| `list_ci_workflows` | `GET /v1/ciProducts/{id}/workflows` | Developer (read-only in matrix) | read | 1 |
| `get_ci_workflow` | `GET /v1/ciWorkflows/{id}` | Developer (read-only in matrix) | read | 1 |
| `list_ci_build_runs` | `GET /v1/ciProducts/{id}/buildRuns` or `GET /v1/ciWorkflows/{id}/buildRuns` | Developer (read-only in matrix) | read | 1 |
| `get_ci_build_run` | `GET /v1/ciBuildRuns/{id}` | Developer (read-only in matrix) | read | 1 |
| `list_ci_build_actions` | `GET /v1/ciBuildRuns/{id}/actions` | Developer (read-only in matrix) | read | 1 |
| `list_ci_issues` | `GET /v1/ciBuildActions/{id}/issues` | Developer (read-only in matrix) | read | 1 |
| `list_ci_test_results` | `GET /v1/ciBuildActions/{id}/testResults` | Developer (read-only in matrix) | read | 1 |
| `list_ci_artifacts` | `GET /v1/ciBuildActions/{id}/artifacts` | Developer (read-only in matrix) | read | 1 |
| `start_ci_build` | `POST /v1/ciBuildRuns` | App Manager | destructive | 3 |
| `update_ci_workflow` | `PATCH /v1/ciWorkflows/{id}` | App Manager | destructive | 3 |
| `delete_ci_workflow` | `DELETE /v1/ciWorkflows/{id}` | App Manager | destructive | 3 |

`start_ci_build` uses the customer's paid compute hours. A workflow's post-actions can also distribute to TestFlight, so treat it as release-affecting.

### Webhooks

Webhooks are per app. The event types are `APP_STORE_VERSION_APP_VERSION_STATE_UPDATED`, `BUILD_UPLOAD_STATE_UPDATED`, `BUILD_BETA_DETAIL_EXTERNAL_BUILD_STATE_UPDATED`, `BETA_FEEDBACK_CRASH_SUBMISSION_CREATED`, `BETA_FEEDBACK_SCREENSHOT_SUBMISSION_CREATED`, four background asset events, and three alternative distribution events. Creating a webhook requires `name`, `url`, `secret`, `eventTypes`, and `enabled`.

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_webhooks` | `GET /v1/apps/{id}/webhooks` | App Manager | read | 1 |
| `get_webhook` | `GET /v1/webhooks/{id}` | App Manager | read | 1 |
| `list_webhook_deliveries` | `GET /v1/webhooks/{id}/deliveries` | App Manager | read | 1 |
| `ping_webhook` | `POST /v1/webhookPings` | App Manager | write | 2 |
| `redeliver_webhook` | `POST /v1/webhookDeliveries` | App Manager | write | 2 |
| `create_webhook` | `POST /v1/webhooks` | App Manager | destructive | 3 |
| `update_webhook` | `PATCH /v1/webhooks/{id}` | App Manager | destructive | 3 |
| `delete_webhook` | `DELETE /v1/webhooks/{id}` | App Manager | destructive | 3 |

An agent that creates a webhook can point app events at any URL. Keep that Tier 3. A better future use is for our platform to register its own webhook. Then we can push review-state and TestFlight-feedback events to agents.

Sources: [Webhook notifications](https://developer.apple.com/documentation/appstoreconnectapi/webhook-notifications), `WebhookEventType` and `WebhookCreateRequest` in the spec.

### Power, performance, and diagnostics

All of these are read-only and return Apple's Xcode JSON formats, not JSON:API. The matrix gives every role "View crash and energy logs in Xcode Organizer".

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `get_app_perf_metrics` | `GET /v1/apps/{id}/perfPowerMetrics` (`filter[metricType]`) | Any role | read | 1 |
| `get_build_perf_metrics` | `GET /v1/builds/{id}/perfPowerMetrics` | Any role | read | 1 |
| `get_performance_overview` | `GET /v1/apps/{id}/performanceOverviews` | Any role | read | 1 |
| `list_diagnostic_signatures` | `GET /v1/builds/{id}/diagnosticSignatures` (`filter[diagnosticType]`) | Any role | read | 1 |
| `get_diagnostic_logs` | `GET /v1/diagnosticSignatures/{id}/logs` | Any role | read | 1 |

Source: [Power and Performance Metrics and Logs](https://developer.apple.com/documentation/appstoreconnectapi/power-and-performance-metrics-and-logs).

### Other notable resources

| Tool | Method and path | Min role | Kind | Tier |
| --- | --- | --- | --- | --- |
| `list_custom_product_pages` | `GET /v1/apps/{id}/appCustomProductPages` | Marketing (inferred) | read | 1 |
| `list_app_events` | `GET /v1/apps/{id}/appEvents` | Marketing (inferred) | read | 1 |
| `list_product_page_experiments` | `GET /v1/apps/{id}/appStoreVersionExperimentsV2` | Marketing (inferred) | read | 1 |
| `list_accessibility_declarations` | `GET /v1/apps/{id}/accessibilityDeclarations` | Developer | read | 1 |
| `get_asset_library` | `GET /v1/apps/{id}/assetLibrary` | Marketing (inferred) | read | 1 |
| `list_nominations` | `GET /v1/nominations` | Marketing (inferred) | read | 1 |
| `create_nomination` | `POST /v1/nominations` | Marketing | write | 2 |
| `list_search_keywords` | `GET /v1/apps/{id}/searchKeywords` | Developer (inferred) | read | unverified |

In the spec, `AppKeyword` resources have only an `id` and no attributes, so whether `list_search_keywords` is useful is unverified.

Game Center has 349 operations, alternative distribution has 23, and App Clips has 53. Leave all three out of the first catalog.

### Multi-step flows that do not fit Tier 1 or Tier 2

- **Asset uploads (screenshots, previews, review attachments, IAP images).** Apple's flow has four steps. First reserve the asset with a POST that gives the file name and byte size. Then PUT the bytes to the returned upload operations, sometimes in several parts. Then commit with a PATCH that sets `uploaded: true` and the file's MD5 `sourceFileChecksum`. Then poll until processing finishes. A reservation expires, and Apple says to finish within about a week. The agent has to send binary file bytes through MCP, and a crash halfway leaves half-made reservations. Also, 4.5.1 deprecated the screenshot and preview resources in favor of the App Asset Library (`POST /v1/appAssetLibraryImages`, `POST /v1/appAssetLibraryPlacements`), so a tool built on the old resources would start out deprecated. Source: [Uploading Assets to App Store Connect](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect).
- **Build uploads (`POST /v1/buildUploads`, `POST /v1/buildUploadFiles`).** Same reserve, upload, and commit shape, with large binaries.
- **Analytics reports.** Async over days. See above.
- **Review submission.** Three calls that must succeed together. If our tool fails partway, it leaves a draft submission. Make it one tool that can safely retry, and gate it.

## 5. Recommendations

### First 15 Tier 1 tools

All of these work with one App Manager team key, assuming App Manager can read what Developer and Marketing can (inferred):

1. `list_apps`
2. `get_app`
3. `list_builds`
4. `list_app_store_versions`
5. `list_version_localizations`
6. `list_review_submissions`
7. `list_review_submission_items`
8. `list_customer_reviews`
9. `get_review_summary`
10. `list_beta_groups`
11. `list_beta_testers`
12. `list_build_beta_localizations`
13. `list_beta_feedback_crashes`
14. `list_ci_build_runs`
15. `get_app_perf_metrics`

The next batch, for a second Sales or Finance key, is `download_sales_report` and `download_finance_report`. The first Tier 2 batch should be `reply_to_review` (needs Admin), `update_version_localization`, `set_what_to_test`, `add_beta_tester`, and `add_testers_to_group`.

### `asc_get(path, query)` is a good idea

The API shape makes a generic read tool cheap and useful:

- Every resource uses the same JSON:API envelope. Every list takes the same `filter`, `fields`, `include`, `limit`, and `sort` parameters.
- `links.next` is a full URL, so paging needs no per-endpoint logic.
- The spec has 1001 paths. Named tools will never cover them all, and the long tail is mostly reads.

Put four guards on it:

1. **Allow only GET.** Never accept a method argument.
2. **Check the path against the spec's path list.** Match `{id}` segments. This rejects typos before they spend rate-limit budget.
3. **Mint a scoped token for each call.** Set `scope: ["GET <path>?<query>"]` in the JWT. ASC then rejects any request that does not match, so the tool stays read-only on Apple's side even if our code has a bug. `limit`, `cursor`, and `sort` are ignored when ASC matches scope, so paging still works with the same token. Signing one ES256 token per call is cheap.
4. **Handle content types that are not JSON:API.** Gunzip reports and parse the TSV. Return Xcode metrics JSON as is. Cap the response size, and default `fields[...]` where the agent gave none.

The tradeoff is that the agent must know ASC paths and resource types. Named Tier 1 tools teach it the common ones. `asc_get` covers the rest.

### Checks to run once we have a real key

- Which roles the team-key form offers, and whether it allows more than one.
- Whether `CUSTOMER_SUPPORT` works on a team key and can call `POST /v1/customerReviewResponses`.
- Whether an App Manager team key can read provisioning resources.
- Whether a Sales-only key can call `GET /v1/apps?limit=1` for validation.
- The real `user-hour-lim` value we see.

## How this doc was checked

- Spec facts come from `openapi.oas.json` 4.5.1, downloaded from the zip URL above on 2026-11-01.
- Every `METHOD /vN/...` string in this doc was extracted by script and matched against the spec's operations.
- Role cells come from the HTML of Apple's [Roles](https://developer.apple.com/help/account/access/roles/) page. The script read the checkmark icon classes and the footnotes that explain them.
