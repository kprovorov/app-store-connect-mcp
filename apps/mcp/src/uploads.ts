import { createHash } from "node:crypto";
import type { AscRequest, AscResponse, AscRequestError } from "@asc-mcp/asc";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { AssetError, fileBytes, transferBytes, type FileSource } from "./assets";
import { operationRequest, operationsById } from "./operations";

export interface UploadContext {
  request(request: AscRequest): Effect.Effect<AscResponse, AscRequestError>;
  fetch?: typeof fetch;
}
const string = { type: "string", minLength: 1, pattern: "^(?!\\.{1,2}$)" };
const sourceProperties = {
  file_name: { ...string, maxLength: 255 },
  content_base64: { type: "string", maxLength: 2796204, description: "Canonical base64, at most 2 MiB decoded. Pass exactly one file source." },
  source_url: { type: "string", maxLength: 8192, description: "Public HTTPS URL without redirects, at most 20 MiB. DNS is pinned and private addresses are refused." },
};
const connection = { connection_id: string };
export const uploadDefinitions: Tool[] = [
  {
    name: "upload_asset",
    description: "Transfer bytes to an existing Apple asset reservation. Select its GET-by-id Apple operation with discover on the compact root. This tool fetches and verifies Apple's upload operations, then sends raw bytes without API credentials. It does not commit. Commit afterward through the generated PATCH operation, using its resource-specific checksum fields. No arbitrary upload destination is accepted.",
    inputSchema: { type: "object", properties: { ...connection, ...sourceProperties, operation: string, resource_id: string }, required: ["operation", "resource_id", "file_name"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "upload_screenshot",
    description: "Upload an App Store screenshot through Apple's current asset library, commit it, verify processing, and place it in a version localization/device group. Supply app_id, localization_id, placement_group and file_name plus exactly one source. To resume processing/placement, pass image_id instead of file fields. Returns IDs and pending/failed state; existing placements are preserved. Discover valid placement groups with the appAssetLibraryRefData generated operation. Reorder afterward with appAssetLibraryPlacementOrderingRequests_createInstance.",
    inputSchema: { type: "object", properties: { ...connection, ...sourceProperties, app_id: string, localization_id: string, placement_group: string, image_id: string, wait_seconds: { type: "integer", minimum: 0, maximum: 30 } }, required: ["app_id", "localization_id", "placement_group"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Apple returned an invalid resource");
  return value as Record<string, unknown>;
};
const json = (response: AscResponse) => {
  if (response.body.kind !== "json") throw new AssetError({ message: "Apple returned a non-JSON asset resource" });
  return object(response.body.value);
};
const data = (response: AscResponse) => object(json(response).data);
const relationshipId = (resource: Record<string, unknown>, relationship: string) => {
  const id = object(object(object(resource.relationships)[relationship]).data).id;
  if (typeof id !== "string") throw new Error(`Missing ${relationship} id`);
  return id;
};
const idPath = (id: unknown) => {
  if (typeof id !== "string" || !id || id === "." || id === "..") throw new AssetError({ message: "Invalid resource id" });
  return encodeURIComponent(id);
};
const checked = <A>(run: () => A) => Effect.try({ try: run, catch: (error) => new AssetError({ message: error instanceof Error ? error.message : "Invalid Apple asset response" }) });
const asyncAsset = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (error) => new AssetError({ message: error instanceof Error ? error.message : "Asset transfer failed" }) });

const uploadFailure = (error: AscRequestError | AssetError) => {
  switch (error._tag) {
    case "AscApiError":
      return { message: error.errors[0]?.detail ?? `Apple returned HTTP ${error.status}`, details: { status: error.status, errors: error.errors, rateLimit: error.rateLimit } };
    case "AscRateLimited":
      return { message: "Apple's API quota is exhausted. Retry after the indicated delay.", details: { error: error._tag, retryAfterSeconds: error.retryAfterSeconds, rateLimit: error.rateLimit } };
    case "AscNetworkError":
      return { message: "Could not reach App Store Connect. Retry the failed stage.", details: { error: error._tag } };
    case "AssetError":
      return { message: error.message, details: error.details };
    default:
      return { message: error.message || "Screenshot upload failed", details: { error: error._tag } };
  }
};

export const uploadAsset = (args: Record<string, unknown>, context: UploadContext) => Effect.gen(function* () {
  const operation = operationsById.get(String(args.operation));
  if (!operation || operation.method !== "GET" || !/^\/v[1-9]\/[^/]+\/\{id\}$/.test(operation.path)) return yield* new AssetError({ message: "operation must be a catalog GET-by-id operation" });
  const bytes = yield* asyncAsset(() => fileBytes(args as unknown as FileSource));
  const request = yield* checked(() => operationRequest(operation, { path: { id: args.resource_id } }));
  const reservation = yield* context.request(request);
  const body = yield* checked(() => json(reservation));
  const transferred = yield* asyncAsset(() => transferBytes(body, bytes, context.fetch));
  return { state: "uploaded", resource_id: args.resource_id, ...transferred, md5: createHash("md5").update(bytes).digest("hex"), sha256: createHash("sha256").update(bytes).digest("hex"), next: "Commit the reservation through its generated PATCH operation. The required checksum fields depend on the asset resource." };
});

export const uploadScreenshot = (args: Record<string, unknown>, context: UploadContext) => {
  let imageId = typeof args.image_id === "string" ? args.image_id : undefined;
  let stage = "validate";
  return Effect.gen(function* () {
    const resuming = imageId !== undefined;
    if (resuming && ["file_name", "content_base64", "source_url"].some((key) => args[key] !== undefined)) return yield* new AssetError({ message: "Resume with image_id alone, without file fields" });
    const bytes = resuming ? undefined : yield* asyncAsset(() => fileBytes(args as unknown as FileSource));
    stage = "ownership";
    const localization = yield* context.request({ method: "GET", path: `/v1/appStoreVersionLocalizations/${idPath(args.localization_id)}`, query: { include: "appStoreVersion" }, scoped: true });
    const versionId = yield* checked(() => relationshipId(data(localization), "appStoreVersion"));
    const version = yield* context.request({ method: "GET", path: `/v1/appStoreVersions/${idPath(versionId)}`, query: { include: "app" }, scoped: true });
    const appId = yield* checked(() => relationshipId(data(version), "app"));
    if (appId !== args.app_id) return yield* new AssetError({ message: "The localization does not belong to app_id" });
    const library = yield* context.request({ method: "GET", path: `/v1/apps/${idPath(appId)}/assetLibrary`, scoped: true });
    const libraryId = yield* checked(() => String(data(library).id));
    let image: Record<string, unknown>;
    if (resuming) {
      const found = yield* context.request({ method: "GET", path: `/v1/appAssetLibraries/${idPath(libraryId)}/images`, query: { "filter[id]": imageId!, limit: 1 }, scoped: true });
      const images = (yield* checked(() => json(found))).data;
      if (!Array.isArray(images) || !images.some((entry) => object(entry).id === imageId)) return yield* new AssetError({ message: "image_id does not belong to this app's asset library" });
      const refreshed = yield* context.request({ method: "GET", path: `/v1/appAssetLibraryImages/${idPath(imageId)}`, scoped: true });
      image = yield* checked(() => data(refreshed));
    } else {
      stage = "reserve";
      const reservation = yield* context.request({ method: "POST", path: "/v1/appAssetLibraryImages", body: { data: { type: "appAssetLibraryImages", attributes: { fileName: args.file_name, fileSize: bytes!.length, category: "APP_SCREENSHOTS_AND_PREVIEWS" }, relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: libraryId } } } } } });
      image = yield* checked(() => data(reservation));
      imageId = String(image.id);
      stage = "transfer";
      yield* asyncAsset(() => transferBytes(json(reservation), bytes!, context.fetch));
      stage = "commit";
      const committed = yield* context.request({ method: "PATCH", path: `/v1/appAssetLibraryImages/${idPath(imageId)}`, body: { data: { type: "appAssetLibraryImages", id: imageId, attributes: { uploaded: true } } } });
      image = yield* checked(() => data(committed));
    }
    stage = "processing";
    const deadline = Date.now() + Number(args.wait_seconds ?? 0) * 1000;
    let state = yield* checked(() => String(object(image.attributes).state));
    while (state === "UPLOAD_COMPLETE" && Date.now() < deadline) {
      yield* Effect.sleep("1 second");
      const refreshed = yield* context.request({ method: "GET", path: `/v1/appAssetLibraryImages/${idPath(imageId)}`, scoped: true });
      image = yield* checked(() => data(refreshed));
      state = yield* checked(() => String(object(image.attributes).state));
    }
    if (state === "AWAITING_UPLOAD") {
      stage = "commit";
      return yield* new AssetError({
        message: "The image is not committed. Finish any failed transfer with upload_asset, then call appAssetLibraryImages_updateInstance with uploaded: true. Resume upload_screenshot after the commit succeeds, or create a new reservation.",
        details: { apple_state: state, operation: "appAssetLibraryImages_updateInstance", path: { id: imageId }, body: { data: { type: "appAssetLibraryImages", id: imageId, attributes: { uploaded: true } } } },
      });
    }
    if (state === "UPLOAD_COMPLETE") return { state: "processing", image_id: imageId, apple_state: state, next: "Call upload_screenshot with image_id and the same target, without file fields." };
    if (!["PREPARE_FOR_SUBMISSION", "COMPLETE", "READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "ACCEPTED", "APPROVED"].includes(state)) return yield* new AssetError({ message: `Apple image processing state is ${state}`, details: image.attributes });
    stage = "placement";
    const existing = yield* context.request({ method: "GET", path: `/v1/appStoreVersionLocalizations/${idPath(args.localization_id)}/placements`, query: { "filter[placementType]": "APP_SCREENSHOT", "filter[placementGroup]": String(args.placement_group), include: "image", limit: 200 }, scoped: true });
    const placements = (yield* checked(() => json(existing))).data;
    if (!Array.isArray(placements)) return yield* new AssetError({ message: "Apple returned invalid placements" });
    const prior = placements.find((value) => {
      try { return relationshipId(object(value), "image") === imageId; } catch { return false; }
    });
    if (prior) return { state: "placed", image_id: imageId, placement_id: object(prior).id, reused: true };
    const placement = yield* context.request({ method: "POST", path: "/v1/appAssetLibraryPlacements", body: { data: { type: "appAssetLibraryPlacements", attributes: { placementType: "APP_SCREENSHOT", placementGroup: args.placement_group }, relationships: { image: { data: { type: "appAssetLibraryImages", id: imageId } }, appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: args.localization_id } } } } } });
    const placed = yield* checked(() => data(placement));
    return { state: "placed", image_id: imageId, placement_id: placed.id };
  }).pipe(Effect.catch((error) => Effect.fail(new AssetError({ ...uploadFailure(error), stage, image_id: imageId }))));
};
