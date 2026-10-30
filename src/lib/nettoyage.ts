import type { Document, Model } from "mongoose";
import { Error as MongooseError, Types } from "mongoose";
import ExpenseModel from "@/models/Expense";
import HouseholdModel from "@/models/Household";
import SettlementModel from "@/models/Settlement";
import ShoppingItemModel from "@/models/ShoppingItem";
import TaskModel from "@/models/Task";
import { connectDB } from "@/lib/mongodb";
import { estObjectIdValide } from "@/lib/ids";

/**
 * Regles du nettoyage automatique des colocations (section 15 du CLAUDE.md).
 * Ce fichier ne fait QUE decider et lire : il n'ecrit rien en base, n'envoie
 * aucun email et ne supprime rien. Les etapes suivantes (cron, emails, panneau)
 * appliquent la decision rendue par `evaluerNettoyage`.
 */

/** Une colocation AVEC membres est inactive si sa derniere activite date de PLUS de 90 jours. */
export const DELAI_INACTIVITE_JOURS = 90;

/** Delai entre l'avertissement (ou le moment ou la colocation se vide) et la suppression. */
export const DELAI_SUPPRESSION_JOURS = 30;

// Des jours de 24 h en UTC, pas des jours calendaires : aucun decalage d'heure
// d'ete a gerer, et la meme arithmetique partout.
const JOUR_MS = 24 * 60 * 60 * 1000;
const DELAI_INACTIVITE_MS = DELAI_INACTIVITE_JOURS * JOUR_MS;
const DELAI_SUPPRESSION_MS = DELAI_SUPPRESSION_JOURS * JOUR_MS;

// ---------------------------------------------------------------------------
// Verrou de destruction
// ---------------------------------------------------------------------------

/**
 * Duree pendant laquelle un `destructionDebut` pose par le cron est cru : la
 * destruction d'une colocation tient en quelques secondes, donc un marqueur
 * plus vieux est celui d'un passage plante en route. Passe ce delai, la
 * colocation redevient joignable et le cron peut reprendre la destruction.
 * Partage par le cron (pose du verrou) et par /join (refus de rejoindre).
 */
export const DELAI_VERROU_DESTRUCTION_MS = 10 * 60 * 1000;

/**
 * Une destruction est « en cours » si le marqueur existe et n'est PAS plus
 * vieux que 10 minutes (>= au seuil, pour etre exactement le contraire du
 * filtre Mongo `$lt` de `filtreHorsDestruction`). Un marqueur date du futur
 * (horloges legerement decalees) compte comme en cours.
 */
export function destructionEnCours(
  destructionDebut: Date | null | undefined,
  maintenant: Date
): boolean {
  const ms = enMs(destructionDebut);
  if (ms === null) return false;
  return ms >= maintenant.getTime() - DELAI_VERROU_DESTRUCTION_MS;
}

/**
 * Filtre Mongo equivalent a `!destructionEnCours(...)` : marqueur absent (ou
 * null) ou plus vieux que 10 minutes. A fusionner dans un filtre existant.
 */
export function filtreHorsDestruction(maintenant: Date) {
  const seuil = new Date(maintenant.getTime() - DELAI_VERROU_DESTRUCTION_MS);
  return { $or: [{ destructionDebut: null }, { destructionDebut: { $lt: seuil } }] };
}

/**
 * Mongoose a-t-il refuse une sauvegarde parce que le filtre ne correspond plus ?
 * Selon la modification du document, c'est un DocumentNotFoundError ou un
 * VersionError (model.js : quand la version du document est suivie, un
 * `matchedCount` a 0 donne un VersionError, pas un DocumentNotFoundError).
 */
export function ecritureRefuseeParFiltre(e: unknown): boolean {
  return e instanceof MongooseError.DocumentNotFoundError || e instanceof MongooseError.VersionError;
}

/**
 * `save()` d'une colocation chargee, REFUSE si elle est en cours de destruction
 * par le cron. Le `save()` de Mongoose ne filtre que sur `_id` : sans cela, une
 * arrivee ou un depart pourrait s'ecrire entre la pose du verrou et la fin de la
 * destruction. `$where` est ajoute par Mongoose au filtre de l'ecriture
 * (`_applyCustomWhere`, mongoose/lib/model.js), donc l'ecriture n'a lieu que si
 * le verrou est absent ou perime, evalue par MongoDB au moment de l'ecriture.
 *
 * Renvoie false si la colocation est en cours de destruction (ou a disparu) :
 * l'appelant repond comme pour une colocation introuvable. Un echec du meme
 * type SANS destruction en cours (deux ecritures simultanees) est une vraie
 * concurrence : l'erreur est relancee. Toute autre erreur aussi.
 */
export async function sauvegarderSiPasEnDestruction(household: Document): Promise<boolean> {
  household.$where = filtreHorsDestruction(new Date());
  try {
    await household.save();
    return true;
  } catch (e) {
    if (!ecritureRefuseeParFiltre(e)) throw e;
    const toujoursVivante = await HouseholdModel.exists({
      _id: household._id,
      ...filtreHorsDestruction(new Date()),
    });
    if (toujoursVivante) throw e;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Interrupteur
// ---------------------------------------------------------------------------

/**
 * La suppression AUTOMATIQUE (par le cron) est desactivee tant que la variable
 * vaut autre chose que la chaine exacte "true". Strict a dessein, y compris en
 * production : pas de trim, pas de majuscules, pas de "1" ni de "yes". Une
 * valeur mal ecrite doit laisser l'interrupteur ferme, jamais l'ouvrir par
 * accident. Les avertissements et la planification ne dependent pas de cet
 * interrupteur.
 */
export function suppressionAutoActive(env: { NETTOYAGE_AUTO_ACTIF?: string }): boolean {
  return env.NETTOYAGE_AUTO_ACTIF === "true";
}

// ---------------------------------------------------------------------------
// Decision (partie PURE)
// ---------------------------------------------------------------------------

export type MotifSuppression = "vide" | "inactive";

/**
 * Etat d'une colocation tel que lu en base (avec .lean() : champs absents
 * possibles, donc tous optionnels sauf ce qui est calcule).
 */
export type EntreeNettoyage = {
  nombreMembres: number;
  creeLe: Date;
  /** Resultat de `dernieresActivites` (qui inclut deja la creation). */
  derniereActivite: Date;
  demo?: boolean | null;
  videDepuis?: Date | null;
  avertieLe?: Date | null;
  suppressionPrevueLe?: Date | null;
  motifSuppression?: string | null;
};

/**
 * Ce que l'appelant doit faire. Les effets d'ecriture attendus :
 *  - ignorer / rien : aucune ecriture.
 *  - planifier_vide : ecrire videDepuis, suppressionPrevueLe, motifSuppression
 *    = "vide" ET effacer avertieLe (un eventuel avertissement d'inactivite
 *    est remplace par la regle « vide »).
 *  - avertir_inactive : envoyer l'email, puis ecrire avertieLe,
 *    suppressionPrevueLe, motifSuppression = "inactive" (ne rien ecrire si
 *    l'envoi echoue, pour retenter au passage suivant).
 *  - annuler : effacer les QUATRE champs videDepuis, avertieLe,
 *    suppressionPrevueLe, motifSuppression. Le passage suivant reevalue a
 *    neuf (et reavertit si la colocation est encore inactive).
 *  - supprimer : l'echeance est passee et la raison est vraie a cet instant.
 *    L'appelant doit encore refaire la verification au moment de supprimer
 *    (par exemple un filtre sur le nombre de membres), car quelqu'un peut
 *    rejoindre entre la lecture et la suppression.
 */
export type DecisionNettoyage =
  | { action: "ignorer" }
  | { action: "rien" }
  | { action: "planifier_vide"; videDepuis: Date; suppressionPrevueLe: Date }
  | { action: "avertir_inactive"; avertieLe: Date; suppressionPrevueLe: Date }
  | { action: "annuler" }
  | { action: "supprimer"; motif: MotifSuppression };

/** Date valide en millisecondes, sinon null (absente ou invalide : meme traitement). */
function enMs(date: Date | null | undefined): number | null {
  if (!(date instanceof Date)) return null;
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Decide quoi faire d'UNE colocation a l'instant `maintenant`. Une seule action
 * par appel : planifier puis supprimer sont deux passages differents, jamais
 * enchaines, donc une echeance qui vient d'etre posee n'est jamais executee
 * dans la foulee.
 *
 * Principe de securite : `supprimer` n'est rendu que si l'echeance est posee,
 * coherente, atteinte, ET si la raison est vraie maintenant. Tout etat
 * incoherent aboutit a `annuler`, `planifier_vide` ou `rien`, jamais a une
 * suppression.
 *
 * Cas limites (choix assumes) :
 *  - Demo (`demo === true`) : `ignorer`, meme si des champs de nettoyage traînent.
 *  - Colocation vide : la regle « vide » PRIME sur l'inactivite, l'activite est
 *    ignoree (plus personne ne peut en produire). Elle exige un plan coherent :
 *    motif "vide", videDepuis valide et non futur, echeance >= videDepuis + 30 j.
 *    Sinon `planifier_vide` (filet de securite si l'evenement de depart a ete
 *    manque : videDepuis absent ou futur = on repart de `maintenant`). Un plan
 *    d'inactivite existant est remplace.
 *  - Colocation non vide avec une trace « vide » (videDepuis ou motif "vide") :
 *    quelqu'un a rejoint, `annuler`.
 *  - Inactive = `maintenant - activite > 90 j`, comparaison STRICTE : a
 *    exactement 90 j elle ne l'est pas encore.
 *  - Activite = max(derniereActivite, creeLe) : la creation compte, donc une
 *    colocation recente sans aucune depense n'est pas inactive. Une activite
 *    dans le futur (horloge qui recule, donnee fautive) vaut « tres recente ».
 *    Aucune date valide du tout : `rien` (on ne juge pas, on ne supprime pas).
 *  - Echeance EXACTEMENT atteinte (`maintenant === suppressionPrevueLe`) :
 *    `supprimer` (>=).
 *  - Nouvelle activite = STRICTEMENT posterieure a avertieLe. Une activite a
 *    la milliseconde de l'avertissement ne l'annule pas.
 *  - avertieLe dans le futur (horloge qui recule) : `rien`. On n'annule pas
 *    (cela provoquerait un second email), on ne supprime pas non plus.
 *  - Plan d'inactivite incoherent (echeance sans motif, motif sans date,
 *    avertieLe sans echeance, echeance anterieure a avertieLe + 30 j, motif
 *    inconnu) : `annuler`. Le delai de 30 j promis ne peut jamais etre raccourci
 *    par une donnee abimee.
 *  - Plan coherent mais colocation plus inactive a cet instant : `annuler`.
 *  - Nombre de membres negatif ou non entier : RangeError (bug de l'appelant).
 */
export function evaluerNettoyage(entree: EntreeNettoyage, maintenant: Date): DecisionNettoyage {
  const t = maintenant.getTime();
  if (Number.isNaN(t)) throw new RangeError("Date de reference invalide");
  if (!Number.isInteger(entree.nombreMembres) || entree.nombreMembres < 0) {
    throw new RangeError("Nombre de membres invalide");
  }

  if (entree.demo === true) return { action: "ignorer" };

  const vide = enMs(entree.videDepuis);
  const avertie = enMs(entree.avertieLe);
  const echeance = enMs(entree.suppressionPrevueLe);
  const motif: MotifSuppression | null =
    entree.motifSuppression === "vide" || entree.motifSuppression === "inactive"
      ? entree.motifSuppression
      : null;

  // --- Colocation vide -----------------------------------------------------
  if (entree.nombreMembres === 0) {
    const depart = vide !== null && vide <= t ? vide : null;
    const planCoherent =
      motif === "vide" &&
      depart !== null &&
      echeance !== null &&
      echeance >= depart + DELAI_SUPPRESSION_MS;

    if (!planCoherent) {
      // Le delai de 30 jours repart TOUJOURS de maintenant : une colocation
      // deja vide depuis plus longtemps (evenement de depart manque) serait
      // sinon supprimee au passage suivant, sans le preavis promis.
      // videDepuis garde la vraie date de depart, a titre d'information.
      return {
        action: "planifier_vide",
        videDepuis: new Date(depart ?? t),
        suppressionPrevueLe: new Date(t + DELAI_SUPPRESSION_MS),
      };
    }
    return t >= echeance! ? { action: "supprimer", motif: "vide" } : { action: "rien" };
  }

  // --- Colocation avec membres ---------------------------------------------
  // Une trace de « vide » alors qu'il y a des membres : quelqu'un a rejoint.
  if (motif === "vide" || vide !== null) return { action: "annuler" };

  const activite = Math.max(
    enMs(entree.derniereActivite) ?? -Infinity,
    enMs(entree.creeLe) ?? -Infinity
  );
  if (activite === -Infinity) return { action: "rien" };

  const inactiveMaintenant = t - activite > DELAI_INACTIVITE_MS;
  const unPlanExiste = avertie !== null || echeance !== null || motif !== null;

  if (!unPlanExiste) {
    if (!inactiveMaintenant) return { action: "rien" };
    return {
      action: "avertir_inactive",
      avertieLe: new Date(t),
      suppressionPrevueLe: new Date(t + DELAI_SUPPRESSION_MS),
    };
  }

  if (avertie !== null && avertie > t) return { action: "rien" };

  const planCoherent =
    motif === "inactive" &&
    avertie !== null &&
    echeance !== null &&
    echeance >= avertie + DELAI_SUPPRESSION_MS;
  if (!planCoherent) return { action: "annuler" };

  // Nouvelle activite depuis l'avertissement, ou plus inactive pour une autre
  // raison : la suppression n'a plus de raison d'etre.
  if (activite > avertie!) return { action: "annuler" };
  if (!inactiveMaintenant) return { action: "annuler" };

  return t >= echeance! ? { action: "supprimer", motif: "inactive" } : { action: "rien" };
}

// ---------------------------------------------------------------------------
// Planification au depart du dernier membre (ecriture)
// ---------------------------------------------------------------------------

/**
 * Appelee par /leave apres un depart. Pose le plan « vide » SEULEMENT si la
 * colocation n'a toujours aucun membre ET n'est pas une demo, le tout dans UNE
 * ecriture : le filtre `members.0` inexistant est evalue par MongoDB au moment
 * de l'ecriture, donc quelqu'un qui rejoint entre-temps empeche la pose (rien
 * n'est ecrit). `demo: { $ne: true }` equivaut a lire `demo === true` : absent
 * ou false = pas une demo. Le $unset d'avertieLe remplace un eventuel
 * avertissement d'inactivite (regle de planifier_vide).
 *
 * Renvoie l'echeance posee, ou null si rien n'a ete ecrit (l'appelant n'envoie
 * alors aucun email).
 */
export async function planifierSuppressionVide(
  householdId: string,
  maintenant: Date = new Date()
): Promise<Date | null> {
  const suppressionPrevueLe = new Date(maintenant.getTime() + DELAI_SUPPRESSION_MS);
  await connectDB();
  const res = await HouseholdModel.updateOne(
    {
      _id: householdId,
      "members.0": { $exists: false },
      demo: { $ne: true },
      ...filtreHorsDestruction(maintenant),
    },
    {
      $set: { videDepuis: maintenant, suppressionPrevueLe, motifSuppression: "vide" },
      $unset: { avertieLe: 1 },
    }
  );
  return res.modifiedCount === 1 ? suppressionPrevueLe : null;
}

// ---------------------------------------------------------------------------
// Derniere activite (lecture)
// ---------------------------------------------------------------------------

/**
 * Date la plus recente d'une liste, en ignorant les valeurs absentes ou
 * invalides. null si aucune n'est exploitable. Partie pure du calcul
 * d'activite.
 */
export function dateLaPlusRecente(dates: (Date | null | undefined)[]): Date | null {
  let meilleure: number | null = null;
  for (const d of dates) {
    const ms = enMs(d);
    if (ms !== null && (meilleure === null || ms > meilleure)) meilleure = ms;
  }
  return meilleure === null ? null : new Date(meilleure);
}

type LigneMax = { _id: Types.ObjectId } & Record<string, unknown>;

/**
 * UNE agregation pour toutes les colocations demandees : le $max de chaque
 * champ, groupe par colocation. On fait un $max par champ puis la fusion en JS
 * plutot qu'un $max d'un tableau dans la requete : plus simple a relire et
 * identique en resultat. Renvoie id -> dates trouvees (toutes les colocations
 * sans document sont simplement absentes).
 */
async function maxParColocation(
  modele: Model<unknown>,
  champs: string[],
  ids: Types.ObjectId[]
): Promise<Map<string, Date[]>> {
  const lignes = await modele.aggregate<LigneMax>([
    { $match: { householdId: { $in: ids } } },
    {
      $group: {
        _id: "$householdId",
        ...Object.fromEntries(champs.map((c) => [c, { $max: `$${c}` }])),
      },
    },
  ]);
  const resultat = new Map<string, Date[]>();
  for (const ligne of lignes) {
    const dates = champs
      .map((c) => ligne[c])
      .filter((v): v is Date => v instanceof Date);
    resultat.set(ligne._id.toString(), dates);
  }
  return resultat;
}

/**
 * Derniere activite de chaque colocation demandee : la date la plus recente
 * parmi
 *  - la creation de la colocation et l'arrivee d'un membre (`members.joinedAt`) ;
 *  - Expense.createdAt (jamais `date`, saisie par l'utilisateur, possible dans
 *    le futur ou le passe) ;
 *  - Task.createdAt et Task.completedAt (passage a « terminee » ; efface si la
 *    tache sort de « terminee », la creation reste) ;
 *  - ShoppingItem.createdAt et ShoppingItem.checkedAt (coche ; efface au decochage) ;
 *  - Settlement.settledAt (pose a la creation du remboursement).
 *
 * Cinq requetes au total, quel que soit le nombre de colocations (une
 * agregation $group/$max par collection + la lecture des colocations), car le
 * panneau admin les liste toutes. Les identifiants mal formes ou inconnus sont
 * ecartes : ils n'ont pas d'entree dans la Map.
 *
 * Limites : modifier une depense ou une tache, ou passer une tache a « en
 * cours », ne laisse aucune date (pas de `updatedAt` sur ces modeles) et ne
 * compte donc pas comme activite.
 */
export async function dernieresActivites(householdIds: string[]): Promise<Map<string, Date>> {
  const valides = [...new Set(householdIds.filter(estObjectIdValide))];
  const resultat = new Map<string, Date>();
  if (valides.length === 0) return resultat;
  const ids = valides.map((id) => new Types.ObjectId(id));

  await connectDB();
  const [colocations, depenses, taches, articles, remboursements] = await Promise.all([
    HouseholdModel.find({ _id: { $in: ids } })
      .select("createdAt members.joinedAt")
      .lean<{ _id: Types.ObjectId; createdAt?: Date; members?: { joinedAt?: Date }[] }[]>(),
    maxParColocation(ExpenseModel, ["createdAt"], ids),
    maxParColocation(TaskModel, ["createdAt", "completedAt"], ids),
    maxParColocation(ShoppingItemModel, ["createdAt", "checkedAt"], ids),
    maxParColocation(SettlementModel, ["settledAt"], ids),
  ]);

  for (const colocation of colocations) {
    const id = colocation._id.toString();
    const plusRecente = dateLaPlusRecente([
      colocation.createdAt,
      ...(colocation.members ?? []).map((m) => m.joinedAt),
      ...(depenses.get(id) ?? []),
      ...(taches.get(id) ?? []),
      ...(articles.get(id) ?? []),
      ...(remboursements.get(id) ?? []),
    ]);
    if (plusRecente) resultat.set(id, plusRecente);
  }
  return resultat;
}

/** Variante pour une seule colocation. null si elle n'existe pas (ou id mal forme). */
export async function derniereActivite(householdId: string): Promise<Date | null> {
  const activites = await dernieresActivites([householdId]);
  return activites.get(householdId) ?? null;
}
