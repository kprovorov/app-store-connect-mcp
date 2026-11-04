import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";

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
    body: "Paste one URL into Claude, ChatGPT, Codex, Cursor, VS Code, or any client that supports remote MCP servers. The first call opens a browser so you can sign in.",
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

// The app lives on another origin, so the landing can't see the Clerk session.
// Signed-in users who click "Sign in" are sent straight to the dashboard by Clerk.
const signInUrl = `${env.appUrl}/sign-in`;
const signUpUrl = `${env.appUrl}/sign-up`;

function HeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" className="hidden sm:inline-flex">
        <a href={signInUrl}>Sign in</a>
      </Button>
      <Button asChild>
        <a href={signUpUrl}>Get started</a>
      </Button>
    </div>
  );
}

function HeroActions() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild size="lg" className="px-4">
        <a href={signUpUrl}>Get started</a>
      </Button>
      <Button asChild size="lg" variant="outline" className="px-4">
        <a href={signInUrl}>Sign in</a>
      </Button>
    </div>
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
              A hosted MCP server for App Store Connect. Add your API key once, and Claude, ChatGPT, Codex, Cursor, or
              any MCP client can check builds, answer reviews, run TestFlight, and edit your store listing.
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href="https://github.com/kprovorov/app-store-connect-mcp"
              className="rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              GitHub
            </a>
            <span>Not affiliated with Apple.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
