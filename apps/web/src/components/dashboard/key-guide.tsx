"use client";

import { ChevronRightIcon } from "lucide-react";
import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";

function Ui({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

export function KeyGuide() {
  return (
    <Collapsible.Root className="rounded-lg border">
      <Collapsible.Trigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        How to create a key
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-3 border-t px-3 py-3 text-sm text-muted-foreground">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            In App Store Connect, go to <Ui>Users and Access</Ui>, then <Ui>Integrations</Ui>,{" "}
            <Ui>App Store Connect API</Ui>, <Ui>Team Keys</Ui>. You need the Account Holder or Admin role.
          </li>
          <li>
            Click <Ui>Generate API Key</Ui> (or <Ui>+</Ui>), name it after this app, and pick the{" "}
            <Ui>App Manager</Ui> role. It covers apps, builds, TestFlight, metadata, and reading reviews.
          </li>
          <li>
            Copy the <Ui>Issuer ID</Ui> from the top of the page and the <Ui>Key ID</Ui> from the key&apos;s row.
          </li>
          <li>
            Download the <Ui>.p8</Ui> file. Apple lets you download it only once. If you lose it, revoke the key and make
            a new one.
          </li>
        </ol>
        <p>
          For sales and finance reports, add a second team key with the <Ui>Sales</Ui> or <Ui>Finance</Ui> role.
          Replying to reviews needs <Ui>Admin</Ui>. Use a key just for this, since Apple&apos;s rate limit is per key.
        </p>
        <p>
          An individual key (your name at the top right, then <Ui>Edit Profile</Ui>, <Ui>Individual API Key</Ui>) is
          limited to your own apps and roles, and can&apos;t read sales reports. If there is no way to generate a key,
          the Account Holder must first click <Ui>Request Access</Ui> under <Ui>Integrations</Ui>.
        </p>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
