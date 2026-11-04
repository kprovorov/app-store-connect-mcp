import { ConnectAgentSection } from "@/components/dashboard/connect-agent-section";
import { ConnectionsSection } from "@/components/dashboard/connections-section";
import { Separator } from "@/components/ui/separator";

export default function DashboardPage() {
  return (
    <div className="space-y-10">
      <ConnectionsSection />
      <Separator />
      <ConnectAgentSection />
    </div>
  );
}
