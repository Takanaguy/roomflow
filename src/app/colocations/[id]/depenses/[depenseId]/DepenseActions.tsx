"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Visible seulement si l'API a confirme peuxModifier (auteur ou admin). */
export default function DepenseActions({
  householdId,
  depenseId,
}: {
  householdId: string;
  depenseId: string;
}) {
  const router = useRouter();
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function supprimer() {
    setEnCours(true);
    const res = await fetch(`/api/colocations/${householdId}/depenses/${depenseId}`, {
      method: "DELETE",
    });
    setEnCours(false);

    if (!res.ok) {
      setErreur("Impossible de supprimer cette dépense.");
      return;
    }
    router.push(`/colocations/${householdId}/depenses`);
  }

  return (
    <div className="mt-8 border-t border-zinc-200 pt-6">
      {erreur && <p className="mb-2 text-sm text-red-600">{erreur}</p>}

      {confirmer ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={supprimer}
            disabled={enCours}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {enCours ? "Suppression..." : "Confirmer la suppression"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmer(false)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Annuler
          </button>
        </div>
      ) : (
        <div className="flex gap-4">
          <Link
            href={`/colocations/${householdId}/depenses/${depenseId}/modifier`}
            className="text-sm text-zinc-600 hover:underline"
          >
            Modifier
          </Link>
          <button
            type="button"
            onClick={() => setConfirmer(true)}
            className="text-sm text-red-600 hover:underline"
          >
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
