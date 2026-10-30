import { connectDB } from "@/lib/mongodb";
import { envoyerEmail, construireUrl } from "@/lib/email";
import {
  emailBienvenue,
  emailColocationInactive,
  emailColocationVidee,
  emailDepense,
} from "@/lib/email-templates";
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

/**
 * Previent la personne qui vient de vider une colocation qu'elle sera
 * supprimee, avec le code pour la sauver. Envoye MEME si l'utilisateur a
 * decoche « Recevoir les notifications par email » : comme les emails de
 * securite, il avertit d'une suppression de donnees, ce n'est pas une
 * notification de confort. L'adresse est relue en base a partir de l'id (email
 * actuel du compte), jamais fournie par le client.
 */
export async function notifierColocationVidee(params: {
  userId: string;
  nomColocation: string;
  codeInvitation: string;
  suppressionPrevueLe: Date;
}): Promise<void> {
  try {
    await connectDB();
    const user = await UserModel.findById(params.userId).select("email").lean<UtilisateurLu>();
    if (!user?.email) return;

    const mail = emailColocationVidee({
      nomColocation: params.nomColocation,
      suppressionPrevueLe: params.suppressionPrevueLe,
      codeInvitation: params.codeInvitation,
      lien: construireUrl("/colocations/rejoindre"),
    });
    await envoyerEmail({ to: user.email, ...mail });
  } catch (e) {
    console.error(
      `[notifications] échec du mail de colocation vidée : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
  }
}

/** Resultat d'un envoi groupe : de quoi savoir si TOUS les membres ont ete prevenus. */
export type ResultatAvertissement = { envoyes: number; destinataires: number };

/**
 * Previent TOUS les membres d'une colocation inactive qu'elle sera supprimee.
 * Les adresses sont relues en base a partir des membres de la colocation,
 * jamais fournies par l'appelant. Envoye MEME si un membre a decoche les
 * notifications (il avertit d'une suppression de donnees, comme le mail de
 * colocation videe).
 *
 * Renvoie le nombre d'envois reussis ET le nombre de destinataires : le cron ne
 * pose le plan de suppression que si les deux sont egaux (un seul membre non
 * prevenu suffit a ne rien ecrire, un double mail vaut mieux qu'une suppression
 * sans preavis). Les mails partent UN PAR UN : en parallele, la limite de debit
 * de Resend en ferait refuser une partie. Ne leve jamais ({0, 0} en cas
 * d'erreur de lecture).
 */
export async function notifierColocationInactive(params: {
  householdId: string;
  nomColocation: string;
  joursInactivite: number;
  suppressionPrevueLe: Date;
}): Promise<ResultatAvertissement> {
  try {
    await connectDB();
    const household = await HouseholdModel.findById(params.householdId)
      .select("members.userId")
      .lean<{ members?: { userId: { toString(): string } }[] }>();
    const idsMembres = (household?.members ?? []).map((m) => m.userId.toString());
    if (idsMembres.length === 0) return { envoyes: 0, destinataires: 0 };

    const utilisateurs = await UserModel.find({ _id: { $in: idsMembres } })
      .select("email")
      .lean<UtilisateurLu[]>();
    // Destinataires = comptes existants avec une adresse (l'email est
    // obligatoire sur User). Un id de membre sans compte est une reference
    // orpheline : personne a prevenir, et le compter bloquerait pour toujours
    // le plan de suppression de cette colocation.
    const adresses = utilisateurs.map((u) => u.email).filter((e): e is string => Boolean(e));
    const destinataires = adresses.length;
    if (destinataires === 0) return { envoyes: 0, destinataires: 0 };

    const mail = emailColocationInactive({
      nomColocation: params.nomColocation,
      joursInactivite: params.joursInactivite,
      suppressionPrevueLe: params.suppressionPrevueLe,
      lien: construireUrl(`/colocations/${params.householdId}`),
    });

    let envoyes = 0;
    for (const to of adresses) {
      const resultat = await envoyerEmail({ to, ...mail });
      if (resultat.ok) envoyes++;
    }
    return { envoyes, destinataires };
  } catch (e) {
    console.error(
      `[notifications] échec des mails de colocation inactive : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    return { envoyes: 0, destinataires: 0 };
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
