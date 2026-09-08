"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export default function Header() {
  const { data: session, status } = useSession();

  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold">
          RoomFlow
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {status === "loading" ? null : session?.user ? (
            <>
              <Link href="/tableau-de-bord" className="text-zinc-600 hover:text-zinc-950">
                Tableau de bord
              </Link>
              <Link href="/profil" className="text-zinc-600 hover:text-zinc-950">
                {session.user.name}
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50"
              >
                Se déconnecter
              </button>
            </>
          ) : (
            <>
              <Link href="/connexion" className="text-zinc-600 hover:text-zinc-950">
                Connexion
              </Link>
              <Link
                href="/inscription"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-700"
              >
                Créer un compte
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
