import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  repartirEgalement,
  repartirParPourcentages,
  sommeSplits,
  serializeExpenses,
  type Split,
} from "@/lib/expenses";
import ExpenseModel from "@/models/Expense";
import type { HouseholdMember } from "@/models/Household";

const CATEGORIES = ["courses", "factures", "loyer", "sorties", "autre"] as const;

const createSchema = z.object({
  amount: z.number().positive(),
  description: z.string().trim().min(1, "Description requise").max(200),
  category: z.enum(CATEGORIES),
  date: z.string().datetime().optional(),
  payerId: z.string().optional(),
  splitType: z.enum(["equal", "custom"]),
  // "equal" : qui participe au partage.
  memberIds: z.array(z.string()).min(1).optional(),
  // "custom" : montants exacts saisis a la main.
  splits: z.array(z.object({ userId: z.string(), amount: z.number().nonnegative() })).optional(),
  // "custom", variante pourcentages (4.3 : "montants OU pourcentages").
  pourcentages: z
    .array(z.object({ userId: z.string(), pourcentage: z.number().positive() }))
    .optional(),
});

export async function GET(request: Request, ctx: RouteContext<"/api/colocations/[id]/depenses">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const memberId = url.searchParams.get("membre");
  const from = url.searchParams.get("depuis");
  const to = url.searchParams.get("jusqua");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filtre Mongo, forme variable selon les parametres presents
  const filtre: any = { householdId: id };
  if (category) filtre.category = category;
  if (memberId) {
    filtre.$or = [{ payerId: memberId }, { "splits.userId": memberId }];
  }
  if (from || to) {
    filtre.date = {};
    if (from) filtre.date.$gte = new Date(from);
    if (to) filtre.date.$lte = new Date(to);
  }

  await connectDB();
  const expenses = await ExpenseModel.find(filtre).sort({ date: -1 });

  return NextResponse.json(
    await serializeExpenses(expenses, session.user.id, isAdminMember(result.membership))
  );
}

export async function POST(request: Request, ctx: RouteContext<"/api/colocations/[id]/depenses">) {
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const { household } = result;
  const estMembre = (userId: string) =>
    household.members.some((m: HouseholdMember) => m.userId.toString() === userId);

  const payerId = data.payerId ?? session.user.id;
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
  } else {
    if (data.pourcentages && data.pourcentages.length > 0) {
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
  }

  await connectDB();
  const expense = await ExpenseModel.create({
    householdId: id,
    payerId,
    createdBy: session.user.id,
    amount: data.amount,
    description: data.description,
    category: data.category,
    date: data.date ? new Date(data.date) : new Date(),
    splitType: data.splitType,
    splits,
  });

  const [serialized] = await serializeExpenses(
    [expense],
    session.user.id,
    isAdminMember(result.membership)
  );
  return NextResponse.json(serialized, { status: 201 });
}
