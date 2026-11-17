import { Assistants } from "@/ui/assistants";

export const metadata = { title: "Assistants" };

export default function Page() {
  return <Assistants showcase={process.env.FORGE_MODE === "showcase"} />;
}
