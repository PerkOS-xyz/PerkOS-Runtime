"use client";

import dynamic from "next/dynamic";

const FloorApp = dynamic(() => import("./floor/FloorApp"), { ssr: false });

export default function Page() {
  return <FloorApp />;
}
