import type { Types } from "mongoose";
import HouseholdModel from "@/models/Household";
import { connectDB } from "@/lib/mongodb";
import { estEnProduction, redirectionActive } from "@/lib/email";
import { detruireColocation } from "@/lib/households";
import { notifierColocationInactive } from "@/lib/notifications";
import {
  DELAI_SUPPRESSION_JOURS,
  derniereActivite,
  dernieresActivites,
  evaluerNettoyage,
  filtreHorsDestruction,
  suppressionAutoActive,
  type DecisionNettoyage,
  type EntreeNettoyage,
  type MotifSuppression,
} from "@/lib/nettoyage";

/**
 * Orchestration du cron de nettoyage (section 15 du CLAUDE.md). Les DECISIONS
 * (quoi faire d'une colocation) sont dans `nettoyage.ts` ; ce fichier les
 * applique, avec des ecritures conditionnelles partout : entre la lecture et
 * l'ecriture quelqu'un peut rejoindre, ecrire, ou un autre passage peut tourner.
 */

/**
 * Plafond d'actions par passage (avertissements envoyes + suppressions +
 * planifications). Borne la duree de la fonction (Vercel) et le quota Resend ;
 * le reste attend le lendemain. Valeur de la decision de Tanguy, pas une
 * mesure : a ajuster d'apres les logs.
 */
export const MAX_ACTIONS_PAR_PASSAGE = 50;

/**
 * Plafond de mails ENVOYES par passage (comptes sur les succes). Borne le
 * quota Resend et la duree. Valeur de la decision de Tanguy, pas une mesure.
 */
export const MAX_EMAILS_PAR_PASSAGE = 30;

/**
 * Une echeance depassee de plus de ce nombre de jours n'est PAS executee : le
 * cron a ete arrete (panne, interrupteur ferme, envoi impossible) et le
 * preavis promis est trop ancien. On repart pour 30 jours.
 */
export const DELAI_RETARD_MAX_JOURS = 7;

/**
 * Temps maximal (ms) avant de cesser de traiter de nouvelles colocations :
 * marge sous les 60 s de maxDuration de la route, pour finir proprement
 * l'operation en cours.
 */
export const BUDGET_TEMPS_MS = 45_000;

const JOUR_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

type EnvEnvoi = {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  EMAIL_REDIRECT_TO?: string;
  NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE?: string;
};

/**
 * Domaine de l'expediteur : "RoomFlow <a@exemple.fr>" ou "a@exemple.fr" =>
 * "exemple.fr" (minuscules). null si on n'en trouve pas un d'apparence
 * valable : mieux vaut refuser l'envoi que supposer.
 */
export function domaineExpediteur(emailFrom: string | undefined): string | null {
  const brut = emailFrom?.trim();
  if (!brut) return null;
  const entreChevrons = /<([^<>]*)>/.exec(brut);
  const adresse = (entreChevrons ? entreChevrons[1] : brut).trim();
  const arobase = adresse.lastIndexOf("@");
  if (arobase < 1) return null;
  const domaine = adresse.slice(arobase + 1).trim().toLowerCase();
  // Motif STRICT (lettres ASCII, chiffres, tirets, points entre deux etiquettes) :
  // un point final ou un caractere invisible (U+200B...) donnerait « resend.dev. »
  // ou « resend.dev<invisible> », qui ne sont pas egaux a « resend.dev » et
  // feraient croire a un vrai domaine verifie.
  return DOMAINE_VALIDE.test(domaine) ? domaine : null;
}

const DOMAINE_VALIDE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Peut-on VRAIMENT prevenir les membres par email ? Sans domaine verifie chez
 * Resend, les mails ne partent qu'a l'adresse du compte Resend : un
 * « preavis » serait fictif. Le cron ne pose alors aucun plan d'inactivite.
 *
 *  | Environnement                                  | Resultat |
 *  | pas de RESEND_API_KEY                          | faux     |
 *  | production, EMAIL_FROM absent / illisible      | faux     |
 *  | production, domaine resend.dev (ou sous-dom.)  | faux     |
 *  | production, domaine propre                     | vrai     |
 *  | hors production, sans EMAIL_REDIRECT_TO        | vrai     |
 *  | hors production, EMAIL_REDIRECT_TO actif       | faux, sauf NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE === "true" |
 *
 * Un envoi redirige (hors production) arrive dans UNE boite de test, pas chez
 * les vrais membres : ce n'est pas un preavis. L'exception sert aux tests reels
 * du cron. Comme EMAIL_REDIRECT_TO, elle est ignoree en production (le test de
 * production est fait avant, sans jamais lire ces deux variables).
 */
export function envoiReelPossible(env: EnvEnvoi): boolean {
  if (!env.RESEND_API_KEY?.trim()) return false;

  if (estEnProduction(env)) {
    const domaine = domaineExpediteur(env.EMAIL_FROM);
    if (!domaine) return false;
    return domaine !== "resend.dev" && !domaine.endsWith(".resend.dev");
  }

  if (redirectionActive(env)) return env.NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE === "true";
  return true;
}

/**
 * Ordre de traitement : derniere activite la plus ANCIENNE d'abord (les plus
 * delaissees d'abord quand le plafond coupe le passage), puis par id pour un
 * ordre stable. Sans date connue : en dernier. Ne modifie pas la liste recue.
 */
export function ordonnerParActiviteAncienne<T extends { id: string; derniereActivite: Date | null }>(
  items: T[]
): T[] {
  const ms = (d: Date | null) => {
    const t = d?.getTime();
    return t === undefined || Number.isNaN(t) ? Infinity : t;
  };
  return [...items].sort((a, b) => {
    const ecart = ms(a.derniereActivite) - ms(b.derniereActivite);
    if (ecart !== 0 && !Number.isNaN(ecart)) return ecart;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Action reellement faite par le cron : les actions de `evaluerNettoyage`
 * plus deux « replanifier » pour une echeance en retard.
 */
export type ActionCron =
  | DecisionNettoyage["action"]
  | "replanifier_inactive"
  | "replanifier_vide";

/**
 * Echeance depassee de PLUS de `maxJours` jours (strictement). Une date absente
 * ou invalide n'est pas « en retard » (la decision ne serait de toute facon pas
 * `supprimer`).
 */
export function echeanceEnRetard(
  suppressionPrevueLe: Date | null | undefined,
  maintenant: Date,
  maxJours: number = DELAI_RETARD_MAX_JOURS
): boolean {
  if (!(suppressionPrevueLe instanceof Date)) return false;
  const retard = maintenant.getTime() - suppressionPrevueLe.getTime();
  return Number.isFinite(retard) && retard > maxJours * JOUR_MS;
}

/**
 * Ce que le cron fait vraiment d'une decision. `supprimer` en retard n'est
 * jamais execute (ni simule) : on replanifie, avec un nouvel avertissement pour
 * le motif « inactive » (qui a des membres a prevenir), sans email pour « vide ».
 * `evaluerNettoyage` reste inchange : il dit « l'echeance est atteinte », le
 * cron ajoute « mais pas depuis trop longtemps ».
 */
export function actionCronPour(
  decision: DecisionNettoyage,
  suppressionPrevueLe: Date | null | undefined,
  maintenant: Date
): ActionCron {
  if (decision.action === "supprimer" && echeanceEnRetard(suppressionPrevueLe, maintenant)) {
    return decision.motif === "inactive" ? "replanifier_inactive" : "replanifier_vide";
  }
  return decision.action;
}

/**
 * Cette action consomme-t-elle le budget d'actions du passage ? Seulement ce
 * qui fait un vrai travail. Ignorer, rien, annuler (une ecriture minuscule), un
 * avertissement impossible (envoi reel impossible), un plan « vide » sans envoi
 * reel possible et une suppression simulee ne coutent rien.
 */
export function actionConsommeBudget(
  action: ActionCron,
  contexte: { envoiReel: boolean; suppressionAuto: boolean }
): boolean {
  switch (action) {
    case "planifier_vide":
    case "avertir_inactive":
    case "replanifier_inactive":
      return contexte.envoiReel;
    case "replanifier_vide":
      return true;
    case "supprimer":
      return contexte.suppressionAuto;
    default:
      return false;
  }
}

/** Le budget est epuise quand `deja` actions ont ete faites. */
export function budgetEpuise(deja: number, max: number = MAX_ACTIONS_PAR_PASSAGE): boolean {
  return deja >= max;
}

/** Cette action envoie-t-elle des emails d'avertissement ? */
export function actionAvertit(action: ActionCron): boolean {
  return action === "avertir_inactive" || action === "replanifier_inactive";
}

/**
 * Peut-on demarrer l'avertissement d'une colocation de `nombreMembres` membres
 * compte tenu des mails deja envoyes dans ce passage ? On ne commence pas un
 * avertissement qui ferait depasser le plafond (il attend le lendemain : un
 * avertissement a moitie envoye serait inutilisable). Exception : si aucun mail
 * n'est encore parti, on avertit quand meme, sinon une colocation de plus de 30
 * membres ne serait jamais prevenue.
 */
export function peutAvertir(
  mailsEnvoyes: number,
  nombreMembres: number,
  max: number = MAX_EMAILS_PAR_PASSAGE
): boolean {
  return mailsEnvoyes === 0 || mailsEnvoyes + nombreMembres <= max;
}

/** Le temps alloue au passage est-il depasse (strictement) ? Horloge injectee pour rester pure. */
export function tempsEpuise(
  debutMs: number,
  maintenantMs: number,
  budget: number = BUDGET_TEMPS_MS
): boolean {
  return maintenantMs - debutMs > budget;
}

/**
 * La plus recente de deux dates en ignorant les absentes ou invalides, `repli`
 * s'il n'y en a aucune. Sert au « depuis environ N jours » du mail : meme
 * reference que la decision (qui compte la creation comme activite). Sans cela,
 * une activite inconnue donnerait « 0 jour » pour une colocation de 200 jours.
 */
export function plusRecenteDateValide(
  a: Date | null | undefined,
  b: Date | null | undefined,
  repli: Date
): Date {
  const valides = [a, b].filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  if (valides.length === 0) return repli;
  return new Date(Math.max(...valides.map((d) => d.getTime())));
}

/** Jours entiers ecoules depuis l'activite (jamais negatif), pour le « depuis environ N jours » du mail. */
export function joursInactivite(derniereActivite: Date, maintenant: Date): number {
  const ecart = maintenant.getTime() - derniereActivite.getTime();
  return Number.isFinite(ecart) ? Math.max(0, Math.floor(ecart / JOUR_MS)) : 0;
}

// Forme d'une colocation lue avec .lean() (objets Mongo bruts, sans defaut applique).
export type ColocationLue = {
  _id: Types.ObjectId;
  name?: string;
  createdAt?: Date;
  members?: unknown[];
  demo?: boolean | null;
  videDepuis?: Date | null;
  avertieLe?: Date | null;
  suppressionPrevueLe?: Date | null;
  motifSuppression?: string | null;
  destructionDebut?: Date | null;
};

const CHAMPS_LUS =
  "name createdAt members.userId demo videDepuis avertieLe suppressionPrevueLe motifSuppression destructionDebut";

/**
 * Entree d'`evaluerNettoyage` depuis une colocation lue. Une date absente
 * devient une date invalide, que l'evaluation traite comme « inconnue » (elle
 * ne conclut alors jamais a une suppression sur cette seule base).
 */
export function entreeDepuisColocation(
  c: ColocationLue,
  derniereActiviteConnue: Date | null | undefined
): EntreeNettoyage {
  return {
    nombreMembres: c.members?.length ?? 0,
    creeLe: c.createdAt ?? new Date(NaN),
    derniereActivite: derniereActiviteConnue ?? new Date(NaN),
    demo: c.demo,
    videDepuis: c.videDepuis,
    avertieLe: c.avertieLe,
    suppressionPrevueLe: c.suppressionPrevueLe,
    motifSuppression: c.motifSuppression,
  };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

/** Compteurs seulement : aucune donnee personnelle (ni nom, ni adresse). */
export type RapportNettoyage = {
  evaluees: number;
  ignorees: number;
  planifiees: number;
  avertissements: number;
  avertissementsNonEnvoyes: number;
  replanifiees: number;
  annulees: number;
  supprimees: number;
  simulees: number;
  erreurs: number;
  tronque: boolean;
  suppressionAutoActive: boolean;
  envoiReelPossible: boolean;
};

type Contexte = {
  maintenant: Date;
  rapport: RapportNettoyage;
  /** Mails REELLEMENT envoyes depuis le debut du passage (pour MAX_EMAILS_PAR_PASSAGE). */
  etat: { mails: number };
};

// ---------------------------------------------------------------------------
// Actions (effets de bord)
// ---------------------------------------------------------------------------

/**
 * Meme filtre atomique que `planifierSuppressionVide` : toujours aucun membre,
 * pas une demo, pas en cours de destruction. Pas d'email ici : le cron n'est
 * qu'un filet de securite pour un evenement de depart manque, on ne previent
 * personne apres coup.
 */
async function planifierVide(
  c: ColocationLue,
  decision: Extract<DecisionNettoyage, { action: "planifier_vide" }>,
  { maintenant, rapport }: Contexte
) {
  const res = await HouseholdModel.updateOne(
    {
      _id: c._id,
      "members.0": { $exists: false },
      demo: { $ne: true },
      ...filtreHorsDestruction(maintenant),
    },
    {
      $set: {
        videDepuis: decision.videDepuis,
        suppressionPrevueLe: decision.suppressionPrevueLe,
        motifSuppression: "vide",
      },
      $unset: { avertieLe: 1 },
    }
  );
  if (res.modifiedCount === 1) rapport.planifiees++;
}

/**
 * Efface le plan SEULEMENT s'il est toujours celui qu'on a lu (les quatre
 * champs identiques ; `null` correspond a « absent ») et si la colocation a
 * toujours des membres : un plan pose entre-temps (depart du dernier membre)
 * n'est pas efface.
 */
async function annulerPlan(c: ColocationLue, { rapport }: Contexte) {
  const res = await HouseholdModel.updateOne(
    {
      _id: c._id,
      "members.0": { $exists: true },
      videDepuis: c.videDepuis ?? null,
      avertieLe: c.avertieLe ?? null,
      suppressionPrevueLe: c.suppressionPrevueLe ?? null,
      motifSuppression: c.motifSuppression ?? null,
    },
    { $unset: { videDepuis: 1, avertieLe: 1, suppressionPrevueLe: 1, motifSuppression: 1 } }
  );
  if (res.modifiedCount === 1) rapport.annulees++;
}

/**
 * Envoie l'avertissement a tous les membres, PUIS ecrit le plan si TOUS les
 * envois ont reussi. Un seul echec : rien d'ecrit, l'avertissement est compte
 * « non envoye » et on retentera au passage suivant (un double mail vaut mieux
 * qu'une suppression dont un membre n'a pas ete prevenu). L'ecriture est
 * conditionnelle (`filtreEcriture` decrit l'etat qu'on a lu) : deux passages
 * simultanes pourraient chacun envoyer avant d'ecrire, mais un seul plan sera
 * ecrit. Renvoie true si le plan a ete ecrit.
 */
async function avertirPuisPlanifier(
  c: ColocationLue,
  entree: EntreeNettoyage,
  nouveauPlan: { avertieLe: Date; suppressionPrevueLe: Date },
  filtreEcriture: Record<string, unknown>,
  { maintenant, rapport, etat }: Contexte
): Promise<boolean> {
  const { envoyes, destinataires } = await notifierColocationInactive({
    householdId: c._id.toString(),
    nomColocation: c.name ?? "sans nom",
    joursInactivite: joursInactivite(
      plusRecenteDateValide(entree.derniereActivite, entree.creeLe, maintenant),
      maintenant
    ),
    suppressionPrevueLe: nouveauPlan.suppressionPrevueLe,
  });
  etat.mails += envoyes;
  if (destinataires < 1 || envoyes < destinataires) {
    rapport.avertissementsNonEnvoyes++;
    return false;
  }

  const res = await HouseholdModel.updateOne(
    { _id: c._id, "members.0": { $exists: true }, demo: { $ne: true }, ...filtreEcriture },
    {
      $set: {
        avertieLe: nouveauPlan.avertieLe,
        suppressionPrevueLe: nouveauPlan.suppressionPrevueLe,
        motifSuppression: "inactive",
      },
    }
  );
  if (res.modifiedCount !== 1) {
    // Les mails sont partis mais un autre passage ou un evenement a change
    // l'etat entre-temps : on ne force rien, le prochain passage reevaluera.
    console.warn(`[nettoyage] avertissement envoyé mais plan non écrit : ${c._id.toString()}`);
    return false;
  }
  return true;
}

/** Premier avertissement : aucun plan n'existe (les quatre champs sont absents). */
async function avertirInactive(
  c: ColocationLue,
  decision: Extract<DecisionNettoyage, { action: "avertir_inactive" }>,
  entree: EntreeNettoyage,
  contexte: Contexte
) {
  const ecrit = await avertirPuisPlanifier(
    c,
    entree,
    decision,
    { videDepuis: null, avertieLe: null, suppressionPrevueLe: null, motifSuppression: null },
    contexte
  );
  if (ecrit) contexte.rapport.avertissements++;
}

/**
 * Echeance « inactive » en retard : nouvel avertissement, puis le plan est
 * REMPLACE (avertieLe = maintenant, echeance = maintenant + 30 jours). Le filtre
 * exige que le plan soit encore celui qu'on a lu.
 */
async function reavertirInactive(c: ColocationLue, entree: EntreeNettoyage, contexte: Contexte) {
  const { maintenant } = contexte;
  const ecrit = await avertirPuisPlanifier(
    c,
    entree,
    {
      avertieLe: maintenant,
      suppressionPrevueLe: new Date(maintenant.getTime() + DELAI_SUPPRESSION_JOURS * JOUR_MS),
    },
    {
      motifSuppression: "inactive",
      avertieLe: c.avertieLe ?? null,
      suppressionPrevueLe: c.suppressionPrevueLe ?? null,
    },
    contexte
  );
  if (ecrit) contexte.rapport.replanifiees++;
}

/**
 * Echeance « vide » en retard : nouvelle echeance dans 30 jours, sans email
 * (personne a prevenir), seulement si le plan lu est toujours en place et la
 * colocation toujours vide.
 */
async function replanifierVide(c: ColocationLue, { maintenant, rapport }: Contexte) {
  const res = await HouseholdModel.updateOne(
    {
      _id: c._id,
      "members.0": { $exists: false },
      demo: { $ne: true },
      motifSuppression: "vide",
      videDepuis: c.videDepuis ?? null,
      suppressionPrevueLe: c.suppressionPrevueLe ?? null,
      ...filtreHorsDestruction(maintenant),
    },
    {
      $set: {
        suppressionPrevueLe: new Date(maintenant.getTime() + DELAI_SUPPRESSION_JOURS * JOUR_MS),
      },
    }
  );
  if (res.modifiedCount === 1) rapport.replanifiees++;
}

/**
 * Suppression reelle d'une colocation dont la decision est `supprimer`.
 * Ordre : (1) relecture fraiche et reevaluation, (2) verrou atomique,
 * (3) destruction (la colocation est supprimee EN DERNIER).
 */
async function supprimerSiToujoursValide(
  c: ColocationLue,
  motifAttendu: MotifSuppression,
  { maintenant, rapport }: Contexte
) {
  const id = c._id.toString();

  // (1) Donnees fraiches : la decision a pu devenir fausse depuis la lecture de
  // debut de passage (nouveau membre, nouvelle activite, plan efface).
  const fraiche = await HouseholdModel.findById(c._id).select(CHAMPS_LUS).lean<ColocationLue>();
  if (!fraiche) return;
  const activite = await derniereActivite(id);
  const decision = evaluerNettoyage(entreeDepuisColocation(fraiche, activite), maintenant);
  if (decision.action !== "supprimer" || decision.motif !== motifAttendu) {
    console.log(`[nettoyage] suppression abandonnée après relecture : ${id}`);
    return;
  }

  // (2) Verrou : repete les preconditions dans le filtre, donc quelqu'un qui
  // vient de rejoindre ou un plan modifie fait echouer la pose (modifiedCount 0).
  // Un verrou de moins de 10 minutes (autre passage en cours) la fait echouer
  // aussi ; un plus vieux (passage plante) est repris.
  const debut = new Date();
  const res = await HouseholdModel.updateOne(
    {
      _id: c._id,
      suppressionPrevueLe: fraiche.suppressionPrevueLe ?? null,
      motifSuppression: motifAttendu,
      demo: { $ne: true },
      // « vide » exige toujours zero membre ; « inactive » exige au moins un membre.
      "members.0": { $exists: motifAttendu === "inactive" },
      ...filtreHorsDestruction(debut),
    },
    { $set: { destructionDebut: debut } }
  );
  if (res.modifiedCount !== 1) {
    console.log(`[nettoyage] suppression abandonnée, verrou refusé : ${id}`);
    return;
  }

  // (3) Un plantage ici laisse la colocation (et le verrou) : elle redevient
  // joignable apres 10 minutes et le prochain passage reprend la destruction.
  await detruireColocation(id);
  rapport.supprimees++;
  console.log(`[nettoyage] colocation détruite : ${id}`);
}

// ---------------------------------------------------------------------------
// Passage complet
// ---------------------------------------------------------------------------

/**
 * Un passage du cron : evalue chaque colocation et applique l'action decidee.
 * Chaque colocation a son propre try/catch ; une erreur n'arrete pas les autres.
 * Seules les erreurs globales (lecture de la liste) remontent a l'appelant.
 *
 * Table de decision (E = envoi reel possible, A = NETTOYAGE_AUTO_ACTIF === "true") :
 *  - demo : ignorer, rien.
 *  - pas de plan et pas inactive, ou plan non atteint : rien.
 *  - vide sans plan coherent : planifier_vide. E : plan ecrit, sans email ;
 *    sinon rien.
 *  - trace « vide » avec des membres, plan abime, nouvelle activite, plus
 *    inactive : annuler (les 4 champs effaces, ecriture conditionnelle).
 *  - inactive depuis plus de 90 jours, sans plan : avertir_inactive. E : mails
 *    a TOUS, plan ecrit seulement si tous sont partis, sinon rien d'ecrit et
 *    « non envoye ». Pas E : rien envoye, rien ecrit, « non envoye ».
 *  - echeance atteinte, retard de 7 jours ou moins : supprimer. A : relecture,
 *    verrou, destruction. Pas A : simulation (compte et log de l'id).
 *  - echeance atteinte, retard de plus de 7 jours, motif « inactive » :
 *    replanifier_inactive. E : re-avertit puis echeance = maintenant + 30 jours,
 *    sinon rien. Identique avec A vrai ou faux.
 *  - echeance atteinte, retard de plus de 7 jours, motif « vide » :
 *    replanifier_vide. Echeance = maintenant + 30 jours, sans email.
 * Une suppression n'est donc jamais faite (ni simulee) pour une echeance en retard.
 *
 * Plafonds : MAX_ACTIONS_PAR_PASSAGE actions, MAX_EMAILS_PAR_PASSAGE mails
 * envoyes, BUDGET_TEMPS_MS de temps ; au-dela, `tronque: true` et le reste
 * attend le lendemain (traitement par activite la plus ancienne d'abord).
 */
export async function executerNettoyage({
  maintenant = new Date(),
  env = process.env,
}: {
  maintenant?: Date;
  env?: EnvEnvoi & { NETTOYAGE_AUTO_ACTIF?: string };
} = {}): Promise<RapportNettoyage> {
  const debutMs = Date.now();
  const suppressionAuto = suppressionAutoActive(env);
  const envoiReel = envoiReelPossible(env);
  const rapport: RapportNettoyage = {
    evaluees: 0,
    ignorees: 0,
    planifiees: 0,
    avertissements: 0,
    avertissementsNonEnvoyes: 0,
    replanifiees: 0,
    annulees: 0,
    supprimees: 0,
    simulees: 0,
    erreurs: 0,
    tronque: false,
    suppressionAutoActive: suppressionAuto,
    envoiReelPossible: envoiReel,
  };

  await connectDB();
  const colocations = await HouseholdModel.find({}).select(CHAMPS_LUS).lean<ColocationLue[]>();
  // UNE seule fois pour toutes les colocations (5 requetes au total).
  const activites = await dernieresActivites(colocations.map((c) => c._id.toString()));

  const aTraiter = ordonnerParActiviteAncienne(
    colocations.map((colocation) => {
      const id = colocation._id.toString();
      return { id, derniereActivite: activites.get(id) ?? null, colocation };
    })
  );

  const contexte: Contexte = { maintenant, rapport, etat: { mails: 0 } };
  let actionsFaites = 0;

  for (const { id, derniereActivite: activite, colocation } of aTraiter) {
    // Horloge reelle : `maintenant` est fige (injectable), il ne mesure pas la duree.
    if (tempsEpuise(debutMs, Date.now())) {
      rapport.tronque = true;
      break;
    }
    rapport.evaluees++;
    try {
      const entree = entreeDepuisColocation(colocation, activite);
      const decision = evaluerNettoyage(entree, maintenant);
      const action = actionCronPour(decision, entree.suppressionPrevueLe, maintenant);

      if (actionConsommeBudget(action, { envoiReel, suppressionAuto })) {
        if (
          budgetEpuise(actionsFaites) ||
          (actionAvertit(action) && !peutAvertir(contexte.etat.mails, entree.nombreMembres))
        ) {
          rapport.tronque = true;
          continue;
        }
        // Reserve a la tentative, pas au succes : un echec de Resend ne doit
        // pas permettre d'enchainer des centaines d'envois dans une seule fonction.
        actionsFaites++;
      }

      switch (action) {
        case "ignorer":
          rapport.ignorees++;
          break;
        case "rien":
          break;
        case "planifier_vide":
          // Sans envoi reel possible on ne planifie rien : une suppression dont
          // l'ancien membre n'a pu etre prevenu serait sans preavis reel.
          if (envoiReel && decision.action === "planifier_vide") {
            await planifierVide(colocation, decision, contexte);
          }
          break;
        case "annuler":
          await annulerPlan(colocation, contexte);
          break;
        case "avertir_inactive":
          if (!envoiReel) {
            rapport.avertissementsNonEnvoyes++;
          } else if (decision.action === "avertir_inactive") {
            await avertirInactive(colocation, decision, entree, contexte);
          }
          break;
        case "replanifier_inactive":
          if (!envoiReel) {
            rapport.avertissementsNonEnvoyes++;
          } else {
            await reavertirInactive(colocation, entree, contexte);
          }
          break;
        case "replanifier_vide":
          await replanifierVide(colocation, contexte);
          break;
        case "supprimer":
          if (!suppressionAuto) {
            rapport.simulees++;
            console.log(`[nettoyage] simulation, aurait supprimé : ${id}`);
          } else if (decision.action === "supprimer") {
            await supprimerSiToujoursValide(colocation, decision.motif, contexte);
          }
          break;
      }
    } catch (e) {
      rapport.erreurs++;
      console.error(
        `[nettoyage] erreur sur la colocation ${id} : ${e instanceof Error ? e.name : "erreur inconnue"}`
      );
    }
  }

  console.log(`[nettoyage] ${JSON.stringify(rapport)}`);
  return rapport;
}
