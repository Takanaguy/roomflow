import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
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
  if (!(await UserModel.exists({ _id: session.user.id }))) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const household = await HouseholdModel.findOne({
    inviteCode: parsed.data.inviteCode,
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
  await household.save();

  // Apres la reponse : un mail lent ou en echec ne doit ni retarder ni casser
  // l'arrivee dans la colocation. Seulement ici, apres un ajout reussi (pas
  // pour un deja-membre ni une erreur).
  const householdId = household._id.toString();
  after(() => notifierBienvenue(session.user.id, householdId));

  return NextResponse.json({ id: household._id.toString(), name: household.name });
}
