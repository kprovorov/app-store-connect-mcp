import { TaskChooseOrganization } from "@clerk/nextjs";

export default function ChooseOrganizationPage() {
  return <TaskChooseOrganization redirectUrlComplete="/dashboard" />;
}
