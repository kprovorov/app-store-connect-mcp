function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Add it to apps/web/.env.local.`);
  return value;
}

// Next inlines `NEXT_PUBLIC_*` only when each one is referenced by its literal name.
export const env = {
  apiUrl: required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL),
  mcpUrl: required("NEXT_PUBLIC_MCP_URL", process.env.NEXT_PUBLIC_MCP_URL),
};
