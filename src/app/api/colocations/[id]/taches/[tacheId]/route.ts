import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import {
  changerStatutTache,
  echeanceChangee,
  estObjectIdValide,
  getTaskInHousehold,
  peutChangerStatut,
  peutModifierTache,
  serializeTasks,
  validerAssignesEtRotation,
} from "@/lib/tasks";
import { champsTache } from "@/lib/tasks-schemas";
import type { HouseholdMember } from "@/models/Household";

// Tous les champs sont optionnels : le Kanban n'envoie que { status } quand on
// deplace une carte, le formulaire d'edition envoie les champs de contenu.
// Pas de .default() ici (voir tasks-schemas.ts). dueDate: null efface l'echeance.
const editSchema = z.object({
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  title: champsTache.title.optional(),
  description: champsTache.description.optional(),
  assignedTo: champsTache.assignedTo.optional(),
  recurrence: champsTache.recurrence.optional(),
  rotation: champsTache.rotation.optional(),
  dueDate: champsTache.dueDate.nullable().optional(),
});

/** Charge colocation + tache en renvoyant 404 pour tout id inconnu ou mal forme. */
async function charger(householdId: string, tacheId: string, userId: string) {
  if (!estObjectIdValide(householdId) || !estObjectIdValide(tacheId)) return null;

  const result = await getHouseholdForMember(householdId, userId);
  if (!result) return null;

  const tache = await getTaskInHousehold(householdId, tacheId);
  if (!tache) return null;

  return { result, tache };
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/taches/[tacheId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }
  const userId = session.user.id;

  const { id, tacheId } = await ctx.params;
  const acces = await charger(id, tacheId, userId);
  if (!acces) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const { result, tache } = acces;
  const estAdmin = isAdminMember(result.membership);

  const body = await request.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Zod retire les cles inconnues : un corps vide ou sans aucun champ connu
  // arrive ici comme un objet vide.
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 });
  }

  // Un "changement" de statut vers le statut deja en place n'est pas un
  // changement : pas de droit a exiger (et changerStatutTache l'ignore).
  const changeLeStatut = data.status !== undefined && data.status !== tache.status;
  const changeLeContenu =
    data.title !== undefined ||
    data.description !== undefined ||
    data.assignedTo !== undefined ||
    data.recurrence !== undefined ||
    data.rotation !== undefined ||
    data.dueDate !== undefined;

  // Droits verifies sur l'etat AVANT modification, donc avant de toucher aux
  // assignes : on ne peut pas se donner le droit de deplacer une tache en
  // s'y assignant dans la meme requete.
  if (changeLeContenu && !peutModifierTache(tache.createdBy.toString(), userId, estAdmin)) {
    return NextResponse.json(
      { error: "Seuls le créateur de la tâche ou l'admin peuvent la modifier" },
      { status: 403 }
    );
  }
  const assignesActuels = tache.assignedTo.map((a: { toString(): string }) => a.toString());
  if (changeLeStatut && !peutChangerStatut(assignesActuels, userId, estAdmin)) {
    return NextResponse.json(
      { error: "Seuls les assignés ou l'admin peuvent changer le statut de cette tâche" },
      { status: 403 }
    );
  }

  if (changeLeContenu) {
    const { household } = result;
    const assignedTo = data.assignedTo ? [...new Set(data.assignedTo)] : undefined;
    // On valide les valeurs FINALES (champ recu, sinon valeur stockee) : passer
    // la recurrence a "none" alors que la rotation est deja active doit etre
    // refuse, et activer la rotation sur une tache "none" aussi. Les assignes
    // ne sont verifies que s'ils sont modifies (ceux d'avant ont ete nettoyes
    // a leur depart par retirerMembreDesTaches).
    const erreur = validerAssignesEtRotation(
      {
        assignedTo: assignedTo ?? [],
        recurrence: data.recurrence ?? tache.recurrence,
        rotation: data.rotation ?? tache.rotation,
      },
      (uid) => household.members.some((m: HouseholdMember) => m.userId.toString() === uid)
    );
    if (erreur) {
      return NextResponse.json({ error: erreur }, { status: 400 });
    }

    if (data.title !== undefined) tache.title = data.title;
    // Chaine vide = effacer la description (meme convention qu'a la creation).
    if (data.description !== undefined) tache.description = data.description || undefined;
    if (assignedTo) tache.assignedTo = assignedTo as unknown as typeof tache.assignedTo;
    if (data.recurrence !== undefined) tache.recurrence = data.recurrence;
    if (data.rotation !== undefined) tache.rotation = data.rotation;
    if (data.dueDate !== undefined) {
      const nouvelleEcheance = data.dueDate === null ? undefined : new Date(data.dueDate);
      // Nouvelle echeance = nouveau rappel possible (sinon une tache deja
      // rappelee puis repoussee ne previendrait plus personne).
      if (echeanceChangee(tache.dueDate, nouvelleEcheance)) tache.rappelEnvoye = false;
      tache.dueDate = nouvelleEcheance;
    }
    await tache.save();
  }

  // Le statut passe par changerStatutTache, qui gere completedAt/completedBy
  // et la creation de la prochaine occurrence. Fait APRES le contenu : une
  // tache terminee dans la meme requete qu'une modif de recurrence cree
  // l'occurrence suivante avec les valeurs a jour.
  let tacheFinale = tache;
  let nouvelleOccurrence = null;
  if (changeLeStatut && data.status) {
    const resultat = await changerStatutTache(tache, data.status, userId);
    tacheFinale = resultat.tache;
    nouvelleOccurrence = resultat.nouvelleOccurrence;
  }

  // Une seule requete groupee pour les noms des deux taches.
  const serialisees = await serializeTasks(
    nouvelleOccurrence ? [tacheFinale, nouvelleOccurrence] : [tacheFinale],
    userId,
    estAdmin
  );
  return NextResponse.json({
    tache: serialisees[0],
    nouvelleOccurrence: nouvelleOccurrence ? serialisees[1] : null,
  });
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/colocations/[id]/taches/[tacheId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, tacheId } = await ctx.params;
  const acces = await charger(id, tacheId, session.user.id);
  if (!acces) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (
    !peutModifierTache(
      acces.tache.createdBy.toString(),
      session.user.id,
      isAdminMember(acces.result.membership)
    )
  ) {
    return NextResponse.json(
      { error: "Seuls le créateur de la tâche ou l'admin peuvent la supprimer" },
      { status: 403 }
    );
  }

  await acces.tache.deleteOne();
  return NextResponse.json({ ok: true });
}
