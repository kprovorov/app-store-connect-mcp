import type { ReactNode } from "react";

import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { env } from "@/lib/env";

const serverName = "app-store-connect";

type AgentClient = { id: string; label: string; instructions: ReactNode; snippet?: string };

const json = (value: unknown) => JSON.stringify(value, null, 2);

const clients: ReadonlyArray<AgentClient> = [
  {
    id: "claude-code",
    label: "Claude Code",
    instructions: "Run this in your terminal.",
    snippet: `claude mcp add --transport http ${serverName} ${env.mcpUrl}`,
  },
  {
    id: "cursor",
    label: "Cursor",
    instructions: (
      <>
        Add this to <Code>~/.cursor/mcp.json</Code> for every project, or <Code>.cursor/mcp.json</Code> for one.
      </>
    ),
    snippet: json({ mcpServers: { [serverName]: { url: env.mcpUrl } } }),
  },
  {
    id: "vscode",
    label: "VS Code",
    instructions: (
      <>
        Add this to <Code>.vscode/mcp.json</Code> in your workspace.
      </>
    ),
    snippet: json({ servers: { [serverName]: { type: "http", url: env.mcpUrl } } }),
  },
  {
    id: "claude-ai",
    label: "Claude.ai",
    instructions: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          In Claude.ai or Claude Desktop, open <strong className="font-medium">Settings</strong> and then{" "}
          <strong className="font-medium">Connectors</strong>.
        </li>
        <li>
          Click <strong className="font-medium">Add custom connector</strong>.
        </li>
        <li>Paste the MCP URL above and save.</li>
      </ol>
    ),
  },
];

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

function Snippet({ value }: { value: string }) {
  return (
    <div className="flex items-start rounded-lg border bg-muted/40">
      <pre className="min-w-0 flex-1 overflow-x-auto p-3 font-mono text-xs leading-relaxed">{value}</pre>
      <div className="p-1.5">
        <CopyButton value={value} label="Copy snippet" />
      </div>
    </div>
  );
}

export function ConnectAgentSection() {
  return (
    <section aria-labelledby="connect-agent" className="space-y-5">
      <div>
        <h2 id="connect-agent" className="text-lg font-semibold tracking-tight">
          Connect your agent
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One URL works for every organization you belong to.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3">
        <span className="shrink-0 text-sm text-muted-foreground">MCP URL</span>
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{env.mcpUrl}</code>
        <CopyButton value={env.mcpUrl} label="Copy MCP URL" />
      </div>

      <Tabs defaultValue={clients[0]?.id}>
        <TabsList className="w-full sm:w-fit">
          {clients.map((client) => (
            <TabsTrigger key={client.id} value={client.id} className="px-2.5">
              {client.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {clients.map((client) => (
          <TabsContent key={client.id} value={client.id} className="space-y-3 pt-2">
            <div className="text-muted-foreground">{client.instructions}</div>
            {client.snippet && <Snippet value={client.snippet} />}
          </TabsContent>
        ))}
      </Tabs>

      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>The first call opens a browser. Sign in with the same account you use here.</li>
        <li>
          Your agent sees the keys of every organization you belong to. When there is more than one, it passes a{" "}
          <Code>connection_id</Code> to pick the key.
        </li>
      </ul>
    </section>
  );
}
