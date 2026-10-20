import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  estObjectIdValide,
  serializeTasks,
  validerAssignesEtRotation,
} from "@/lib/tasks";
import { champsTache } from "@/lib/tasks-schemas";
import TaskModel from "@/models/Task";
import type { HouseholdMember } from "@/models/Household";

const createSchema = z.object({
  title: champsTache.title,
  description: champsTache.description.optional(),
  assignedTo: champsTache.assignedTo.default([]),
  recurrence: champsTache.recurrence.default("none"),
  rotation: champsTache.rotation.default(false),
  dueDate: champsTache.dueDate.optional(),
});

/**
 * Creation d'une tache : tout membre peut en creer une. Pas de GET ici, la
 * page Kanban lit directement la base (listerTachesKanban), comme la vue des
 * dettes : les routes ne servent qu'aux modifications.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/taches">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Id mal forme : meme reponse qu'une colocation inconnue, sans CastError.
  if (!estObjectIdValide(id)) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
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
  const assignedTo = [...new Set(data.assignedTo)];
  const erreur = validerAssignesEtRotation(
    { assignedTo, recurrence: data.recurrence, rotation: data.rotation },
    (userId) => household.members.some((m: HouseholdMember) => m.userId.toString() === userId)
  );
  if (erreur) {
    return NextResponse.json({ error: erreur }, { status: 400 });
  }

  await connectDB();
  const tache = await TaskModel.create({
    householdId: id,
    title: data.title,
    // Une description vide n'est pas stockee : "" et "pas de description"
    // doivent etre la meme chose a l'affichage.
    ...(data.description ? { description: data.description } : {}),
    assignedTo,
    status: "todo",
    recurrence: data.recurrence,
    rotation: data.rotation,
    createdBy: session.user.id,
    ...(data.dueDate ? { dueDate: new Date(data.dueDate) } : {}),
  });

  const [serialisee] = await serializeTasks(
    [tache],
    session.user.id,
    isAdminMember(result.membership)
  );
  return NextResponse.json(serialisee, { status: 201 });
}
