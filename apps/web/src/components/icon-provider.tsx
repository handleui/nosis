"use client";

import type { ReactNode } from "react";
import { IconoirProvider } from "iconoir-react";

export default function IconProvider({ children }: { children: ReactNode }) {
  return (
    <IconoirProvider
      iconProps={{
        strokeWidth: 1.8,
      }}
    >
      {children}
    </IconoirProvider>
  );
}
