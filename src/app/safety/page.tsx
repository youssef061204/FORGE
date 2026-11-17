import { SafetyLab } from "@/ui/safety";

export const metadata = { title: "Safety Lab" };

export default function Page() {
  return <SafetyLab showcase={process.env.FORGE_MODE === "showcase"} />;
}
