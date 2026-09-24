import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember } from "@/lib/households";
import { calculerDettesSimplifiees } from "@/lib/settlements";
import DettesClient from "./DettesClient";

export default async function DettesPage({
  params,
}: PageProps<"/colocations/[id]/dettes">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const dettes = await calculerDettesSimplifiees(id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href={`/colocations/${id}`}
        className="text-xs text-zinc-500 hover:underline"
      >
        ← {result.household.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Qui doit quoi</h1>

      <DettesClient householdId={id} viewerId={session.user.id} initial={dettes} />
    </main>
  );
}
