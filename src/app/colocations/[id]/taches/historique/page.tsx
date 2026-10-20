import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { JOURS_FAIT_DANS_KANBAN, listerHistorique, serializeTasks } from "@/lib/tasks";

export default async function HistoriqueTachesPage({
  params,
  searchParams,
}: PageProps<"/colocations/[id]/taches/historique">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const sp = await searchParams;

  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  // Un ?page= absent ou illisible (NaN) devient la page 1 dans listerHistorique.
  const demandee = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const historique = await listerHistorique(id, demandee);
  const taches = await serializeTasks(
    historique.taches,
    session.user.id,
    isAdminMember(result.membership)
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href={`/colocations/${id}/taches`}
        className="text-xs text-zinc-500 hover:underline"
      >
        ← Retour au Kanban
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Historique des tâches</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Le Kanban n&apos;affiche que les tâches terminées depuis moins de{" "}
        {JOURS_FAIT_DANS_KANBAN} jours. Toutes les tâches terminées sont ici, de la plus
        récente à la plus ancienne.
      </p>

      {taches.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600">Aucune tâche terminée pour l&apos;instant.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {taches.map((t) => (
            <li key={t.id} className="rounded-md border border-zinc-200 px-4 py-3">
              <p className="font-medium">{t.title}</p>
              <p className="text-xs text-zinc-500">
                {t.faitPar ? `Fait par ${t.faitPar.name}` : "Terminée"}
                {t.completedAt &&
                  // Fuseau fixe : le serveur tourne en UTC, une tache finie a
                  // 23h30 a Paris serait sinon datee du lendemain.
                  ` le ${new Date(t.completedAt).toLocaleDateString("fr-FR", {
                    timeZone: "Europe/Paris",
                  })}`}
              </p>
              <p className="text-xs text-zinc-500">
                Assignée à :{" "}
                {t.assignes.length > 0
                  ? t.assignes.map((a) => a.name).join(", ")
                  : "personne"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {(historique.page > 1 || historique.pageSuivante) && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {historique.page > 1 ? (
            <Link
              href={`/colocations/${id}/taches/historique?page=${historique.page - 1}`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50"
            >
              ← Précédent
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-zinc-500">Page {historique.page}</span>
          {historique.pageSuivante ? (
            <Link
              href={`/colocations/${id}/taches/historique?page=${historique.page + 1}`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50"
            >
              Suivant →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
