import { Suspense, type ReactNode } from "react";

import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5">
        <Brand />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
        {/* Clerk's components read the URL, which only exists at request time. */}
        <Suspense fallback={<Skeleton className="h-[420px] w-full max-w-[400px] rounded-xl" />}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
