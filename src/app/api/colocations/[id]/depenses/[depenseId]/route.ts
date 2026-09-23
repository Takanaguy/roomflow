import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  construireRepartitionInput,
  getExpenseInHousehold,
  resoudreRepartition,
  serializeExpenses,
} from "@/lib/expenses";
import type { HouseholdMember } from "@/models/Household";

const CATEGORIES = ["courses", "factures", "loyer", "sorties", "autre"] as const;
const partSchema = z.object({ userId: z.string(), amount: z.number().nonnegative() });
const pourcentageSchema = z.object({ userId: z.string(), pourcentage: z.number().positive() });

const editSchema = z.object({
  amount: z.number().positive(),
  description: z.string().trim().min(1, "Description requise").max(200),
  category: z.enum(CATEGORIES),
  date: z.string().datetime().optional(),
  payerMemberIds: z.array(z.string()).min(1).optional(),
  payerSplits: z.array(partSchema).optional(),
  payerPourcentages: z.array(pourcentageSchema).optional(),
  splitType: z.enum(["equal", "custom"]),
  memberIds: z.array(z.string()).min(1).optional(),
  splits: z.array(partSchema).optional(),
  pourcentages: z.array(pourcentageSchema).optional(),
});

/** Charge la depense + verifie appartenance colocation/permission, partage par PATCH/DELETE. */
async function chargerAvecDroit(
  householdId: string,
  depenseId: string,
  userId: string
) {
  const result = await getHouseholdForMember(householdId, userId);
  if (!result) return { statut: 404 as const };

  const expense = await getExpenseInHousehold(householdId, depenseId);
  if (!expense) return { statut: 404 as const };

  const peuxModifier =
    expense.createdBy.toString() === userId || isAdminMember(result.membership);
  if (!peuxModifier) return { statut: 403 as const };

  return { statut: 200 as const, result, expense };
}

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/colocations/[id]/depenses/[depenseId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, depenseId } = await ctx.params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const expense = await getExpenseInHousehold(id, depenseId);
  if (!expense) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const [serialized] = await serializeExpenses(
    [expense],
    session.user.id,
    isAdminMember(result.membership)
  );
  return NextResponse.json(serialized);
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/depenses/[depenseId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, depenseId } = await ctx.params;
  const acces = await chargerAvecDroit(id, depenseId, session.user.id);
  if (acces.statut === 404) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  if (acces.statut === 403) {
    return NextResponse.json(
      { error: "Seuls l'auteur de la dépense ou l'admin peuvent la modifier" },
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
  const data = parsed.data;

  const { household } = acces.result;
  const estMembre = (userId: string) =>
    household.members.some((m: HouseholdMember) => m.userId.toString() === userId);

  const payeursInput = construireRepartitionInput({
    memberIds: data.payerMemberIds,
    splits: data.payerSplits,
    pourcentages: data.payerPourcentages,
  });
  if (!payeursInput) {
    return NextResponse.json({ error: "Payeur manquant" }, { status: 400 });
  }
  const payeursResultat = resoudreRepartition(data.amount, payeursInput, estMembre);
  if (!payeursResultat.ok) {
    return NextResponse.json({ error: payeursResultat.erreur }, { status: 400 });
  }

  const owingInput = construireRepartitionInput({
    memberIds: data.memberIds,
    splits: data.splits,
    pourcentages: data.pourcentages,
  });
  if (!owingInput) {
    return NextResponse.json({ error: "Répartition manquante" }, { status: 400 });
  }
  const owingResultat = resoudreRepartition(data.amount, owingInput, estMembre);
  if (!owingResultat.ok) {
    return NextResponse.json({ error: owingResultat.erreur }, { status: 400 });
  }

  const { expense } = acces;
  expense.amount = data.amount;
  expense.description = data.description;
  expense.category = data.category;
  if (data.date) expense.date = new Date(data.date);
  expense.splitType = data.splitType;
  // payers/splits sont des tableaux de sous-documents Mongoose
  // (DocumentArray), pas de simples objets : Mongoose accepte un tableau
  // brut en remplacement et le convertit lui-meme, mais TypeScript n'a pas
  // de type public pour "un tableau assignable a ce DocumentArray" - c'est
  // un frottement connu TypeScript/Mongoose, pas une erreur qu'un autre
  // typage eviterait ici.
  expense.payers = payeursResultat.parts as unknown as typeof expense.payers;
  expense.splits = owingResultat.parts as unknown as typeof expense.splits;
  await expense.save();

  const [serialized] = await serializeExpenses(
    [expense],
    session.user.id,
    isAdminMember(acces.result.membership)
  );
  return NextResponse.json(serialized);
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/colocations/[id]/depenses/[depenseId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, depenseId } = await ctx.params;
  const acces = await chargerAvecDroit(id, depenseId, session.user.id);
  if (acces.statut === 404) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  if (acces.statut === 403) {
    return NextResponse.json(
      { error: "Seuls l'auteur de la dépense ou l'admin peuvent la supprimer" },
      { status: 403 }
    );
  }

  await acces.expense.deleteOne();
  return NextResponse.json({ ok: true });
}
