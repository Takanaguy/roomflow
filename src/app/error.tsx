"use client";

import Link from "next/link";

/**
 * Filet de securite d'un segment. On n'affiche jamais error.message : cote
 * serveur il peut contenir des details internes (en production Next le
 * remplace deja par un message generique, mais on ne compte pas dessus).
 * Seul le digest est montre, pour retrouver l'erreur dans les logs Vercel.
 */
export default function Erreur({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest !== ""
      ? error.digest
      : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Une erreur est survenue</h1>
      <p className="max-w-md text-zinc-600">
        Ce n&apos;est pas de ta faute, et tes données ne sont pas perdues. Tu peux
        réessayer, ou revenir à l&apos;accueil.
      </p>
      {digest && <p className="text-xs text-zinc-600">Référence : {digest}</p>}
      <div className="mt-2 flex gap-3">
        {/* retry() et pas reset() : reset ne rechargerait pas les donnees du serveur, donc une panne passagere de la base ne serait jamais rattrapee. */}
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Réessayer
        </button>
        <Link
          href="/"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
