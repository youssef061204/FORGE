import { Suspense } from "react";
import { Tour } from "@/ui/tour";

export const metadata = { title: "Watch a tool get built" };

export default function Page() {
  return (
    <Suspense>
      <Tour />
    </Suspense>
  );
}
