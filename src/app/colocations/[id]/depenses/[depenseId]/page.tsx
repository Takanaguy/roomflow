import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { getExpenseInHousehold, serializeExpenses } from "@/lib/expenses";
import DepenseActions from "./DepenseActions";

const LABELS_CATEGORIE: Record<string, string> = {
  courses: "Courses",
  factures: "Factures",
  loyer: "Loyer",
  sorties: "Sorties",
  autre: "Autre",
};

export default async function DepenseDetailPage({
  params,
}: PageProps<"/colocations/[id]/depenses/[depenseId]">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id, depenseId } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const expense = await getExpenseInHousehold(id, depenseId);
  if (!expense) notFound();

  const [detail] = await serializeExpenses(
    [expense],
    session.user.id,
    isAdminMember(result.membership)
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href={`/colocations/${id}/depenses`}
        className="text-xs text-zinc-500 hover:underline"
      >
        ← Dépenses
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{detail.description}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {LABELS_CATEGORIE[detail.category] ?? detail.category} ·{" "}
            {new Date(detail.date).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <span className="font-mono text-xl">{detail.amount.toFixed(2)} €</span>
      </div>

      <div className="mt-6 flex flex-col gap-1 text-sm text-zinc-600">
        <p>
          Payé par <span className="font-medium text-zinc-900">{detail.payeur.name}</span>
        </p>
        <p>
          Ajouté par <span className="font-medium text-zinc-900">{detail.creePar.name}</span>
        </p>
      </div>

      <h2 className="mt-8 text-sm font-medium text-zinc-500">
        Qui doit quoi ({detail.splitType === "equal" ? "part égale" : "personnalisée"})
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {detail.splits.map((s) => (
          <li
            key={s.userId}
            className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-zinc-50"
          >
            <span>
              {s.name}
              {s.userId === detail.payeur.userId && (
                <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                  payeur
                </span>
              )}
            </span>
            <span className="font-mono text-sm">{s.amount.toFixed(2)} €</span>
          </li>
        ))}
      </ul>

      {detail.peuxModifier && (
        <DepenseActions householdId={id} depenseId={depenseId} />
      )}
    </main>
  );
}
