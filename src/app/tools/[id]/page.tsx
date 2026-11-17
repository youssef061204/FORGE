import { ToolDetail } from "@/ui/toolbox";

export default async function Page(props: PageProps<"/tools/[id]">) {
  const { id } = await props.params;
  return <ToolDetail id={id} />;
}
