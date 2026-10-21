import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { getExpenseInHousehold, serializeExpenses } from "@/lib/expenses";
import { remboursementsDepense } from "@/lib/settlements";
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

  // Noms pour la section "Qui rembourse qui" : tout le monde est deja dans
  // payeurs ou splits, pas besoin d'une requete de plus.
  const nomParId = new Map(
    [...detail.payeurs, ...detail.splits].map((u) => [u.userId, u.name])
  );
  const nom = (userId: string) => nomParId.get(userId) ?? "Utilisateur supprimé";
  const remboursements = remboursementsDepense(detail.payeurs, detail.splits);
  const viewerId = session.user.id;

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

      <p className="mt-6 text-sm text-zinc-600">
        Ajouté par <span className="font-medium text-zinc-900">{detail.creePar.name}</span>
      </p>

      <h2 className="mt-6 text-sm font-medium text-zinc-500">
        {detail.payeurs.length === 1 ? "Payé par" : "Payé par (plusieurs personnes)"}
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {detail.payeurs.map((p) => (
          <li
            key={p.userId}
            className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-zinc-50"
          >
            <span>{p.name}</span>
            <span className="font-mono text-sm">{p.amount.toFixed(2)} €</span>
          </li>
        ))}
      </ul>

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
              {detail.payeurs.some((p) => p.userId === s.userId) && (
                <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                  a payé
                </span>
              )}
            </span>
            <span className="font-mono text-sm">{s.amount.toFixed(2)} €</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-medium text-zinc-500">Qui rembourse qui</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Pour cette dépense seulement. Pour régler, la page «{" "}
        <Link href={`/colocations/${id}/dettes`} className="underline hover:text-zinc-700">
          Qui doit quoi
        </Link>{" "}
        » de la colocation additionne toutes les dépenses.
      </p>
      {remboursements.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600">
          Aucun remboursement : chacun a avancé exactement sa part.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {remboursements.map((r) => {
            const jeDois = r.fromUserId === viewerId;
            const onMeDoit = r.toUserId === viewerId;
            const montant = <span className="font-mono">{r.amount.toFixed(2)} €</span>;
            return (
              <li
                key={`${r.fromUserId}-${r.toUserId}`}
                className="rounded-md px-3 py-2 text-sm hover:bg-zinc-50"
              >
                {jeDois && (
                  <>
                    Tu dois {montant} à <span className="font-medium">{nom(r.toUserId)}</span>
                  </>
                )}
                {onMeDoit && (
                  <>
                    <span className="font-medium">{nom(r.fromUserId)}</span> te doit {montant}
                  </>
                )}
                {!jeDois && !onMeDoit && (
                  <>
                    <span className="font-medium">{nom(r.fromUserId)}</span> doit {montant} à{" "}
                    <span className="font-medium">{nom(r.toUserId)}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {detail.peuxModifier && (
        <DepenseActions householdId={id} depenseId={depenseId} />
      )}
    </main>
  );
}
