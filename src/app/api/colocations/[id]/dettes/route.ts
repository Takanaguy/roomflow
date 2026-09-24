import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember } from "@/lib/households";
import { confirmerReglement } from "@/lib/settlements";

const bodySchema = z.object({ fromUserId: z.string() });

/**
 * Seule action possible sur les dettes : confirmer un remboursement recu.
 * Pas de GET ici - la page /colocations/[id]/dettes lit directement via
 * calculerDettesSimplifiees (Server Component), comme les autres pages de
 * la colocation.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/dettes">
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

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  // toUserId = celui qui confirme, jamais fourni par le client : seul le
  // crediteur reel peut confirmer avoir recu son propre argent.
  const resultat = await confirmerReglement(id, parsed.data.fromUserId, session.user.id);
  if (!resultat.ok) {
    return NextResponse.json({ error: resultat.erreur }, { status: 400 });
  }

  return NextResponse.json({ ok: true, amount: resultat.amount });
}
