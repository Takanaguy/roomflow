import Link from "next/link";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">RoomFlow</h1>
      <p className="max-w-md text-zinc-600">
        Gestionnaire de colocation : dépenses partagées, remboursements
        simplifiés, tâches communes.
      </p>

      {session?.user ? (
        <Link
          href="/tableau-de-bord"
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Aller au tableau de bord
        </Link>
      ) : (
        <div className="mt-2 flex gap-3">
          <Link
            href="/inscription"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Créer un compte
          </Link>
          <Link
            href="/connexion"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            Se connecter
          </Link>
        </div>
      )}
    </main>
  );
}
