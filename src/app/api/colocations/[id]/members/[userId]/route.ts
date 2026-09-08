import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import type { HouseholdMember } from "@/models/Household";

/** Retrait d'un membre par l'admin (section 4.2). */
export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/colocations/[id]/members/[userId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, userId: cibleId } = await ctx.params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (!isAdminMember(result.membership)) {
    return NextResponse.json(
      { error: "Seul l'admin peut retirer un membre" },
      { status: 403 }
    );
  }

  if (cibleId === session.user.id) {
    // Se retirer soi-meme passe par /leave, qui gere l'avertissement de
    // dette. Eviter une deuxieme voie de sortie qui le contournerait.
    return NextResponse.json(
      { error: "Utilise plutôt « quitter la colocation »" },
      { status: 400 }
    );
  }

  const { household } = result;
  const avant = household.members.length;
  household.members = household.members.filter(
    (m: HouseholdMember) => m.userId.toString() !== cibleId
  );

  if (household.members.length === avant) {
    return NextResponse.json({ error: "Ce membre n'en fait pas partie" }, { status: 404 });
  }

  await household.save();
  return NextResponse.json({ ok: true });
}

/**
 * Transfert volontaire du role admin (demande explicite de Tanguy, en
 * complement de la succession automatique dans /leave). Modele a un seul
 * admin a la fois : transferer, c'est a la fois promouvoir la cible ET se
 * retrograder soi-meme, pas ajouter un deuxieme admin.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/members/[userId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, userId: cibleId } = await ctx.params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (!isAdminMember(result.membership)) {
    return NextResponse.json(
      { error: "Seul l'admin peut transférer son rôle" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (body?.role !== "admin") {
    return NextResponse.json(
      { error: "Seule la valeur role: \"admin\" est prise en charge" },
      { status: 400 }
    );
  }

  if (cibleId === session.user.id) {
    return NextResponse.json({ error: "Tu es déjà admin" }, { status: 400 });
  }

  const { household } = result;
  const cible = household.members.find(
    (m: HouseholdMember) => m.userId.toString() === cibleId
  );
  if (!cible) {
    return NextResponse.json({ error: "Ce membre n'en fait pas partie" }, { status: 404 });
  }

  const moi = household.members.find(
    (m: HouseholdMember) => m.userId.toString() === session.user.id
  );
  if (moi) moi.role = "member";
  cible.role = "admin";

  await household.save();
  return NextResponse.json({ ok: true });
}
