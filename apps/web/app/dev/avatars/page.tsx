import { notFound } from "next/navigation";
import AvatarsPreview from "./preview";

// Vista de desarrollo del sistema de avatares de agentes. 404 en produccion.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AvatarsPreview />;
}
