import { SettingsPage } from "@/ui/settings";

export const metadata = { title: "Settings" };

export default function Page() {
  return <SettingsPage showcase={process.env.FORGE_MODE === "showcase"} />;
}
