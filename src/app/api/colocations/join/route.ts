import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import { filtreHorsDestruction, sauvegarderSiPasEnDestruction } from "@/lib/nettoyage";
import { notifierBienvenue } from "@/lib/notifications";
import HouseholdModel, { type HouseholdMember } from "@/models/Household";
import UserModel from "@/models/User";

const joinSchema = z.object({
  inviteCode: z.string().trim().min(1, "Code requis"),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  await connectDB();
  // Un compte supprime garde une session valide jusqu'a la prochaine
  // reverification du jeton (5 minutes au plus) : il ne doit pas pouvoir
  // reapparaitre comme membre d'une colocation pendant ce delai.
  const compte = await UserModel.findById(session.user.id)
    .select("demo")
    .lean<{ demo?: boolean }>();
  if (!compte) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }
  // Compte de demonstration (lu en base, `.lean()` n'applique pas le defaut) :
  // pas d'autre colocation, pour que la remise a zero de nuit ne detruise jamais
  // une colocation contenant de vraies personnes.
  if (compte.demo === true) {
    return NextResponse.json(
      { error: "Le compte de démonstration ne peut pas créer ou rejoindre d'autres colocations." },
      { status: 403 }
    );
  }

  // Une colocation en cours de destruction par le cron (verrou de moins de
  // 10 minutes) reçoit la même réponse qu'un code invalide : la rejoindre
  // maintenant ne servirait à rien, ses données sont en train d'être effacées.
  const household = await HouseholdModel.findOne({
    inviteCode: parsed.data.inviteCode,
    // La colocation de demonstration ne se rejoint jamais (sa remise a zero
    // nocturne detruirait les donnees du nouvel arrivant) : meme reponse qu'un
    // code invalide.
    demo: { $ne: true },
    ...filtreHorsDestruction(new Date()),
  });
  if (!household) {
    return NextResponse.json({ error: "Code invalide" }, { status: 404 });
  }

  const dejaMembre = household.members.some(
    (m: HouseholdMember) => m.userId.toString() === session.user.id
  );
  if (dejaMembre) {
    return NextResponse.json(
      { error: "Tu es déjà membre de cette colocation" },
      { status: 409 }
    );
  }

  // Cas rare mais possible : l'admin est parti (promouvoirDoyen n'a rien pu
  // promouvoir, la liste etait vide) et la colocation n'a plus personne.
  // Le prochain arrivant devient admin plutot que de laisser la colocation
  // durablement sans personne pour la gerer.
  const role = household.members.length === 0 ? "admin" : "member";
  household.members.push({ userId: session.user.id, role, joinedAt: new Date() });
  // Rejoindre sauve la colocation du nettoyage, que le plan soit « vide » ou
  // « inactive ». Mettre un champ à undefined fait écrire un $unset dans le
  // MÊME save que l'ajout du membre : une seule opération, rien d'intermédiaire.
  household.videDepuis = undefined;
  household.avertieLe = undefined;
  household.suppressionPrevueLe = undefined;
  household.motifSuppression = undefined;
  // Un verrou périmé (passage du cron planté) ne doit pas rester sur une colocation vivante.
  household.destructionDebut = undefined;
  // Le save() ne filtre que sur _id : le verrou est donc re-verifie au moment
  // de l'ecriture, pour qu'une arrivee ne s'ajoute pas a une colocation dont
  // la destruction vient de commencer.
  if (!(await sauvegarderSiPasEnDestruction(household))) {
    return NextResponse.json({ error: "Code invalide" }, { status: 404 });
  }

  // Apres la reponse : un mail lent ou en echec ne doit ni retarder ni casser
  // l'arrivee dans la colocation. Seulement ici, apres un ajout reussi (pas
  // pour un deja-membre ni une erreur).
  const householdId = household._id.toString();
  after(() => notifierBienvenue(session.user.id, householdId));

  return NextResponse.json({ id: household._id.toString(), name: household.name });
}
