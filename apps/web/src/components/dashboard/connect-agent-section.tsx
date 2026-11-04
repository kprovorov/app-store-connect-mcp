"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    id: "claude-ai",
    label: "Claude.ai",
    instructions: (
      <Steps>
        <li>
          In Claude.ai or Claude Desktop, open <Strong>Settings</Strong> and then <Strong>Connectors</Strong>.
        </li>
        <li>
          Click <Strong>Add custom connector</Strong>.
        </li>
        <li>Paste the MCP URL above and save.</li>
      </Steps>
    ),
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    instructions: (
      <Steps>
        <li>
          Open <Code>chatgpt.com/plugins</Code>, click <Strong>+</Strong>, and then <Strong>Add custom MCP server</Strong>.
        </li>
        <li>
          Name it, choose <Strong>Public endpoint</Strong>, and paste the MCP URL above.
        </li>
        <li>
          Set up OAuth authentication, accept the warning, and click <Strong>Create as a plugin</Strong>.
        </li>
        <li>
          Install the plugin. In a new chat, type <Code>@</Code> and pick it.
        </li>
        <li>In the ChatGPT desktop app, follow the Codex tab instead.</li>
      </Steps>
    ),
  },
  {
    id: "codex",
    label: "Codex",
    instructions: (
      <>
        Run this in your terminal. The second command opens the browser sign-in. The Codex IDE extension and the ChatGPT
        desktop app read the same config.
      </>
    ),
    snippet: `codex mcp add ${serverName} --url ${env.mcpUrl}\ncodex mcp login ${serverName}`,
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
    id: "copilot-cli",
    label: "Copilot CLI",
    instructions: (
      <>
        Run this in your terminal, then run <Code>/mcp auth</Code> in a Copilot session to sign in.
      </>
    ),
    snippet: `copilot mcp add --transport http ${serverName} ${env.mcpUrl}`,
  },
  {
    id: "antigravity",
    label: "Antigravity",
    instructions: (
      <>
        Add this to <Code>~/.gemini/config/mcp_config.json</Code>. Then open <Strong>Agent settings</Strong>, go to{" "}
        <Strong>Customizations</Strong>, and click <Strong>Authenticate</Strong>.
      </>
    ),
    snippet: json({ mcpServers: { [serverName]: { serverUrl: env.mcpUrl } } }),
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    instructions: (
      <>
        Run this in your terminal, then run <Code>/mcp auth {serverName}</Code> in a Gemini session to sign in.
      </>
    ),
    snippet: `gemini mcp add --transport http --scope user ${serverName} ${env.mcpUrl}`,
  },
  {
    id: "devin",
    label: "Devin (Windsurf)",
    instructions: (
      <>
        Run this in your terminal. Devin Desktop reads the same <Code>~/.config/devin/mcp_config.json</Code>. If it shows{" "}
        <Strong>Needs authentication</Strong>, click <Strong>Authenticate</Strong>.
      </>
    ),
    snippet: `devin mcp add -s user ${serverName} ${env.mcpUrl}\ndevin mcp login ${serverName}`,
  },
  {
    id: "zed",
    label: "Zed",
    instructions: (
      <>
        Add this to your Zed <Code>settings.json</Code>. Zed opens the sign-in when it connects.
      </>
    ),
    snippet: json({ context_servers: { [serverName]: { url: env.mcpUrl } } }),
  },
  {
    id: "opencode",
    label: "opencode",
    instructions: (
      <>
        Add this to <Code>opencode.json</Code>, then run <Code>opencode mcp auth {serverName}</Code> to sign in.
      </>
    ),
    snippet: json({ mcp: { [serverName]: { type: "remote", url: env.mcpUrl } } }),
  },
  {
    id: "kiro",
    label: "Kiro",
    instructions: (
      <>
        Add this to <Code>~/.kiro/settings/mcp.json</Code> for every project, or <Code>.kiro/settings/mcp.json</Code>{" "}
        for one. Kiro opens the sign-in when it connects.
      </>
    ),
    snippet: json({ mcpServers: { [serverName]: { url: env.mcpUrl } } }),
  },
  {
    id: "amp",
    label: "Amp",
    instructions: "Run this in your terminal. Amp opens the sign-in the next time it starts.",
    snippet: `amp mcp add ${serverName} ${env.mcpUrl}`,
  },
  {
    id: "goose",
    label: "goose",
    instructions: (
      <>
        Add this to <Code>~/.config/goose/config.yaml</Code>, or run <Code>goose configure</Code> and add a remote
        extension. goose opens the sign-in when it connects.
      </>
    ),
    snippet: [
      "extensions:",
      `  ${serverName}:`,
      `    name: ${serverName}`,
      "    type: streamable_http",
      `    uri: ${env.mcpUrl}`,
      "    enabled: true",
      "    timeout: 300",
    ].join("\n"),
  },
  {
    id: "raycast",
    label: "Raycast",
    instructions: (
      <Steps>
        <li>
          Run the <Strong>Install MCP Server</Strong> command. MCP needs Raycast Pro.
        </li>
        <li>
          Name it, choose <Strong>HTTP</Strong>, and paste the MCP URL above.
        </li>
        <li>
          Choose <Strong>Dynamic</Strong> OAuth, install it, and click <Strong>Sign In</Strong>.
        </li>
      </Steps>
    ),
  },
];

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-medium">{children}</strong>;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1 pl-5">{children}</ol>;
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

const clientBreakpoints = [
  { query: "(min-width: 48rem)", count: 6 },
  { query: "(min-width: 40rem)", count: 4 },
];

function getPrimaryClientCount() {
  return clientBreakpoints.find(({ query }) => window.matchMedia(query).matches)?.count ?? 2;
}

function subscribeToClientBreakpoints(onChange: () => void) {
  const queries = clientBreakpoints.map(({ query }) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

export function ConnectAgentSection() {
  const primaryClientCount = useSyncExternalStore(subscribeToClientBreakpoints, getPrimaryClientCount, () => 2);
  const [selectedClientId, setSelectedClientId] = useState("claude-code");
  const selectorId = useId();
  const selectedIndex = clients.findIndex((client) => client.id === selectedClientId);
  const selectedClient = clients[selectedIndex];
  const overflowSelected = selectedIndex >= primaryClientCount;

  return (
    <section aria-labelledby="connect-agent" className="space-y-5">
      <div>
        <h2 id="connect-agent" className="text-lg font-semibold tracking-tight">
          Connect your agent
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One URL works for every organization you belong to, in any client that supports remote MCP servers.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3">
        <span className="shrink-0 text-sm text-muted-foreground">MCP URL</span>
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{env.mcpUrl}</code>
        <CopyButton value={env.mcpUrl} label="Copy MCP URL" />
      </div>

      <Tabs value={selectedClientId} onValueChange={setSelectedClientId}>
        <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-muted p-[3px]">
          <TabsList aria-label="Agent clients" className="shrink-0 gap-0.5 bg-transparent p-0">
            {clients.slice(0, primaryClientCount).map((client) => (
              <TabsTrigger
                key={client.id}
                value={client.id}
                aria-controls={`${selectorId}-${client.id}`}
                className="h-7 flex-none px-2.5"
              >
                {client.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium text-foreground/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-ring dark:text-muted-foreground",
                overflowSelected &&
                  "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground",
              )}
            >
              <span className="truncate">{overflowSelected ? selectedClient?.label : "More"}</span>
              <span className="sr-only">, more clients</span>
              <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent key={primaryClientCount} align="end" className="min-w-48">
              <DropdownMenuRadioGroup value={selectedClientId} onValueChange={setSelectedClientId}>
                {clients.slice(primaryClientCount).map((client) => (
                  <DropdownMenuRadioItem key={client.id} value={client.id}>
                    {client.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {clients.map((client) => (
          <TabsContent
            key={client.id}
            id={`${selectorId}-${client.id}`}
            value={client.id}
            aria-label={client.label}
            aria-labelledby={undefined}
            className="space-y-3 pt-2"
          >
            <div className="text-muted-foreground">{client.instructions}</div>
            {client.snippet && <Snippet value={client.snippet} />}
          </TabsContent>
        ))}
      </Tabs>

      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>Your client opens a browser to sign in. Use the same account you use here.</li>
        <li>
          Your agent sees the keys of every organization you belong to. When there is more than one, it passes a{" "}
          <Code>connection_id</Code> to pick the key.
        </li>
      </ul>
    </section>
  );
}
