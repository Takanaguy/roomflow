import Link from "next/link";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import HouseholdModel from "@/models/Household";

/**
 * Protegee par proxy.ts. Sert de liste des colocations (lot 3) ; le lot 8
 * y ajoutera un vrai aperçu (soldes, graphique) une fois les depenses en
 * place.
 */
export default async function TableauDeBordPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts empeche deja d'arriver ici

  await connectDB();
  const households = await HouseholdModel.find({
    "members.userId": session.user.id,
  }).sort({ createdAt: -1 });

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mes colocations</h1>
        <div className="flex gap-2">
          <Link
            href="/colocations/rejoindre"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
          >
            Rejoindre
          </Link>
          <Link
            href="/colocations/nouvelle"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Créer
          </Link>
        </div>
      </div>

      {households.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600">
          Tu ne fais partie d&apos;aucune colocation pour l&apos;instant.
          Crées-en une, ou rejoins-en une avec un code d&apos;invitation.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {households.map((h) => (
            <li key={h._id.toString()}>
              <Link
                href={`/colocations/${h._id.toString()}`}
                className="block rounded-md border border-zinc-200 px-4 py-3 hover:bg-zinc-50"
              >
                <p className="font-medium">{h.name}</p>
                {h.description && (
                  <p className="text-sm text-zinc-500">{h.description}</p>
                )}
                <p className="mt-1 text-xs text-zinc-400">
                  {h.members.length} membre{h.members.length > 1 ? "s" : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
