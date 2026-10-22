import { connectDB } from "@/lib/mongodb";
import { envoyerEmail, construireUrl } from "@/lib/email";
import { emailBienvenue, emailDepense } from "@/lib/email-templates";
import { remboursementsDepense } from "@/lib/settlements";
import HouseholdModel from "@/models/Household";
import UserModel from "@/models/User";

type Part = { userId: string; amount: number };

// Forme des utilisateurs lus avec .lean() (objets Mongo bruts, sans default).
type UtilisateurLu = {
  _id: { toString(): string };
  name?: string;
  email?: string;
  notificationsEmail?: boolean;
};

// ---------------------------------------------------------------------------
// Fonction pure
// ---------------------------------------------------------------------------

/**
 * Pour une depense : chaque personne qui DOIT de l'argent (d'apres
 * remboursementsDepense, pas de second algorithme) avec la liste de ce
 * qu'elle rembourse. L'auteur est exclu : il connait deja sa depense. Quelqu'un
 * qui ne doit rien (payeur, ou part deja avancee) n'apparait pas.
 */
export function destinatairesDepense(
  payers: Part[],
  splits: Part[],
  auteurId: string
): Map<string, { versUserId: string; montant: number }[]> {
  const resultat = new Map<string, { versUserId: string; montant: number }[]>();
  for (const r of remboursementsDepense(payers, splits)) {
    if (r.fromUserId === auteurId) continue;
    const liste = resultat.get(r.fromUserId) ?? [];
    liste.push({ versUserId: r.toUserId, montant: r.amount });
    resultat.set(r.fromUserId, liste);
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// Envois (effets de bord). Appeles dans after() : la reponse HTTP est deja
// partie et rien n'attraperait une exception. Elles NE LEVENT JAMAIS. Dans les
// logs : le nom de l'erreur seulement, jamais d'adresse ni de contenu.
// ---------------------------------------------------------------------------

/** Absent = active : les comptes anterieurs au champ n'ont pas de valeur en base. */
function veutLesNotifications(user: UtilisateurLu): boolean {
  return user.notificationsEmail !== false;
}

export async function notifierBienvenue(userId: string, householdId: string): Promise<void> {
  try {
    await connectDB();
    const [user, household] = await Promise.all([
      UserModel.findById(userId).select("email notificationsEmail").lean<UtilisateurLu>(),
      HouseholdModel.findById(householdId).select("name").lean<{ name?: string }>(),
    ]);
    if (!user || !household?.name) return;
    if (!veutLesNotifications(user) || !user.email) return;

    const mail = emailBienvenue({
      nomColocation: household.name,
      lien: construireUrl(`/colocations/${householdId}`),
      lienProfil: construireUrl("/profil"),
    });
    await envoyerEmail({ to: user.email, ...mail });
  } catch (e) {
    console.error(
      `[notifications] échec du mail de bienvenue : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
  }
}

export async function notifierNouvelleDepense(params: {
  householdId: string;
  auteurId: string;
  description: string;
  montant: number;
  payers: Part[];
  splits: Part[];
  depenseId?: string;
}): Promise<void> {
  try {
    const { householdId, auteurId, description, montant, payers, splits, depenseId } = params;

    const destinataires = destinatairesDepense(payers, splits, auteurId);
    if (destinataires.size === 0) return;

    // Une seule requete pour tout le monde : debiteurs (adresse, preference),
    // beneficiaires (nom dans la phrase) et auteur (nom). Pas de N+1.
    const ids = new Set<string>([auteurId, ...destinataires.keys()]);
    for (const remboursements of destinataires.values()) {
      for (const r of remboursements) ids.add(r.versUserId);
    }

    await connectDB();
    const [utilisateurs, household] = await Promise.all([
      UserModel.find({ _id: { $in: [...ids] } })
        .select("name email notificationsEmail")
        .lean<UtilisateurLu[]>(),
      HouseholdModel.findById(householdId).select("name").lean<{ name?: string }>(),
    ]);
    if (!household?.name) return;

    const parId = new Map(utilisateurs.map((u) => [u._id.toString(), u]));
    const nomDe = (userId: string) => parId.get(userId)?.name ?? "Utilisateur supprimé";

    const chemin = depenseId
      ? `/colocations/${householdId}/depenses/${depenseId}`
      : `/colocations/${householdId}`;
    const lien = construireUrl(chemin);
    const lienProfil = construireUrl("/profil");

    const envois: Promise<unknown>[] = [];
    for (const [debiteurId, remboursements] of destinataires) {
      const debiteur = parId.get(debiteurId);
      if (!debiteur || !debiteur.email || !veutLesNotifications(debiteur)) continue;

      const mail = emailDepense({
        auteur: nomDe(auteurId),
        description,
        montant,
        nomColocation: household.name,
        remboursements: remboursements.map((r) => ({
          versNom: nomDe(r.versUserId),
          montant: r.montant,
        })),
        lien,
        lienProfil,
      });
      envois.push(envoyerEmail({ to: debiteur.email, ...mail }));
    }
    await Promise.allSettled(envois);
  } catch (e) {
    console.error(
      `[notifications] échec des mails de dépense : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
  }
}
