"use client";

import { useAuth } from "@clerk/nextjs";
import type { Connection } from "@asc-mcp/contracts";
import { KeyRoundIcon, RotateCwIcon, ShieldCheckIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AddKeyDialog } from "@/components/dashboard/add-key-dialog";
import { verifyFailureCopy } from "@/components/dashboard/key-errors";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConnections, useDeleteConnection, useVerifyConnection } from "@/hooks/use-connections";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

function formatRelative(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const shorten = (value: string) => (value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value);

function VerifyButton({ connection }: { connection: Connection }) {
  const verify = useVerifyConnection();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={verify.isPending}
      onClick={() =>
        verify.mutate(connection.id, {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success(`“${connection.name}” works`, { description: "Apple accepted the key." });
            } else {
              const copy = verifyFailureCopy[result.reason];
              toast.error(copy.title, { description: `${copy.description} Apple said: ${result.detail}` });
            }
          },
          onError: (error) => toast.error(`Couldn't verify “${connection.name}”`, { description: error.message }),
        })
      }
    >
      <ShieldCheckIcon data-icon="inline-start" />
      {verify.isPending ? "Verifying…" : "Verify"}
    </Button>
  );
}

function DeleteButton({ connection }: { connection: Connection }) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteConnection();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${connection.name}`} onClick={() => setOpen(true)}>
        <Trash2Icon />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{connection.name}”?</DialogTitle>
          <DialogDescription>
            Agents lose access through this key right away. The key itself stays valid in App Store Connect, so revoke
            it there if nothing else uses it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(connection.id, {
                onSuccess: () => {
                  setOpen(false);
                  toast.success(`Deleted “${connection.name}”`);
                },
                onError: (error) => toast.error("Couldn't delete the key", { description: error.message }),
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionsTable({ connections, isAdmin }: { connections: ReadonlyArray<Connection>; isAdmin: boolean }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            <TableHead className="hidden sm:table-cell">Key ID</TableHead>
            <TableHead className="hidden md:table-cell">Issuer ID</TableHead>
            <TableHead className="hidden sm:table-cell">Last verified</TableHead>
            {isAdmin && (
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.map((connection) => (
            <TableRow key={connection.id}>
              <TableCell className="py-3 pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{connection.name}</span>
                  <Badge variant={connection.keyKind === "team" ? "secondary" : "outline"}>
                    {connection.keyKind === "team" ? "Team" : "Individual"}
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground sm:hidden">{connection.keyId}</div>
              </TableCell>
              <TableCell className="hidden font-mono text-xs sm:table-cell">{connection.keyId}</TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                {connection.issuerId ? <span title={connection.issuerId}>{shorten(connection.issuerId)}</span> : "None"}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {connection.lastVerifiedAt ? (
                  <time dateTime={connection.lastVerifiedAt} title={new Date(connection.lastVerifiedAt).toLocaleString()}>
                    {formatRelative(connection.lastVerifiedAt)}
                  </time>
                ) : (
                  "Never"
                )}
              </TableCell>
              {isAdmin && (
                <TableCell className="pr-3">
                  <div className="flex justify-end gap-1">
                    <VerifyButton connection={connection} />
                    <DeleteButton connection={connection} />
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y rounded-lg border" aria-busy aria-label="Loading keys">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
      <KeyRoundIcon className="size-6 text-muted-foreground" />
      <h3 className="mt-3 font-medium">No keys yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Add an App Store Connect API key so agents in this organization can reach your apps."
          : "An admin of this organization needs to add an App Store Connect API key first."}
      </p>
      {isAdmin && (
        <div className="mt-5">
          <AddKeyDialog />
        </div>
      )}
    </div>
  );
}

export function ConnectionsSection() {
  const { has } = useAuth();
  const isAdmin = has?.({ role: "org:admin" }) ?? false;
  const connections = useConnections();

  return (
    <section aria-labelledby="keys" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="keys" className="text-lg font-semibold tracking-tight">
            App Store Connect keys
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Every member's agent can use the keys in this organization."
              : "Every member's agent can use these keys. Only org admins can add or remove them."}
          </p>
        </div>
        {isAdmin && connections.data && connections.data.length > 0 && <AddKeyDialog />}
      </div>

      {connections.isError ? (
        <Alert variant="destructive" className="pr-24">
          <TriangleAlertIcon />
          <AlertTitle>Couldn&apos;t load keys</AlertTitle>
          <AlertDescription>{connections.error.message}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void connections.refetch()} disabled={connections.isFetching}>
              <RotateCwIcon data-icon="inline-start" />
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : connections.data === undefined ? (
        <LoadingRows />
      ) : connections.data.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : (
        <ConnectionsTable connections={connections.data} isAdmin={isAdmin} />
      )}
    </section>
  );
}
