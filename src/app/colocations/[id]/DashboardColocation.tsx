import Link from "next/link";
import type { DonneesDashboard } from "@/lib/dashboard";
import BoutonExportPdf from "./BoutonExportPdf";
import GraphiqueCategories from "./GraphiqueCategories";

const FORMAT_MOIS = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// Les dates (depenses, echeances) sont stockees a minuit UTC : les afficher dans
// le fuseau du serveur pourrait les decaler d'un jour.
function formaterDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

const CARTE = "rounded-md border border-zinc-200 p-4";
const TITRE_CARTE = "text-sm font-medium text-zinc-500";
const LIEN_CARTE = "mt-4 inline-block text-sm font-medium hover:underline";

/**
 * Apercu de la colocation en haut de /colocations/[id]. Server Component : il
 * ne fait qu'afficher des donnees deja calculees (donneesDashboard), seul le
 * graphique est un composant client.
 */
export default function DashboardColocation({
  donnees,
  householdId,
  viewerId,
}: {
  donnees: DonneesDashboard;
  householdId: string;
  viewerId: string;
}) {
  const { mois } = donnees;
  const base = `/colocations/${householdId}`;
  // Meme regle que le Kanban : en retard = echeance strictement avant le jour
  // UTC courant. Comparaison de chaines "YYYY-MM-DD", donc sans souci de fuseau.
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <section aria-label="Aperçu de la colocation" className="mt-6 flex flex-col gap-4">
      <nav aria-label="Mois affiché" className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* Un emplacement vide garde le libelle du mois a la meme place que
              la fleche soit presente ou non. */}
          {mois.precedent ? (
            <Link
              href={`${base}?mois=${mois.precedent}`}
              aria-label="Mois précédent"
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-50"
            >
              ←
            </Link>
          ) : (
            <span className="w-10" aria-hidden="true" />
          )}
          <span className="min-w-36 text-center text-sm font-medium capitalize">
            {FORMAT_MOIS.format(mois.debut)}
          </span>
          {mois.suivant ? (
            <Link
              href={`${base}?mois=${mois.suivant}`}
              aria-label="Mois suivant"
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-50"
            >
              →
            </Link>
          ) : (
            <span className="w-10" aria-hidden="true" />
          )}
        </div>
        <div className="flex items-start gap-3">
          {!mois.estMoisCourant && (
            <Link href={base} className="py-1.5 text-sm text-zinc-600 hover:underline">
              Mois en cours
            </Link>
          )}
          <BoutonExportPdf householdId={householdId} mois={mois.cle} />
        </div>
      </nav>

      <div className={CARTE}>
        <h2 className={TITRE_CARTE}>Dépenses du mois</h2>
        <p className="mt-1 mb-4 font-mono text-2xl font-semibold">
          {donnees.totalMois.toFixed(2)} €
        </p>
        <GraphiqueCategories categories={donnees.categories} total={donnees.totalMois} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={CARTE}>
          <h2 className={TITRE_CARTE}>Soldes</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {donnees.soldes.map((s) => {
              const estMoi = s.userId === viewerId;
              // Le signe et le texte portent l'information, la couleur n'est
              // qu'un renfort.
              const detail =
                s.amount > 0
                  ? estMoi
                    ? "on te doit"
                    : "on lui doit"
                  : s.amount < 0
                    ? estMoi
                      ? "tu dois"
                      : "doit"
                    : null;
              return (
                <li key={s.userId} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {s.name}
                      {estMoi && <span className="text-zinc-500"> (toi)</span>}
                    </span>
                    {detail && <span className="block text-xs text-zinc-500">{detail}</span>}
                  </span>
                  {s.amount > 0 ? (
                    <span className="shrink-0 font-mono text-green-700">
                      +{s.amount.toFixed(2)} €
                    </span>
                  ) : s.amount < 0 ? (
                    <span className="shrink-0 font-mono text-red-700">
                      -{Math.abs(s.amount).toFixed(2)} €
                    </span>
                  ) : (
                    <span className="shrink-0 text-zinc-500">à jour</span>
                  )}
                </li>
              );
            })}
          </ul>
          <Link href={`${base}/dettes`} className={LIEN_CARTE}>
            Qui doit quoi →
          </Link>
        </div>

        <div className={CARTE}>
          <h2 className={TITRE_CARTE}>Tâches en cours</h2>
          <p className="mt-1 text-sm">
            <span className="font-medium">{donnees.nbTachesEnCours} en cours</span>
            {donnees.nbTachesEnRetard > 0 && (
              <span className="text-red-700"> · dont {donnees.nbTachesEnRetard} en retard</span>
            )}
          </p>
          {donnees.tachesEnCours.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">Aucune tâche en cours.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {donnees.tachesEnCours.map((t) => {
                const enRetard = !!t.dueDate && t.dueDate.slice(0, 10) < aujourdhui;
                return (
                  <li key={t.id} className="text-sm">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-zinc-500">
                      {t.assignes.length > 0
                        ? t.assignes.map((a) => a.name).join(", ")
                        : "Personne d'assigné"}
                    </p>
                    {t.dueDate && (
                      <p className={`text-xs ${enRetard ? "text-red-700" : "text-zinc-500"}`}>
                        Échéance : {formaterDate(t.dueDate)}
                        {enRetard && " · en retard"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link href={`${base}/taches`} className={LIEN_CARTE}>
            Voir le Kanban →
          </Link>
        </div>
      </div>

      <div className={CARTE}>
        <h2 className={TITRE_CARTE}>Dernières dépenses</h2>
        {donnees.dernieresDepenses.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">Aucune dépense pour l&apos;instant.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1">
            {donnees.dernieresDepenses.map((d) => (
              <li key={d.id}>
                <Link
                  href={`${base}/depenses/${d.id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-zinc-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.description}</span>
                    <span className="block text-xs text-zinc-500">
                      {d.payeurs.length === 1 ? d.payeurs[0].name : `${d.payeurs.length} payeurs`}{" "}
                      · {formaterDate(d.date)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm">{d.amount.toFixed(2)} €</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={`${base}/depenses`} className={LIEN_CARTE}>
          Toutes les dépenses →
        </Link>
      </div>
    </section>
  );
}
