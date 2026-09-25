"use client";

import dynamic from "next/dynamic";

// The wallet connector needs the browser, so the shell renders on the client only.
const Shell = dynamic(() => import("./shell/Shell").then((m) => m.Shell), { ssr: false });

export default function Page() {
  return <Shell />;
}
