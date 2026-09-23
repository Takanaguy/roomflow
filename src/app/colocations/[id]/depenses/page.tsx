import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { serializeExpenses } from "@/lib/expenses";
import ExpenseModel from "@/models/Expense";

const CATEGORIES = [
  { value: "courses", label: "Courses" },
  { value: "factures", label: "Factures" },
  { value: "loyer", label: "Loyer" },
  { value: "sorties", label: "Sorties" },
  { value: "autre", label: "Autre" },
] as const;

export default async function DepensesPage({
  params,
  searchParams,
}: PageProps<"/colocations/[id]/depenses">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const sp = await searchParams;

  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const category = typeof sp.category === "string" ? sp.category : undefined;

  await connectDB();
  const filtre: Record<string, unknown> = { householdId: id };
  if (category) filtre.category = category;

  const expenses = await ExpenseModel.find(filtre).sort({ date: -1 });
  const liste = await serializeExpenses(
    expenses,
    session.user.id,
    isAdminMember(result.membership)
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/colocations/${id}`}
            className="text-xs text-zinc-500 hover:underline"
          >
            ← {result.household.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Dépenses</h1>
        </div>
        <Link
          href={`/colocations/${id}/depenses/nouvelle`}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Ajouter
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={`/colocations/${id}/depenses`}
          className={`rounded-full border px-3 py-1 text-xs ${
            !category
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          Toutes
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.value}
            href={`/colocations/${id}/depenses?category=${c.value}`}
            className={`rounded-full border px-3 py-1 text-xs ${
              category === c.value
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {liste.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600">
          Aucune dépense {category ? "dans cette catégorie" : "pour l'instant"}.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {liste.map((d) => (
            <li key={d.id}>
              <Link
                href={`/colocations/${id}/depenses/${d.id}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3 hover:bg-zinc-50"
              >
                <div>
                  <p className="font-medium">{d.description}</p>
                  <p className="text-xs text-zinc-500">
                    {d.payeurs.length === 1
                      ? d.payeurs[0].name
                      : `${d.payeurs.length} payeurs`}{" "}
                    · {new Date(d.date).toLocaleDateString("fr-FR")} ·{" "}
                    {CATEGORIES.find((c) => c.value === d.category)?.label ?? d.category}
                  </p>
                </div>
                <span className="font-mono text-sm">{d.amount.toFixed(2)} €</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
