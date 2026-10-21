import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  JOURS_ACHETES_DANS_LISTE,
  listerHistoriqueCourses,
  serializeArticles,
} from "@/lib/shopping";

export default async function HistoriqueCoursesPage({
  params,
  searchParams,
}: PageProps<"/colocations/[id]/courses/historique">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const sp = await searchParams;

  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  // Un ?page= absent ou illisible (NaN) devient la page 1 dans listerHistoriqueCourses.
  const demandee = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const historique = await listerHistoriqueCourses(id, demandee);
  const articles = await serializeArticles(
    historique.articles,
    session.user.id,
    isAdminMember(result.membership)
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href={`/colocations/${id}/courses`}
        className="text-xs text-zinc-500 hover:underline"
      >
        ← Retour à la liste de courses
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Historique des courses</h1>
      <p className="mt-2 text-sm text-zinc-600">
        La liste de courses n&apos;affiche que les articles achetés depuis moins de{" "}
        {JOURS_ACHETES_DANS_LISTE} jours. Tous les articles achetés sont ici, du plus récent
        au plus ancien.
      </p>

      {articles.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600">
          {historique.total > 0
            ? "Cette page n'existe pas."
            : "Aucun article acheté pour l'instant."}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {articles.map((a) => (
            <li key={a.id} className="rounded-md border border-zinc-200 px-4 py-3">
              <p className="font-medium">
                {a.name}
                {a.quantity && (
                  <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-600">
                    {a.quantity}
                  </span>
                )}
              </p>
              <p className="text-xs text-zinc-500">
                {a.cochePar ? `Acheté par ${a.cochePar.name}` : "Acheté"}
                {a.checkedAt &&
                  // Fuseau fixe : le serveur tourne en UTC, un achat a 23h30 a
                  // Paris serait sinon date du lendemain.
                  ` le ${new Date(a.checkedAt).toLocaleDateString("fr-FR", {
                    timeZone: "Europe/Paris",
                  })}`}
              </p>
              <p className="text-xs text-zinc-500">Ajouté par {a.ajoutePar.name}</p>
            </li>
          ))}
        </ul>
      )}

      {(historique.page > 1 || historique.pageSuivante) && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {historique.page > 1 ? (
            <Link
              href={`/colocations/${id}/courses/historique?page=${historique.page - 1}`}
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
              href={`/colocations/${id}/courses/historique?page=${historique.page + 1}`}
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
