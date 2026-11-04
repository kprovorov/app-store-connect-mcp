import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

import { Brand } from "@/components/brand";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden sm:block">
              <Brand />
            </span>
            <span aria-hidden className="hidden text-border sm:block">
              /
            </span>
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/"
              afterCreateOrganizationUrl="/"
              afterLeaveOrganizationUrl="/"
            />
          </div>
          <UserButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
