import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { detruireColocation, promouvoirDoyen } from "@/lib/households";
import { cleEmail, reinitialiserCompteur } from "@/lib/login-limiter";
import { abandonnerCreances, calculerSoldesNets } from "@/lib/settlements";
import { retirerMembreDesTaches } from "@/lib/tasks";
import ExpenseModel from "@/models/Expense";
import HouseholdModel, { type HouseholdMember } from "@/models/Household";
import PasswordResetTokenModel from "@/models/PasswordResetToken";
import SettlementModel from "@/models/Settlement";
import UserModel from "@/models/User";

/**
 * Suppression de compte (lot de durcissement de la securite). Regles validees
 * par Tanguy : suppression BLOQUEE tant que l'utilisateur doit de l'argent dans
 * une colocation ; ce qu'on lui doit est abandonne apres confirmation
 * explicite ; l'historique des autres (depenses, remboursements, taches)
 * reste, affiche au nom de "Utilisateur supprimé".
 */

/** Un compte Google/GitHub n'a pas de mot de passe : on exige une connexion de moins de 10 minutes. */
export const RECENCE_CONNEXION_MINUTES = 10;

/**
 * Duree au-dela de laquelle un verrou de suppression est considere comme
 * abandonne (processus coupe en plein travail) et peut etre repris.
 */
export const DUREE_VERROU_SUPPRESSION_MINUTES = 10;

const DUREE_VERROU_MS = DUREE_VERROU_SUPPRESSION_MINUTES * 60_000;

export type SoldeColocation = { householdId: string; nom: string; montant: number };

export type ColocationDuCompte = {
  id: string;
  nom: string;
  estDernierMembre: boolean;
  estAdmin: boolean;
};

export type EvaluationSuppression = {
  /**
   * montant en euros, positif : ce que l'utilisateur doit. Peut concerner une
   * colocation qu'il a deja quittee (absente de `colocations`).
   */
  dettes: SoldeColocation[];
  /** montant en euros, positif : ce qu'on lui doit (abandonne a la suppression). Meme remarque. */
  creances: SoldeColocation[];
  /** Colocations dont il est ENCORE membre (celles qu'il va quitter). */
  colocations: ColocationDuCompte[];
  peutSupprimer: boolean;
};

export type ProviderCompte = "credentials" | "google" | "github";

export type ResultatSuppression =
  | { ok: true }
  | { ok: false; raison: "en_cours" }
  | { ok: false; raison: "dettes"; dettes: SoldeColocation[] }
  | { ok: false; raison: "creances"; creances: SoldeColocation[] };

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/**
 * Date absente ou illisible = pas recente. Une connexion datee dans le FUTUR
 * (horloges decalees, jeton bricole) est aussi refusee par prudence : on ne
 * sait pas mesurer son anciennete. A exactement 10 minutes, encore recente.
 */
export function connexionRecente(connecteLe: number | undefined, maintenant: number): boolean {
  if (typeof connecteLe !== "number" || !Number.isFinite(connecteLe)) return false;
  const ecartMs = maintenant - connecteLe;
  if (ecartMs < 0) return false;
  return ecartMs <= RECENCE_CONNEXION_MINUTES * 60_000;
}

/**
 * Separe les soldes par colocation en dettes (solde negatif) et creances
 * (solde positif), montants en valeur absolue arrondis au centime. Un ecart
 * sous le centime est ignore : il ne doit ni bloquer la suppression ni
 * demander d'abandonner "0,00 €". L'ordre d'entree est conserve.
 */
export function classerSoldes(soldes: SoldeColocation[]): {
  dettes: SoldeColocation[];
  creances: SoldeColocation[];
} {
  const dettes: SoldeColocation[] = [];
  const creances: SoldeColocation[] = [];
  for (const s of soldes) {
    if (Math.abs(s.montant) < 0.01) continue;
    const ligne = {
      householdId: s.householdId,
      nom: s.nom,
      montant: Math.round(Math.abs(s.montant) * 100) / 100,
    };
    if (s.montant < 0) dettes.push(ligne);
    else if (s.montant > 0) creances.push(ligne);
  }
  return { dettes, creances };
}

/** Une seule dette, dans n'importe quelle colocation, suffit a bloquer. */
export function peutSupprimer(dettes: unknown[]): boolean {
  return dettes.length === 0;
}

/**
 * Meme regle que le filtre Mongo de supprimerCompte : le verrou est libre
 * s'il est absent (ou null), ou pose il y a STRICTEMENT plus de
 * DUREE_VERROU_SUPPRESSION_MINUTES. Une date illisible est traitee comme
 * absente (sinon la suppression serait bloquee pour toujours ; notre code
 * n'ecrit que new Date()). Une date dans le futur n'est pas prenable avant
 * que l'horloge l'ait depassee de la duree du verrou, comme `$lt` en base.
 */
export function verrouPrenable(
  suppressionDebut: Date | null | undefined,
  maintenant: Date
): boolean {
  if (!(suppressionDebut instanceof Date)) return true;
  const debut = suppressionDebut.getTime();
  if (Number.isNaN(debut)) return true;
  return debut < maintenant.getTime() - DUREE_VERROU_MS;
}

// ---------------------------------------------------------------------------
// Base de donnees
// ---------------------------------------------------------------------------

type ColocationLue = {
  _id: { toString(): string };
  name: string;
  members: { userId: { toString(): string }; role: string }[];
};

/**
 * Colocations ou l'utilisateur a un solde possible, trouvees PAR LES DONNEES
 * et non par l'appartenance : quelqu'un qui est parti avec une dette (bouton
 * "Quitter quand meme") ou qui a ete retire par l'admin n'est plus membre,
 * mais ses depenses et remboursements comptent toujours. Union des
 * colocations de ses depenses (payeur ou participant), de ses remboursements
 * (dans un sens ou dans l'autre) et de celles dont il est membre.
 */
async function idsColocationsConcernees(userId: Types.ObjectId): Promise<string[]> {
  const [parDepenses, parRemboursements, parAppartenance] = await Promise.all([
    ExpenseModel.distinct("householdId", {
      $or: [{ "payers.userId": userId }, { "splits.userId": userId }],
    }),
    SettlementModel.distinct("householdId", {
      $or: [{ fromUserId: userId }, { toUserId: userId }],
    }),
    HouseholdModel.distinct("_id", { "members.userId": userId }),
  ]);
  return [
    ...new Set([...parDepenses, ...parRemboursements, ...parAppartenance].map((id) => String(id))),
  ];
}

/**
 * Ce que la suppression changerait, pour la page /profil, la route
 * DELETE /api/profil et la reverification de supprimerCompte. Le solde est le
 * solde NET (calculerSoldesNets), qui compte aussi les anciens membres, et non
 * calculerSoldesMembres qui les ignore. Les noms des colocations viennent
 * d'UNE requete groupee ; une colocation detruite depuis est ignoree. Un
 * calcul de solde par colocation, en parallele.
 */
export async function evaluerSuppressionCompte(userId: string): Promise<EvaluationSuppression> {
  await connectDB();
  const ids = await idsColocationsConcernees(new Types.ObjectId(userId));
  const households =
    ids.length === 0
      ? []
      : await HouseholdModel.find({ _id: { $in: ids } }, "name members")
          .sort({ _id: 1 })
          .lean<ColocationLue[]>();

  const soldesNets = await Promise.all(
    households.map((h) => calculerSoldesNets(h._id.toString()))
  );

  const soldes: SoldeColocation[] = households.map((h, i) => ({
    householdId: h._id.toString(),
    nom: h.name,
    montant: Math.round(soldesNets[i].get(userId) ?? 0) / 100,
  }));
  const { dettes, creances } = classerSoldes(soldes);

  const colocations: ColocationDuCompte[] = households
    .filter((h) => h.members.some((m) => m.userId.toString() === userId))
    .map((h) => ({
      id: h._id.toString(),
      nom: h.name,
      estDernierMembre: h.members.every((m) => m.userId.toString() === userId),
      estAdmin: h.members.some((m) => m.userId.toString() === userId && m.role === "admin"),
    }));

  return { dettes, creances, colocations, peutSupprimer: peutSupprimer(dettes) };
}

/**
 * Supprime le compte, apres l'authentification faite par la route.
 *
 * 1. Verrou atomique sur le User (suppressionDebut) : deux appels simultanes
 *    (deux onglets) ne passent pas tous les deux, sinon chaque creance serait
 *    abandonnee deux fois. Un verrou de plus de DUREE_VERROU_SUPPRESSION_MINUTES
 *    est repris : une suppression coupee en plein travail reste relancable.
 * 2. Reevaluation complete AVANT toute ecriture : une depense ajoutee depuis
 *    l'affichage de la page peut avoir cree une dette (refus, rien n'est
 *    modifie) ou des creances (abandonnees seulement si
 *    accepterAbandonCreances).
 * 3. Ecritures, chacune relancable : abandon des creances (y compris dans les
 *    colocations deja quittees), depart de chaque colocation dont il est
 *    encore membre, puis jetons, compteur d'essais et User EN DERNIER.
 *
 * Une etape en echec : le verrou est libere (si possible) pour que
 * l'utilisateur puisse reessayer tout de suite, puis l'erreur est relancee
 * (route en 500). Le log ne contient que le nom de l'erreur.
 */
export async function supprimerCompte(
  userId: string,
  accepterAbandonCreances: boolean
): Promise<ResultatSuppression> {
  await connectDB();
  const maintenant = new Date();

  // Meme regle que verrouPrenable, mais decidee DANS la base : un "lire puis
  // ecrire" laisserait passer deux appels simultanes.
  const verrou = await UserModel.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { suppressionDebut: { $exists: false } },
        { suppressionDebut: null },
        { suppressionDebut: { $lt: new Date(maintenant.getTime() - DUREE_VERROU_MS) } },
      ],
    },
    { $set: { suppressionDebut: maintenant } }
  )
    .select("email")
    .lean<{ email?: string }>();
  if (!verrou) return { ok: false, raison: "en_cours" };

  // Conditionne a NOTRE date : si le verrou a ete repris entre-temps par un
  // autre appel, on ne le lui retire pas.
  const libererVerrou = async () => {
    try {
      await UserModel.updateOne(
        { _id: userId, suppressionDebut: maintenant },
        { $unset: { suppressionDebut: 1 } }
      );
    } catch (e) {
      console.error(
        `[compte] verrou de suppression non libéré : ${e instanceof Error ? e.name : "erreur inconnue"}`
      );
    }
  };

  try {
    const evaluation = await evaluerSuppressionCompte(userId);
    if (!evaluation.peutSupprimer) {
      await libererVerrou();
      return { ok: false, raison: "dettes", dettes: evaluation.dettes };
    }
    if (evaluation.creances.length > 0 && !accepterAbandonCreances) {
      await libererVerrou();
      return { ok: false, raison: "creances", creances: evaluation.creances };
    }

    // Fenetre residuelle assumee : entre cette reevaluation et les ecritures
    // ci-dessous (quelques millisecondes), un colocataire peut encore ajouter
    // une depense. abandonnerCreances recalcule au moment de l'ecriture, donc
    // une creance apparue la est abandonnee aussi ; une dette apparue la
    // resterait due a "Utilisateur supprimé". Aucun verrou par colocation ne
    // l'empeche, ce serait disproportionne pour ce risque.

    // Une colocation dont il est le dernier membre est detruite plus bas avec
    // ses remboursements : y abandonner les creances serait inutile.
    const detruites = new Set(
      evaluation.colocations.filter((c) => c.estDernierMembre).map((c) => c.id)
    );
    for (const c of evaluation.creances) {
      if (!detruites.has(c.householdId)) await abandonnerCreances(c.householdId, userId);
    }

    const colocations = await HouseholdModel.find({ "members.userId": userId });
    // Une colocation apres l'autre : en cas d'erreur, on sait que les
    // precedentes sont terminees, et on ne lance pas une rafale d'ecritures.
    for (const household of colocations) {
      const id = household._id.toString();
      const restants = household.members.filter(
        (m: HouseholdMember) => m.userId.toString() !== userId
      );

      // Dernier membre : la colocation n'appartient plus a personne. On la
      // detruit directement, sans la vider d'abord : vide, elle ne serait plus
      // retrouvee comme "sa" colocation et une interruption la laisserait
      // orpheline.
      if (restants.length === 0) {
        await detruireColocation(id);
        continue;
      }

      // Avant de retirer le membre (l'inverse de la route leave) : si le
      // processus s'arretait entre les deux, la colocation ne serait plus
      // retrouvee par ses membres au second appel et les taches garderaient
      // un assigne fantome.
      await retirerMembreDesTaches(id, userId);

      const etaitAdmin = household.members.some(
        (m: HouseholdMember) => m.userId.toString() === userId && m.role === "admin"
      );
      household.members = restants;
      // Succession automatique, comme a la route leave.
      if (etaitAdmin) promouvoirDoyen(household.members);
      await household.save();
    }

    await PasswordResetTokenModel.deleteMany({ userId });
    // Le compteur d'essais de cette adresse ne doit pas survivre au compte :
    // une nouvelle inscription avec la meme adresse repartirait bloquee.
    if (verrou.email) await reinitialiserCompteur(cleEmail(verrou.email));
    // Le verrou disparait avec le document.
    await UserModel.deleteOne({ _id: userId });
    return { ok: true };
  } catch (e) {
    console.error(
      `[compte] échec de la suppression du compte : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    await libererVerrou();
    throw e;
  }
}
