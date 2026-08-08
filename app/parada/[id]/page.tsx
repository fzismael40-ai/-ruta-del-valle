import ParadaStatus from "./ParadaStatus";

export default async function ParadaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ParadaStatus id={id} />;
}
