import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getHouseholdForMember, serializeHousehold } from "@/lib/households";
import ColocationClient from "./ColocationClient";

export default async function ColocationDetailPage({
  params,
}: PageProps<"/colocations/[id]">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const result = await getHouseholdForMember(id, session.user.id);
  // 404 dans les deux cas (colocation inexistante OU pas membre) : ne pas
  // laisser deviner qu'une colocation existe a quelqu'un qui n'en fait pas
  // partie.
  if (!result) notFound();

  const detail = await serializeHousehold(result.household, session.user.id);

  return <ColocationClient initial={detail} />;
}
