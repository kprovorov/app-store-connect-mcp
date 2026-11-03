import {
  ApiError,
  ConnectionResponse,
  ListConnectionsResponse,
  VerifyConnectionResponse,
  routes,
  type ApiErrorCode,
  type Connection,
  type CreateConnectionRequest,
  type VerifyFailureReason,
} from "@asc-mcp/contracts";
import { Schema } from "effect";

import { env } from "@/lib/env";

export type ApiFailureCode = ApiErrorCode | "unreachable" | "bad_response";

export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  readonly code: ApiFailureCode;
  readonly status: number;
  readonly field: string | undefined;
  readonly reason: VerifyFailureReason | undefined;

  constructor(init: {
    code: ApiFailureCode;
    status: number;
    message: string;
    field?: string | undefined;
    reason?: VerifyFailureReason | undefined;
  }) {
    super(init.message);
    this.code = init.code;
    this.status = init.status;
    this.field = init.field;
    this.reason = init.reason;
  }
}

type GetToken = () => Promise<string | null>;

const decodeApiError = Schema.decodeUnknownPromise(ApiError);
const decodeList = Schema.decodeUnknownPromise(ListConnectionsResponse);
const decodeConnection = Schema.decodeUnknownPromise(ConnectionResponse);
const decodeVerify = Schema.decodeUnknownPromise(VerifyConnectionResponse);

async function send(getToken: GetToken, method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
  const token = await getToken();
  if (!token) {
    throw new ApiRequestError({ code: "unauthenticated", status: 0, message: "You are signed out." });
  }

  let response: Response;
  try {
    response = await fetch(new URL(path, env.apiUrl), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError({
      code: "unreachable",
      status: 0,
      message: `Can't reach the api at ${env.apiUrl}.`,
    });
  }

  if (response.ok) return response;

  const { error } = await response
    .json()
    .then(decodeApiError)
    .catch(() => {
      throw new ApiRequestError({
        code: "bad_response",
        status: response.status,
        message: `The api answered ${response.status} with an unexpected body.`,
      });
    });
  throw new ApiRequestError({ status: response.status, ...error });
}

async function receive<T>(getToken: GetToken, decode: (input: unknown) => Promise<T>, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await send(getToken, method, path, body);
  return response
    .json()
    .then(decode)
    .catch(() => {
      throw new ApiRequestError({
        code: "bad_response",
        status: response.status,
        message: "The api answered with a body that doesn't match the contract.",
      });
    });
}

export function createApiClient(getToken: GetToken) {
  return {
    listConnections: async (): Promise<ReadonlyArray<Connection>> =>
      (await receive(getToken, decodeList, "GET", routes.connections)).connections,

    createConnection: async (request: CreateConnectionRequest): Promise<Connection> =>
      (await receive(getToken, decodeConnection, "POST", routes.connections, request)).connection,

    verifyConnection: (id: string): Promise<VerifyConnectionResponse> =>
      receive(getToken, decodeVerify, "POST", routes.verifyConnection(id)),

    deleteConnection: async (id: string): Promise<void> => {
      await send(getToken, "DELETE", routes.connection(id));
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
