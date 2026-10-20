import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import {
  getHouseholdForMember,
  isAdminMember,
  serializeHousehold,
} from "@/lib/households";
import { JOURS_FAIT_DANS_KANBAN, listerTachesKanban, serializeTasks } from "@/lib/tasks";
import KanbanClient from "./KanbanClient";

export default async function TachesPage({
  params,
}: PageProps<"/colocations/[id]/taches">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const [documents, detail] = await Promise.all([
    listerTachesKanban(id),
    serializeHousehold(result.household, session.user.id),
  ]);
  const taches = await serializeTasks(
    documents,
    session.user.id,
    isAdminMember(result.membership)
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <Link
        href={`/colocations/${id}`}
        className="text-xs text-zinc-500 hover:underline"
      >
        ← {result.household.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Tâches</h1>

      <KanbanClient
        householdId={id}
        membres={detail.members.map((m) => ({ userId: m.userId, name: m.name }))}
        initial={taches}
        // Jour courant calcule ici (serveur) et passe en prop : voir KanbanClient.
        aujourdhui={new Date().toISOString().slice(0, 10)}
        joursFaitDansKanban={JOURS_FAIT_DANS_KANBAN}
      />
    </main>
  );
}
