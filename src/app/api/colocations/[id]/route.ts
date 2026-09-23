import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember, serializeHousehold } from "@/lib/households";
import HouseholdModel from "@/models/Household";
import ExpenseModel from "@/models/Expense";

const editSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(80).optional(),
  description: z.string().trim().max(500).optional(),
});

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

/** Modifier le nom/la description (admin uniquement, demande de Tanguy). */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]">
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

  if (!isAdminMember(result.membership)) {
    return NextResponse.json(
      { error: "Seul l'admin peut modifier la colocation" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  const { household } = result;
  if (parsed.data.name !== undefined) household.name = parsed.data.name;
  if (parsed.data.description !== undefined) {
    household.description = parsed.data.description;
  }
  await household.save();

  return NextResponse.json(
    await serializeHousehold(household, session.user.id)
  );
}

/**
 * Destruction definitive (admin uniquement) - demande explicitement par
 * Tanguy comme SEULE facon de vraiment supprimer une colocation ; quitter
 * ne fait que la vider (voir promouvoirDoyen / join pour ce qui se passe
 * quand elle se vide toute seule).
 *
 * Cascade sur Expense depuis le lot 4 (constate en testant : une colocation
 * detruite laissait ses depenses orphelines en base, sans plus aucune
 * colocation pour les referencer). ⚠ TODO lots 6-7 : ajouter Task et
 * ShoppingItem ici des qu'ils existent, meme raison.
 */
export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/colocations/[id]">
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

  if (!isAdminMember(result.membership)) {
    return NextResponse.json(
      { error: "Seul l'admin peut détruire la colocation" },
      { status: 403 }
    );
  }

  await ExpenseModel.deleteMany({ householdId: id });
  await HouseholdModel.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}
