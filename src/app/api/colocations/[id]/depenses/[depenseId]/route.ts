import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  getExpenseInHousehold,
  repartirEgalement,
  repartirParPourcentages,
  sommeSplits,
  serializeExpenses,
  type Split,
} from "@/lib/expenses";
import type { HouseholdMember } from "@/models/Household";

const CATEGORIES = ["courses", "factures", "loyer", "sorties", "autre"] as const;

const editSchema = z.object({
  amount: z.number().positive(),
  description: z.string().trim().min(1, "Description requise").max(200),
  category: z.enum(CATEGORIES),
  date: z.string().datetime().optional(),
  payerId: z.string().optional(),
  splitType: z.enum(["equal", "custom"]),
  memberIds: z.array(z.string()).min(1).optional(),
  splits: z.array(z.object({ userId: z.string(), amount: z.number().nonnegative() })).optional(),
  pourcentages: z
    .array(z.object({ userId: z.string(), pourcentage: z.number().positive() }))
    .optional(),
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

  const payerId = data.payerId ?? acces.expense.payerId.toString();
  if (!estMembre(payerId)) {
    return NextResponse.json(
      { error: "Le payeur doit faire partie de la colocation" },
      { status: 400 }
    );
  }

  let splits: Split[];

  if (data.splitType === "equal") {
    if (!data.memberIds || data.memberIds.length === 0) {
      return NextResponse.json(
        { error: "Sélectionne au moins un participant" },
        { status: 400 }
      );
    }
    if (!data.memberIds.every(estMembre)) {
      return NextResponse.json(
        { error: "Un participant sélectionné ne fait pas partie de la colocation" },
        { status: 400 }
      );
    }
    splits = repartirEgalement(data.amount, data.memberIds);
  } else if (data.pourcentages && data.pourcentages.length > 0) {
    if (!data.pourcentages.every((p) => estMembre(p.userId))) {
      return NextResponse.json(
        { error: "Un participant sélectionné ne fait pas partie de la colocation" },
        { status: 400 }
      );
    }
    const total = data.pourcentages.reduce((s, p) => s + p.pourcentage, 0);
    if (Math.abs(total - 100) > 0.01) {
      return NextResponse.json(
        { error: `Les pourcentages doivent totaliser 100 (actuellement ${total})` },
        { status: 400 }
      );
    }
    splits = repartirParPourcentages(data.amount, data.pourcentages);
  } else if (data.splits && data.splits.length > 0) {
    if (!data.splits.every((s) => estMembre(s.userId))) {
      return NextResponse.json(
        { error: "Un participant sélectionné ne fait pas partie de la colocation" },
        { status: 400 }
      );
    }
    const somme = sommeSplits(data.splits);
    if (Math.abs(somme - data.amount) > 0.005) {
      return NextResponse.json(
        {
          error: `La somme des parts (${somme.toFixed(2)} €) ne correspond pas au montant (${data.amount.toFixed(2)} €)`,
        },
        { status: 400 }
      );
    }
    splits = data.splits;
  } else {
    return NextResponse.json(
      { error: "Répartition personnalisée manquante" },
      { status: 400 }
    );
  }

  const { expense } = acces;
  // new Types.ObjectId(...) plutot qu'assigner la string brute : le champ
  // est bien type ObjectId cote Mongoose, une string n'est pas assignable
  // telle quelle en TypeScript meme si Mongoose la caste sans probleme a
  // l'execution.
  expense.payerId = new Types.ObjectId(payerId);
  expense.amount = data.amount;
  expense.description = data.description;
  expense.category = data.category;
  if (data.date) expense.date = new Date(data.date);
  expense.splitType = data.splitType;
  // splits est un tableau de sous-documents Mongoose (DocumentArray), pas
  // de simples objets : Mongoose accepte un tableau brut en remplacement et
  // le convertit lui-meme, mais TypeScript n'a pas de type public pour "un
  // tableau assignable a ce DocumentArray" - c'est un frottement connu
  // TypeScript/Mongoose, pas une erreur qu'un autre typage eviterait ici.
  expense.splits = splits as unknown as typeof expense.splits;
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
