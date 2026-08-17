import RutaApp from "../../RutaApp";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <RutaApp slug={slug} />;
}
