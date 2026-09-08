import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getHouseholdForMember, serializeHousehold } from "@/lib/households";

export async function GET(_req: Request, ctx: RouteContext<"/api/colocations/[id]">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    // 404 dans les deux cas (colocation inexistante OU pas membre) : ne pas
    // laisser deviner qu'une colocation existe a quelqu'un qui n'en fait
    // pas partie.
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  return NextResponse.json(
    await serializeHousehold(result.household, session.user.id)
  );
}
