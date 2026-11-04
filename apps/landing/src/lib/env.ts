function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Add it to apps/landing/.env.local.`);
  return value;
}

// Next inlines `NEXT_PUBLIC_*` only when each one is referenced by its literal name.
export const env = {
  appUrl: required("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL),
};
