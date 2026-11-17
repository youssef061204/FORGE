import { Suspense } from "react";
import { Home } from "@/ui/home";

export default function Page() {
  return (
    <Suspense>
      <Home showcase={process.env.FORGE_MODE === "showcase"} />
    </Suspense>
  );
}
