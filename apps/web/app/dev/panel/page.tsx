import { notFound } from "next/navigation";
import PanelPreview from "./preview";

// Vista de desarrollo: una pantalla del dock del desk sin pasar por el login
// (usa la wallet de Settings). /dev/panel?screen=portfolio|launches|market...
// Solo existe en `next dev`; en produccion es 404.
export default async function Page({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await searchParams;
  return <PanelPreview initial={screen ?? "launches"} />;
}
