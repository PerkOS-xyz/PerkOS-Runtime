import { notFound } from "next/navigation";
import LaunchesPreview from "./preview";

// Vista de desarrollo: la pantalla Launches del desk sin pasar por el login
// (usa la wallet de Settings). Solo existe en `next dev`; en produccion es 404.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LaunchesPreview />;
}
