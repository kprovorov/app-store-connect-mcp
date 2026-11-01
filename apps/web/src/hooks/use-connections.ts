"use client";

import { useAuth } from "@clerk/nextjs";
import type { CreateConnectionRequest } from "@asc-mcp/contracts";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { createApiClient, type ApiClient } from "@/lib/api";

const connectionsKey = (orgId: string) => ["connections", orgId] as const;

function useOrgApi() {
  const { orgId, getToken } = useAuth();
  return useMemo(
    () => (orgId ? { orgId, api: createApiClient(() => getToken({ organizationId: orgId })) } : null),
    [orgId, getToken],
  );
}

export function useConnections() {
  const scope = useOrgApi();
  return useQuery({
    queryKey: connectionsKey(scope?.orgId ?? ""),
    queryFn: scope ? () => scope.api.listConnections() : skipToken,
  });
}

function useConnectionMutation<TVariables, TResult>(run: (api: ApiClient, variables: TVariables) => Promise<TResult>) {
  const scope = useOrgApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => {
      if (!scope) throw new Error("No active organization.");
      return run(scope.api, variables);
    },
    onSuccess: () => (scope ? queryClient.invalidateQueries({ queryKey: connectionsKey(scope.orgId) }) : undefined),
  });
}

export const useCreateConnection = () =>
  useConnectionMutation((api, request: CreateConnectionRequest) => api.createConnection(request));

export const useVerifyConnection = () => useConnectionMutation((api, id: string) => api.verifyConnection(id));

export const useDeleteConnection = () => useConnectionMutation((api, id: string) => api.deleteConnection(id));
