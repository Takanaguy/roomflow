"use client";

import { useState } from "react";

const MESSAGE_REPLI = "L'export n'a pas pu être généré. Réessaie dans un instant.";
const NOM_FICHIER_REPLI = "roomflow-recap.pdf";

/**
 * Bouton « Télécharger le PDF » du récapitulatif mensuel. Pas un simple
 * <a download> : si la route répond 404 ou 500, le navigateur enregistrerait
 * le JSON d'erreur comme s'il s'agissait du PDF. Ici on lit d'abord la réponse
 * et on ne déclenche le téléchargement que si elle est valide.
 */
export default function BoutonExportPdf({
  householdId,
  mois,
}: {
  householdId: string;
  /** AAAA-MM, le mois affiché par le dashboard */
  mois: string;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function telecharger() {
    setErreur(null);
    setEnCours(true);
    try {
      const res = await fetch(
        `/api/colocations/${householdId}/export?mois=${encodeURIComponent(mois)}`
      );

      if (!res.ok) {
        if (res.status === 401) {
          setErreur("Ta session a expiré, reconnecte-toi.");
          return;
        }
        // Le corps peut ne pas être du JSON (erreur de l'hébergeur par exemple).
        const corps = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setErreur(typeof corps?.error === "string" ? corps.error : MESSAGE_REPLI);
        return;
      }

      const blob = await res.blob();
      const nom =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        NOM_FICHIER_REPLI;

      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nom;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErreur(MESSAGE_REPLI);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={telecharger}
        disabled={enCours}
        aria-busy={enCours}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50"
      >
        {enCours ? "Génération du PDF…" : "Télécharger le PDF"}
      </button>
      {erreur && (
        <p role="alert" className="max-w-64 text-right text-xs text-red-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
