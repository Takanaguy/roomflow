"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const MESSAGE_REPLI = "La destruction n'a pas pu aboutir. Réessaie dans un instant.";

/**
 * Bouton « Détruire » du panneau admin. La destruction est definitive (la
 * colocation et toutes ses depenses, taches, courses et remboursements), donc
 * on demande de retaper le nom exact, comme le fait le serveur. Le nom est du
 * texte saisi par un utilisateur : il n'est jamais injecte comme HTML.
 */
export default function BoutonDetruireColocation({ id, nom }: { id: string; nom: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Meme regle que la route (egalite stricte) : le bouton ne s'active jamais
  // pour une demande que le serveur refuserait d'office.
  const confirme = saisie === nom;

  function fermer() {
    setOuvert(false);
    setSaisie("");
    setErreur(null);
  }

  async function detruire(e: FormEvent) {
    e.preventDefault();
    if (!confirme || enCours) return;
    setErreur(null);
    setEnCours(true);

    try {
      const res = await fetch(`/api/admin/colocations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: saisie }),
      });

      if (res.ok) {
        fermer();
        router.refresh();
        return;
      }

      if (res.status === 404) {
        // Deja detruite ailleurs, ou acces retire : la liste affichee est perimee.
        setErreur("Introuvable : la colocation n'existe plus ou ton accès a changé.");
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
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={`Détruire la colocation ${nom}`}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        Détruire
      </button>
    );
  }

  return (
    <form onSubmit={detruire} className="flex max-w-64 flex-col gap-2">
      <label htmlFor={`confirmation-${id}`} className="text-xs text-zinc-600">
        Action définitive. Pour confirmer, retape exactement le nom :{" "}
        <strong className="break-words font-semibold text-zinc-900">{nom}</strong>
      </label>
      <input
        id={`confirmation-${id}`}
        type="text"
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        disabled={enCours}
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!confirme || enCours}
          aria-busy={enCours}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50"
        >
          {enCours ? "Destruction…" : "Détruire définitivement"}
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
    </form>
  );
}
