"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

// useSession() (utilise par Header) a besoin de ce contexte quelque part
// au-dessus de lui dans l'arbre. Pose ici, une seule fois, dans le layout
// racine.
export default function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
