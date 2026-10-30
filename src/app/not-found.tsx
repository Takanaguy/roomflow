import Link from "next/link";

/**
 * Composant volontairement statique : le panneau /admin renvoie notFound()
 * aux non-admins, et cette page doit rester strictement identique a celle
 * d'une URL inconnue. Aucune lecture de session, de route ou de parametre ici,
 * sinon la difference trahirait l'existence de /admin.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="max-w-md text-zinc-600">
        Cette page n&apos;existe pas, ou tu n&apos;y as pas accès.
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href="/"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Retour à l&apos;accueil
        </Link>
        <Link
          href="/tableau-de-bord"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Mon tableau de bord
        </Link>
      </div>
    </main>
  );
}
