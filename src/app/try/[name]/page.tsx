import { TryTool } from "@/ui/try-tool";

export default async function Page(props: PageProps<"/try/[name]">) {
  const { name } = await props.params;
  return <TryTool name={name} />;
}
