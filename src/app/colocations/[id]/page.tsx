import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { donneesDashboard } from "@/lib/dashboard";
import {
  getHouseholdForMember,
  isAdminMember,
  serializeHousehold,
} from "@/lib/households";
import ColocationClient from "./ColocationClient";
import DashboardColocation from "./DashboardColocation";

export default async function ColocationDetailPage({
  params,
  searchParams,
}: PageProps<"/colocations/[id]">) {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  const { id } = await params;
  const sp = await searchParams;
  const result = await getHouseholdForMember(id, session.user.id);
  // 404 dans les deux cas (colocation inexistante OU pas membre) : ne pas
  // laisser deviner qu'une colocation existe a quelqu'un qui n'en fait pas
  // partie.
  if (!result) notFound();

  // ?mois=a&mois=b donnerait un tableau : on l'ignore comme une valeur mal
  // formee, parserMois retombe alors sur le mois courant.
  const moisParam = typeof sp.mois === "string" ? sp.mois : undefined;

  const [detail, donnees] = await Promise.all([
    serializeHousehold(result.household, session.user.id),
    donneesDashboard(id, moisParam, session.user.id, isAdminMember(result.membership)),
  ]);

  return (
    <ColocationClient
      initial={detail}
      apercu={
        <DashboardColocation
          donnees={donnees}
          householdId={id}
          viewerId={session.user.id}
        />
      }
    />
  );
}
