import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember, promouvoirDoyen } from "@/lib/households";
import { sauvegarderSiPasEnDestruction, planifierSuppressionVide } from "@/lib/nettoyage";
import { envoiReelPossible } from "@/lib/nettoyage-cron";
import { notifierColocationVidee } from "@/lib/notifications";
import { aUneDetteEnCours } from "@/lib/settlements";
import { retirerMembreDesTaches } from "@/lib/tasks";
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

  // Colocation de demonstration : ses membres (dont le compte demo, admin) ne
  // peuvent ni la detruire, ni la quitter, ni changer ses membres ou son admin.
  if (result.household.demo === true) {
    return NextResponse.json(
      { error: "Cette action est désactivée sur la colocation de démonstration." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { force } = bodySchema.parse(body ?? {});

  // Section 4.2 : avertir avant de laisser quitter avec une dette en cours,
  // pas bloquer definitivement. force=true (apres confirmation cote client)
  // outrepasse l'avertissement.
  if (!force) {
    const dette = await aUneDetteEnCours(id, session.user.id);
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

  // Refuse si le cron est en train de detruire la colocation : ce depart ne
  // doit alors ni s'ecrire, ni planifier, ni envoyer d'email.
  if (!(await sauvegarderSiPasEnDestruction(household))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  // Apres la sauvegarde seulement : si elle echoue, la personne reste membre
  // et doit garder ses taches. Sinon on laisserait des assignes fantomes.
  await retirerMembreDesTaches(id, session.user.id);

  // Colocation vidée par ce départ : on planifie sa suppression puis on prévient
  // la personne partie (seul moment où on sait qui c'est). Si rien n'est écrit
  // (démo, ou quelqu'un a rejoint entre-temps), aucun email ne part. Le try
  // protège la réponse : le départ est déjà fait, un souci de planification
  // ne doit pas le faire passer pour un échec. Sans envoi d'email réellement
  // possible (pas de domaine vérifié en production), on ne planifie rien : la
  // personne partie ne pourrait pas être prévenue, la suppression serait sans
  // préavis réel. Le panneau admin montre quand même la colocation vide.
  if (household.members.length === 0 && !envoiReelPossible(process.env)) {
    console.log("[colocations] colocation vidée, aucune planification : envoi d'email réel impossible");
  } else if (household.members.length === 0) {
    try {
      const suppressionPrevueLe = await planifierSuppressionVide(id);
      if (suppressionPrevueLe) {
        const { name, inviteCode } = household;
        after(() =>
          notifierColocationVidee({
            userId: session.user.id,
            nomColocation: name,
            codeInvitation: inviteCode,
            suppressionPrevueLe,
          })
        );
      }
    } catch (e) {
      console.error(
        `[colocations] planification de suppression impossible : ${e instanceof Error ? e.name : "erreur inconnue"}`
      );
    }
  }

  return NextResponse.json({ ok: true });
}
