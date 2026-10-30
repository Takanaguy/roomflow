"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MESSAGE_REPLI = "La réinitialisation n'a pas pu aboutir. Réessaie dans un instant.";

/**
 * Bouton « Réinitialiser la démo » du panneau admin. L'operation efface tout ce
 * qui a ete fait sur le compte demo et recree la colocation d'exemple : on
 * demande une confirmation en ligne, comme pour la destruction d'une colocation.
 */
export default function BoutonReinitialiserDemo() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  function fermer() {
    setOuvert(false);
    setErreur(null);
  }

  async function reinitialiser() {
    if (enCours) return;
    setErreur(null);
    setFait(false);
    setEnCours(true);

    try {
      const res = await fetch("/api/admin/demo", { method: "POST" });

      if (res.ok) {
        fermer();
        setFait(true);
        router.refresh();
        return;
      }

      // Le corps peut ne pas etre du JSON (erreur de l'hebergeur par exemple).
      const corps = (await res.json().catch(() => null)) as { error?: unknown } | null;
      setErreur(typeof corps?.error === "string" ? corps.error : MESSAGE_REPLI);
    } catch {
      setErreur(MESSAGE_REPLI);
    } finally {
      setEnCours(false);
    }
  }

  if (!ouvert) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            setFait(false);
            setOuvert(true);
          }}
          className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Réinitialiser la démo
        </button>
        {fait && (
          <p role="status" className="text-xs text-green-800">
            Démo réinitialisée.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-2">
      <p className="text-sm text-zinc-700">
        Réinitialiser la démo ? Toutes les modifications faites sur le compte démo seront perdues.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reinitialiser}
          disabled={enCours}
          aria-busy={enCours}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50"
        >
          {enCours ? "Réinitialisation…" : "Réinitialiser"}
        </button>
        <button
          type="button"
          onClick={fermer}
          disabled={enCours}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
      {erreur && (
        <p role="alert" className="text-xs text-red-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
