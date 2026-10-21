import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { JOURS_ACHETES_DANS_LISTE, listerArticles, serializeArticles } from "@/lib/shopping";
import CoursesClient from "./CoursesClient";

export default async function CoursesPage({
  params,
}: PageProps<"/colocations/[id]/courses">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const estAdmin = isAdminMember(result.membership);
  const liste = await listerArticles(id);
  // Deux serialisations : chacune fait sa requete groupee de noms, mais c'est
  // deux requetes au total (pas une par article).
  const [aAcheter, achetes] = await Promise.all([
    serializeArticles(liste.aAcheter, session.user.id, estAdmin),
    serializeArticles(liste.achetes, session.user.id, estAdmin),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href={`/colocations/${id}`}
        className="text-xs text-zinc-500 hover:underline"
      >
        ← {result.household.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Courses</h1>

      <CoursesClient
        householdId={id}
        // Sert uniquement a afficher un article ajoute avant la reponse du
        // serveur (mise a jour optimiste) ; la version du serveur la remplace.
        moi={{ userId: session.user.id, name: session.user.name ?? "Moi" }}
        aAcheter={aAcheter}
        achetes={achetes}
        joursAchetes={JOURS_ACHETES_DANS_LISTE}
      />
    </main>
  );
}
