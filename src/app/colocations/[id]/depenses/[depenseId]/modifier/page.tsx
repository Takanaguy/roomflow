import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember, serializeHousehold } from "@/lib/households";
import { getExpenseInHousehold, serializeExpenses } from "@/lib/expenses";
import DepenseForm from "../../DepenseForm";

export default async function ModifierDepensePage({
  params,
}: PageProps<"/colocations/[id]/depenses/[depenseId]/modifier">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id, depenseId } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const expense = await getExpenseInHousehold(id, depenseId);
  if (!expense) notFound();

  const [detailDepense] = await serializeExpenses(
    [expense],
    session.user.id,
    isAdminMember(result.membership)
  );

  // Meme regle que l'API (403 cote route) : pas admin, pas auteur -> pas de
  // formulaire du tout, plutot qu'un formulaire qui echouerait a l'envoi.
  if (!detailDepense.peuxModifier) notFound();

  const detailColoc = await serializeHousehold(result.household, session.user.id);

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Modifier la dépense</h1>
      <p className="mt-1 text-sm text-zinc-500">{detailColoc.name}</p>

      <div className="mt-6">
        <DepenseForm
          householdId={id}
          membres={detailColoc.members}
          moi={session.user.id}
          initial={detailDepense}
        />
      </div>
    </main>
  );
}
