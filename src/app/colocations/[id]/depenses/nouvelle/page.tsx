import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, serializeHousehold } from "@/lib/households";
import DepenseForm from "../DepenseForm";

export default async function NouvelleDepensePage({
  params,
}: PageProps<"/colocations/[id]/depenses/nouvelle">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) notFound();

  const detail = await serializeHousehold(result.household, session.user.id);

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Nouvelle dépense</h1>
      <p className="mt-1 text-sm text-zinc-500">{detail.name}</p>

      <div className="mt-6">
        <DepenseForm
          householdId={id}
          membres={detail.members}
          moi={session.user.id}
        />
      </div>
    </main>
  );
}
