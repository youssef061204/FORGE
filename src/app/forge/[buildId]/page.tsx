import { FloorPage } from "./floor-page";

export default async function Page(props: PageProps<"/forge/[buildId]">) {
  const { buildId } = await props.params;
  return <FloorPage id={buildId} showcase={process.env.FORGE_MODE === "showcase"} />;
}
