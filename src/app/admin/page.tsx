import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  lireAdminSite,
  listerColocationsAdmin,
  MAX_COLOCATIONS_ADMIN,
  type EtatColocation,
  type LigneColocationAdmin,
} from "@/lib/admin";
import {
  DELAI_INACTIVITE_JOURS,
  DELAI_SUPPRESSION_JOURS,
  suppressionAutoActive,
} from "@/lib/nettoyage";
import BoutonDetruireColocation from "./BoutonDetruireColocation";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

const formatDate = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeZone: "Europe/Paris",
});

function libelleEtat(etat: EtatColocation): string {
  switch (etat.code) {
    case "demo":
      return "Démo";
    case "suppression_prevue":
      return `Suppression prévue le ${formatDate.format(etat.suppressionPrevueLe)} (${
        etat.motif === "vide" ? "colocation vide" : "colocation inactive"
      })`;
    case "vide":
      return "Vide";
    case "inactive":
      return "Inactive";
    case "active":
      return "Active";
  }
}

const COULEURS_ETAT: Record<EtatColocation["code"], string> = {
  demo: "bg-blue-50 text-blue-800",
  suppression_prevue: "bg-red-50 text-red-800",
  vide: "bg-amber-50 text-amber-800",
  inactive: "bg-amber-50 text-amber-800",
  active: "bg-green-50 text-green-800",
};

function compter(lignes: LigneColocationAdmin[], code: EtatColocation["code"]): number {
  return lignes.filter((l) => l.etat.code === code).length;
}

/**
 * Panneau admin du site. Hors du matcher de proxy.ts a dessein : un non-admin
 * et un non-connecte recoivent exactement le meme 404 qu'une page inconnue
 * (une redirection vers /connexion revelerait que la page existe). La
 * verification se refait a chaque requete, cote serveur.
 */
export default async function AdminPage() {
  const admin = await lireAdminSite();
  if (!admin) notFound();

  const { colocations, total, tronquee } = await listerColocationsAdmin();
  const autoActive = suppressionAutoActive({
    NETTOYAGE_AUTO_ACTIF: process.env.NETTOYAGE_AUTO_ACTIF,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Administration</h1>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-zinc-200 px-4 py-3">
          <dt className="text-xs text-zinc-500">Colocations</dt>
          <dd className="text-xl font-semibold">{total}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 px-4 py-3">
          <dt className="text-xs text-zinc-500">Vides</dt>
          <dd className="text-xl font-semibold">{compter(colocations, "vide")}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 px-4 py-3">
          <dt className="text-xs text-zinc-500">Inactives</dt>
          <dd className="text-xl font-semibold">{compter(colocations, "inactive")}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 px-4 py-3">
          <dt className="text-xs text-zinc-500">Suppressions prévues</dt>
          <dd className="text-xl font-semibold">{compter(colocations, "suppression_prevue")}</dd>
        </div>
      </dl>

      {tronquee && (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Seules les {MAX_COLOCATIONS_ADMIN} colocations les plus récentes sont affichées, sur{" "}
          {total} au total. Les compteurs de l&apos;état (vides, inactives, suppressions prévues) ne
          portent que sur celles-ci.
        </p>
      )}

      <section className="mt-6 rounded-md bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <h2 className="font-medium text-zinc-900">Règles de nettoyage</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Une colocation avec des membres est <strong>inactive</strong> après plus de{" "}
            {DELAI_INACTIVITE_JOURS} jours sans activité (dépense, tâche, course, remboursement ou
            nouveau membre).
          </li>
          <li>
            Une colocation <strong>vide</strong> (aucun membre) ou inactive reçoit un préavis de{" "}
            {DELAI_SUPPRESSION_JOURS} jours avant sa suppression.
          </li>
          <li>La colocation de démo n&apos;est jamais nettoyée automatiquement.</li>
          <li>
            Suppression <strong>automatique</strong> :{" "}
            <strong>{autoActive ? "activée" : "désactivée"}</strong>
            {autoActive
              ? "."
              : " (elle ne s'active que si la variable NETTOYAGE_AUTO_ACTIF vaut exactement « true »)."}{" "}
            Le bouton « Détruire » ci-dessous fonctionne dans tous les cas.
          </li>
        </ul>
      </section>

      {colocations.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600">Aucune colocation.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                <th scope="col" className="py-2 pr-4 font-medium">Colocation</th>
                <th scope="col" className="py-2 pr-4 font-medium">État</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Membres</th>
                <th scope="col" className="py-2 pr-4 font-medium">Créée le</th>
                <th scope="col" className="py-2 pr-4 font-medium">Dernière activité</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Dépenses</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Tâches</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Courses</th>
                <th scope="col" className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {colocations.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 align-top">
                  {/* Texte saisi par un utilisateur : rendu comme texte par React, jamais comme HTML. */}
                  <td className="max-w-56 break-words py-3 pr-4 font-medium">{c.nom}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${COULEURS_ETAT[c.etat.code]}`}
                    >
                      {libelleEtat(c.etat)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.nombreMembres}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{formatDate.format(c.creeLe)}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {formatDate.format(c.derniereActivite)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.nombreDepenses}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.nombreTaches}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.nombreArticles}</td>
                  <td className="py-3">
                    <BoutonDetruireColocation id={c.id} nom={c.nom} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
