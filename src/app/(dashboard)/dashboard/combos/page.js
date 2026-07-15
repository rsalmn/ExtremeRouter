"use client";

import { Suspense } from "react";
import CombosPageInner from "./CombosPageInner.js";

export default function CombosPage() {
  return (
    <Suspense fallback={<div className="flex flex-col gap-6"><div className="h-32 animate-pulse rounded-lg bg-sidebar" /><div className="h-32 animate-pulse rounded-lg bg-sidebar" /></div>}>
      <CombosPageInner />
    </Suspense>
  );
}
