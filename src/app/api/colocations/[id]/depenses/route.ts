import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  construireRepartitionInput,
  resoudreRepartition,
  serializeExpenses,
} from "@/lib/expenses";
import ExpenseModel from "@/models/Expense";
import type { HouseholdMember } from "@/models/Household";

const CATEGORIES = ["courses", "factures", "loyer", "sorties", "autre"] as const;
const partSchema = z.object({ userId: z.string(), amount: z.number().nonnegative() });
const pourcentageSchema = z.object({ userId: z.string(), pourcentage: z.number().positive() });

const createSchema = z.object({
  amount: z.number().positive(),
  description: z.string().trim().min(1, "Description requise").max(200),
  category: z.enum(CATEGORIES),
  date: z.string().datetime().optional(),
  // Qui a avance l'argent - un seul payeur est juste le cas particulier
  // "equal" avec une seule personne dans payerMemberIds. Meme forme que
  // pour la repartition de qui doit, prefixee "payer".
  payerMemberIds: z.array(z.string()).min(1).optional(),
  payerSplits: z.array(partSchema).optional(),
  payerPourcentages: z.array(pourcentageSchema).optional(),
  // Qui doit quoi.
  splitType: z.enum(["equal", "custom"]),
  memberIds: z.array(z.string()).min(1).optional(),
  splits: z.array(partSchema).optional(),
  pourcentages: z.array(pourcentageSchema).optional(),
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
    filtre.$or = [{ "payers.userId": memberId }, { "splits.userId": memberId }];
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

  // Sans indication, "j'ai paye" reste le cas par defaut (le plus courant).
  const payeursInput =
    construireRepartitionInput({
      memberIds: data.payerMemberIds ?? [session.user.id],
      splits: data.payerSplits,
      pourcentages: data.payerPourcentages,
    }) ?? { type: "equal" as const, memberIds: [session.user.id] };

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

  await connectDB();
  const expense = await ExpenseModel.create({
    householdId: id,
    payers: payeursResultat.parts,
    createdBy: session.user.id,
    amount: data.amount,
    description: data.description,
    category: data.category,
    date: data.date ? new Date(data.date) : new Date(),
    splitType: data.splitType,
    splits: owingResultat.parts,
  });

  const [serialized] = await serializeExpenses(
    [expense],
    session.user.id,
    isAdminMember(result.membership)
  );
  return NextResponse.json(serialized, { status: 201 });
}
