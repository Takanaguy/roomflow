import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  getHouseholdForMember,
  hasOutstandingDebt,
  promouvoirDoyen,
} from "@/lib/households";
import type { HouseholdMember } from "@/models/Household";

const bodySchema = z.object({ force: z.boolean().optional() });

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/leave">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { force } = bodySchema.parse(body ?? {});

  // Section 4.2 : avertir avant de laisser quitter avec une dette en cours,
  // pas bloquer definitivement. force=true (apres confirmation cote client)
  // outrepasse l'avertissement.
  if (!force) {
    const dette = await hasOutstandingDebt(id, session.user.id);
    if (dette) {
      return NextResponse.json(
        {
          warning:
            "Tu as des dépenses en cours dans cette colocation. Quitter quand même ?",
        },
        { status: 409 }
      );
    }
  }

  const { household, membership } = result;
  const etaitAdmin = membership.role === "admin";

  household.members = household.members.filter(
    (m: HouseholdMember) => m.userId.toString() !== session.user.id
  );

  // Succession automatique : voir promouvoirDoyen pour le pourquoi.
  if (etaitAdmin) {
    promouvoirDoyen(household.members);
  }

  await household.save();

  return NextResponse.json({ ok: true });
}
