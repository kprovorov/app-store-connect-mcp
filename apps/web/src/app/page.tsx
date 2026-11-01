import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const steps = [
  {
    title: "Sign up and create an organization",
    body: "Keys belong to an organization, so your teammates can share them and you can keep clients apart.",
  },
  {
    title: "Add an App Store Connect API key",
    body: "Create a team key in App Store Connect and upload the .p8 file. We check it against Apple before saving and store it encrypted.",
  },
  {
    title: "Add the MCP URL to your agent",
    body: "Paste one URL into Claude Code, Cursor, VS Code, or Claude.ai. The first call opens a browser so you can sign in.",
  },
];

const capabilities = [
  {
    title: "Builds",
    prompt: "Is build 318 done processing?",
    tools: ["list_builds", "get_app"],
  },
  {
    title: "Customer reviews",
    prompt: "Summarize this week's one-star reviews and draft replies.",
    tools: ["list_customer_reviews", "reply_to_review"],
  },
  {
    title: "TestFlight",
    prompt: "Add these five people to the beta group and set what to test.",
    tools: ["list_beta_groups", "add_beta_tester", "set_what_to_test"],
  },
  {
    title: "Version metadata",
    prompt: "Update the release notes for 2.4 in every language.",
    tools: ["list_version_localizations", "update_version_localization"],
  },
];

function HeaderActions() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-28" />}>
      <Show when="signed-out">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </Show>
      <Show when="signed-in">
        <Button asChild>
          <Link href="/dashboard">Open dashboard</Link>
        </Button>
      </Show>
    </Suspense>
  );
}

function HeroActions() {
  return (
    <Suspense fallback={<Skeleton className="h-9 w-40" />}>
      <Show when="signed-out">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="px-4">
            <Link href="/sign-up">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-4">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </Show>
      <Show when="signed-in">
        <Button asChild size="lg" className="px-4">
          <Link href="/dashboard">Open dashboard</Link>
        </Button>
      </Show>
    </Suspense>
  );
}

function Transcript() {
  return (
    <figure
      aria-label="Example conversation with an agent"
      className="rounded-xl border bg-muted/40 p-4 text-sm shadow-xs sm:p-5"
    >
      <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-foreground px-3 py-2 text-background">
        Which build of Pocket Ledger is still processing, and who hasn&apos;t installed the last beta?
      </p>
      <div className="mt-4 space-y-1.5 font-mono text-xs text-muted-foreground">
        <p>
          <span className="text-foreground">list_builds</span> app=&quot;Pocket Ledger&quot; limit=3
        </p>
        <p>
          <span className="text-foreground">list_beta_testers</span> group=&quot;Friends &amp; family&quot;
        </p>
      </div>
      <p className="mt-4 max-w-[90%] leading-relaxed">
        Build 2.4 (318) is still processing. It was uploaded 12 minutes ago. Three of the twelve testers in Friends
        &amp; family haven&apos;t installed 2.3 (311): Maya, Jon, and Priya.
      </p>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Brand />
        <HeaderActions />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6">
        <section className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Let your AI agent work in App Store Connect.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">
              A hosted MCP server for App Store Connect. Add your API key once, and Claude Code, Cursor, VS Code, or
              Claude.ai can check builds, answer reviews, run TestFlight, and edit your store listing.
            </p>
            <div className="mt-8">
              <HeroActions />
            </div>
          </div>
          <Transcript />
        </section>

        <section aria-labelledby="how" className="border-t py-14 sm:py-16">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">
            Set up in three steps
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="grid size-7 place-items-center rounded-full border text-sm font-medium tabular-nums">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-medium">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="can-do" className="border-t py-14 sm:py-16">
          <h2 id="can-do" className="text-2xl font-semibold tracking-tight">
            What your agent can do
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Ask in plain language. The agent picks the tools. These are a few of them.
          </p>
          <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <div key={capability.title} className="border-l-2 pl-4">
                <dt className="font-medium">{capability.title}</dt>
                <dd className="mt-1 text-muted-foreground">&ldquo;{capability.prompt}&rdquo;</dd>
                <dd className="mt-3 flex flex-wrap gap-1.5">
                  {capability.tools.map((tool) => (
                    <code key={tool} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {tool}
                    </code>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
            What the agent may do follows the role of your key. An App Manager key covers builds, TestFlight, and
            metadata. Replying to reviews needs an Admin key, and sales reports need a Sales or Finance key.
          </p>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>App Store Connect MCP</span>
          <span>Not affiliated with Apple.</span>
        </div>
      </footer>
    </div>
  );
}
