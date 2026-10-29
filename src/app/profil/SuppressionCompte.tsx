"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
// Types seulement : importer une valeur de account.ts embarquerait Mongoose
// dans le navigateur.
import type { EvaluationSuppression, ProviderCompte } from "@/lib/account";

const MOT_DE_CONFIRMATION = "SUPPRIMER";

export default function SuppressionCompte({
  evaluation,
  provider,
}: {
  evaluation: EvaluationSuppression;
  provider: ProviderCompte;
}) {
  const router = useRouter();
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [abandonAccepte, setAbandonAccepte] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [connexionAncienne, setConnexionAncienne] = useState(false);

  const demandeMotDePasse = provider === "credentials";
  const aDesCreances = evaluation.creances.length > 0;
  // Dettes et creances peuvent concerner une colocation deja quittee.
  const idsMembre = new Set(evaluation.colocations.map((c) => c.id));
  const colocationsDetruites = evaluation.colocations.filter((c) => c.estDernierMembre);
  const colocationsAdmin = evaluation.colocations.filter(
    (c) => c.estAdmin && !c.estDernierMembre
  );

  // Memes conditions que la route : le bouton ne s'active jamais pour une
  // demande que le serveur refuserait d'office.
  const valide =
    evaluation.peutSupprimer &&
    confirmation === MOT_DE_CONFIRMATION &&
    (!aDesCreances || abandonAccepte) &&
    (!demandeMotDePasse || motDePasse.length > 0);

  async function supprimer(e: FormEvent) {
    e.preventDefault();
    if (!valide || enCours) return;
    setErreur(null);
    setConnexionAncienne(false);
    setEnCours(true);

    try {
      const res = await fetch("/api/profil", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation,
          ...(demandeMotDePasse ? { motDePasse } : {}),
          accepterAbandonCreances: abandonAccepte,
        }),
      });

      if (res.ok) {
        // enCours reste a true : la page va etre quittee, pas de second clic.
        await signOut({ callbackUrl: "/" });
        return;
      }

      const body: { error?: string; code?: string } | null = await res.json().catch(() => null);
      setErreur(body?.error ?? "La suppression n'a pas pu aboutir. Réessaie.");
      if (body?.code === "connexion_ancienne") setConnexionAncienne(true);
      // 409 : la situation a change depuis l'affichage (nouvelle depense,
      // remboursement...). On relit la page pour montrer les vrais montants.
      if (res.status === 409) router.refresh();
    } catch {
      setErreur("La suppression n'a pas pu aboutir. Vérifie ta connexion et réessaie.");
    }
    setEnCours(false);
  }

  return (
    <details className="mt-10 rounded-md border border-red-200 bg-red-50 p-4">
      <summary className="cursor-pointer text-sm font-medium text-red-800">Zone de danger</summary>

      <div className="mt-3 flex flex-col gap-3 text-sm">
        <p className="font-medium text-red-800">Supprimer mon compte</p>
        <p className="text-red-700">
          Ton compte et tes identifiants sont supprimés. Tu quittes toutes tes colocations. Ton
          historique (dépenses, remboursements) reste visible pour les autres au nom de
          « Utilisateur supprimé ». Les colocations dont tu es le dernier membre sont détruites
          avec leurs données. Cette action est définitive.
        </p>

        {colocationsDetruites.length > 0 && (
          <div className="text-red-700">
            <p>Colocations détruites avec ton compte :</p>
            <ul className="mt-1 list-disc pl-5">
              {colocationsDetruites.map((c) => (
                <li key={c.id}>{c.nom}</li>
              ))}
            </ul>
          </div>
        )}

        {colocationsAdmin.length > 0 && (
          <p className="text-red-700">
            Tu es admin de {colocationsAdmin.map((c) => c.nom).join(", ")} : le membre le plus
            ancien deviendra admin à ta place.
          </p>
        )}

        {!evaluation.peutSupprimer && (
          <div className="rounded-md border border-red-300 bg-white p-3 text-red-800">
            <p>
              Tu dois encore de l&apos;argent. Règle tes dettes avant de pouvoir supprimer ton
              compte :
            </p>
            <ul className="mt-1 list-disc pl-5">
              {evaluation.dettes.map((d) => (
                <li key={d.householdId}>
                  {/* Colocation quittee : sa page n'est plus accessible (404). */}
                  {idsMembre.has(d.householdId) ? (
                    <Link href={`/colocations/${d.householdId}/dettes`} className="underline">
                      {d.nom}
                    </Link>
                  ) : (
                    <>
                      {d.nom} <span className="text-red-700">(colocation quittée)</span>
                    </>
                  )}{" "}
                  : tu dois <span className="font-mono">{d.montant.toFixed(2)} €</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {evaluation.peutSupprimer && (
          <form onSubmit={supprimer} className="flex flex-col gap-3">
            {aDesCreances && (
              <div className="rounded-md border border-red-300 bg-white p-3 text-red-800">
                <p>On te doit encore de l&apos;argent :</p>
                <ul className="mt-1 list-disc pl-5">
                  {evaluation.creances.map((c) => (
                    <li key={c.householdId}>
                      {c.nom}
                      {!idsMembre.has(c.householdId) && " (colocation quittée)"} :{" "}
                      <span className="font-mono">{c.montant.toFixed(2)} €</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  En supprimant ton compte, ces sommes sont considérées comme réglées : tes
                  colocataires ne te les devront plus.
                </p>
                <label className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={abandonAccepte}
                    onChange={(e) => setAbandonAccepte(e.target.checked)}
                    className="mt-1"
                  />
                  <span>J&apos;abandonne ces sommes</span>
                </label>
              </div>
            )}

            {demandeMotDePasse && (
              <label className="flex flex-col gap-1">
                Mot de passe
                <input
                  type="password"
                  autoComplete="current-password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2"
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              Tape {MOT_DE_CONFIRMATION} pour confirmer
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono"
              />
            </label>

            <button
              type="submit"
              disabled={!valide || enCours}
              className="self-start rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {enCours ? "Suppression..." : "Supprimer définitivement mon compte"}
            </button>
          </form>
        )}

        {/* Hors du formulaire : apres un 409 suivi du rafraichissement, le
            formulaire peut disparaitre (dette apparue) mais le message reste. */}
        {erreur && (
          <p role="alert" className="text-red-700">
            {erreur}
          </p>
        )}

        {connexionAncienne && (
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/connexion" })}
            className="self-start rounded-md border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-50"
          >
            Se reconnecter
          </button>
        )}

        {!evaluation.peutSupprimer && (
          <button
            type="button"
            disabled
            className="self-start rounded-md bg-red-600 px-3 py-1.5 text-white disabled:opacity-50"
          >
            Supprimer définitivement mon compte
          </button>
        )}
      </div>
    </details>
  );
}
