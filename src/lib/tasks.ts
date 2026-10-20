import { Types, type HydratedDocument } from "mongoose";
import HouseholdModel from "@/models/Household";
import TaskModel, { type Task } from "@/models/Task";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import { estObjectIdValide } from "@/lib/ids";

export type StatutTache = "todo" | "in_progress" | "done";
export type RecurrenceRepetitive = "weekly" | "monthly";

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

function estRecurrente(recurrence: string): recurrence is RecurrenceRepetitive {
  return recurrence === "weekly" || recurrence === "monthly";
}

/**
 * Qui peut deplacer une tache dans le Kanban ou la marquer faite : les
 * assignes et l'admin (decision de Tanguy). Une tache sans aucun assigne
 * serait sinon bloquee pour tout le monde sauf l'admin, donc dans ce cas
 * n'importe quel membre peut agir. Cette fonction ne verifie PAS que
 * userId est membre de la colocation : c'est le travail de
 * getHouseholdForMember, appele avant dans la route.
 */
export function peutChangerStatut(
  assignedTo: string[],
  userId: string,
  estAdmin: boolean
): boolean {
  if (estAdmin) return true;
  if (assignedTo.length === 0) return true;
  return assignedTo.includes(userId);
}

/**
 * Modifier le contenu (titre, assignes, recurrence...) ou supprimer : le
 * createur ou l'admin, comme pour les depenses. Les assignes n'ont PAS ce
 * droit, sinon un assigne pourrait se desassigner d'une corvee ou la
 * supprimer pour s'en debarrasser.
 */
export function peutModifierTache(
  createdBy: string,
  userId: string,
  estAdmin: boolean
): boolean {
  return estAdmin || createdBy === userId;
}

/**
 * Rotation : chaque assigne est remplace par le membre suivant dans l'ordre
 * d'anciennete (liste deja triee par joinedAt croissant, circulaire : le
 * dernier est suivi du premier). Avec plusieurs assignes, tous avancent d'un
 * cran ensemble : comme ce decalage est une bijection sur les membres, le
 * resultat n'a ni doublon ni perte (A,B -> B,C et non B,B). Un assigne qui
 * n'est plus membre est ignore plutot que de faire planter la rotation :
 * on ne sait pas qui serait "le suivant" d'un absent. L'ordre du resultat
 * suit celui des assignes d'entree.
 */
export function assignesSuivants(
  assignedTo: string[],
  membresParAnciennete: string[]
): string[] {
  const n = membresParAnciennete.length;
  const suivants: string[] = [];
  for (const userId of new Set(assignedTo)) {
    const index = membresParAnciennete.indexOf(userId);
    if (index === -1) continue;
    suivants.push(membresParAnciennete[(index + 1) % n]);
  }
  // Filet de securite si la liste d'anciennete contenait un doublon.
  return [...new Set(suivants)];
}

/**
 * Trie les membres d'une colocation par anciennete (joinedAt croissant) et
 * ne garde que les ids, pour alimenter assignesSuivants. Egalite de date
 * departagee par l'id, sinon l'ordre dependrait de l'ordre de stockage et la
 * rotation ne serait pas reproductible. Fonction pure pour etre testable
 * sans base.
 */
export function membresParAnciennete(
  members: { userId: { toString(): string }; joinedAt?: Date | null }[]
): string[] {
  return members
    .map((m) => ({ id: m.userId.toString(), t: m.joinedAt ? m.joinedAt.getTime() : 0 }))
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((m) => m.id);
}

/**
 * Echeance de la prochaine occurrence a partir de `depuis` (la date de
 * COMPLETION, pas l'ancienne echeance : si on termine en retard, la
 * prochaine echeance est calculee depuis ce jour-la). Tout se fait en UTC :
 * les methodes locales de Date dependent du fuseau et du changement d'heure,
 * et un +7 jours pourrait alors tomber a 23h ou 1h.
 *
 * Mensuel avec ecretage de fin de mois : 31 janvier + 1 mois = 28 ou 29
 * fevrier. Sans ca, Date "debordrait" sur le mois suivant (31 fev = 3 mars).
 */
export function prochaineEcheance(
  recurrence: RecurrenceRepetitive,
  depuis: Date
): Date {
  if (Number.isNaN(depuis.getTime())) {
    throw new RangeError("Date de depart invalide");
  }

  if (recurrence === "weekly") {
    return new Date(depuis.getTime() + 7 * MS_PAR_JOUR);
  }
  if (recurrence === "monthly") {
    const annee = depuis.getUTCFullYear();
    const mois = depuis.getUTCMonth();
    // Jour 0 du mois d'apres = dernier jour du mois cible. Date.UTC gere
    // seul le passage de decembre a janvier (mois 12 -> annee + 1).
    const joursDansMoisCible = new Date(Date.UTC(annee, mois + 2, 0)).getUTCDate();
    const jour = Math.min(depuis.getUTCDate(), joursDansMoisCible);
    return new Date(
      Date.UTC(
        annee,
        mois + 1,
        jour,
        depuis.getUTCHours(),
        depuis.getUTCMinutes(),
        depuis.getUTCSeconds(),
        depuis.getUTCMilliseconds()
      )
    );
  }
  throw new Error(`Recurrence non repetitive : ${String(recurrence)}`);
}

/**
 * Ce dont on a besoin d'une tache pour fabriquer la suivante. Type minimal
 * (ids en string, pas de document Mongoose) pour que les tests puissent
 * passer des objets simples.
 */
export type TacheSource = {
  householdId: string;
  title: string;
  description?: string | null;
  recurrence: RecurrenceRepetitive;
  rotation: boolean;
  createdBy: string;
  assignedTo: string[];
};

/** Objet pret a passer a Task.create (Mongoose convertit les ids en ObjectId). */
export type NouvelleOccurrence = {
  householdId: string;
  title: string;
  description?: string;
  recurrence: RecurrenceRepetitive;
  rotation: boolean;
  createdBy: string;
  status: "todo";
  dueDate: Date;
  assignedTo: string[];
  occurrenceGeneree: false;
};

/**
 * Fabrique la prochaine occurrence d'une tache recurrente terminee. Pas de
 * completedAt ni completedBy : la nouvelle tache n'est pas faite. Sans
 * rotation, les assignes restent les memes (copie, pour ne pas partager le
 * meme tableau avec la tache source).
 */
export function construireProchaineOccurrence(
  tache: TacheSource,
  membresParAnciennete: string[],
  completedAt: Date
): NouvelleOccurrence {
  return {
    householdId: tache.householdId,
    title: tache.title,
    ...(tache.description ? { description: tache.description } : {}),
    recurrence: tache.recurrence,
    rotation: tache.rotation,
    createdBy: tache.createdBy,
    status: "todo",
    dueDate: prochaineEcheance(tache.recurrence, completedAt),
    assignedTo: tache.rotation
      ? assignesSuivants(tache.assignedTo, membresParAnciennete)
      : [...tache.assignedTo],
    occurrenceGeneree: false,
  };
}

/**
 * Charge une tache ET verifie qu'elle appartient bien a householdId - meme
 * logique anti-cross-tenant que getExpenseInHousehold : sans ca, un membre
 * pourrait agir sur la tache d'une AUTRE colocation en devinant son id.
 */
export async function getTaskInHousehold(householdId: string, taskId: string) {
  await connectDB();
  const task = await TaskModel.findOne({ _id: taskId, householdId });
  return task;
}

/**
 * Ne garde des assignes que ceux qui sont encore membres (ordre conserve).
 * Fonction pure pour etre testable sans base.
 */
export function filtrerAssignesActuels(
  assignedTo: string[],
  membresIds: string[]
): string[] {
  const membres = new Set(membresIds);
  return assignedTo.filter((id) => membres.has(id));
}

export type ResultatChangementStatut = {
  tache: HydratedDocument<Task>;
  /** Renseignee seulement si une occurrence suivante vient d'etre creee. */
  nouvelleOccurrence: HydratedDocument<Task> | null;
};

/**
 * Applique un changement de statut sur une tache DEJA chargee par
 * getTaskInHousehold (donc deja verifiee comme appartenant a la colocation).
 * Les droits (peutChangerStatut) sont a verifier par la route AVANT l'appel.
 *
 *  - vers "done" : completedAt = maintenant, completedBy = userId ; si la
 *    tache est recurrente et que l'occurrence suivante n'a pas deja ete
 *    creee, on la cree (rotation incluse) ;
 *  - sortie de "done" : completedAt et completedBy effaces. Le verrou
 *    occurrenceGeneree, lui, reste a true (c'est tout son but) ;
 *  - meme statut qu'avant : rien ne change (sinon un double envoi
 *    reecrirait completedAt).
 *
 * `maintenant` est injectable pour pouvoir figer la date dans un test.
 */
export async function changerStatutTache(
  tache: HydratedDocument<Task>,
  nouveauStatut: StatutTache,
  userId: string,
  maintenant: Date = new Date()
): Promise<ResultatChangementStatut> {
  if (tache.status === nouveauStatut) {
    return { tache, nouvelleOccurrence: null };
  }

  await connectDB();
  const versDone = nouveauStatut === "done";
  const sortDeDone = tache.status === "done";

  // Une tache "fait" garde ses assignes pour l'historique, meme partis. En la
  // rouvrant, on ne garde que les membres actuels : si plus aucun ne reste,
  // elle redevient "sans assigne" donc ouverte a tout membre, au lieu d'etre
  // bloquee par des fantomes. Le household est charge avant le save.
  const household = await HouseholdModel.findById(tache.householdId);
  if (sortDeDone && household) {
    const actuels = filtrerAssignesActuels(
      tache.assignedTo.map((id) => id.toString()),
      household.members.map((m: { userId: { toString(): string } }) => m.userId.toString())
    );
    if (actuels.length !== tache.assignedTo.length) {
      tache.assignedTo = actuels as unknown as typeof tache.assignedTo;
    }
  }

  tache.status = nouveauStatut;
  if (versDone) {
    tache.completedAt = maintenant;
    tache.completedBy = new Types.ObjectId(userId);
  } else if (sortDeDone) {
    tache.completedAt = undefined;
    tache.completedBy = undefined;
  }
  await tache.save();

  if (!versDone || !estRecurrente(tache.recurrence)) {
    return { tache, nouvelleOccurrence: null };
  }

  if (!household) return { tache, nouvelleOccurrence: null };

  // On "reserve" la creation par une mise a jour atomique conditionnelle :
  // si deux personnes terminent la meme tache a la fois, une seule voit
  // occurrenceGeneree passer de false a true, l'autre recoit null. Un simple
  // "lire le champ puis ecrire" laisserait passer les deux.
  const reservee = await TaskModel.findOneAndUpdate(
    { _id: tache._id, occurrenceGeneree: false },
    { $set: { occurrenceGeneree: true } },
    { returnDocument: "after" }
  );
  if (!reservee) return { tache, nouvelleOccurrence: null };

  try {
    const occurrence = construireProchaineOccurrence(
      {
        householdId: tache.householdId.toString(),
        title: tache.title,
        description: tache.description,
        recurrence: tache.recurrence,
        rotation: tache.rotation,
        createdBy: tache.createdBy.toString(),
        assignedTo: tache.assignedTo.map((id) => id.toString()),
      },
      membresParAnciennete(household.members),
      maintenant
    );
    const nouvelleOccurrence = await TaskModel.create(occurrence);
    return { tache: reservee, nouvelleOccurrence };
  } catch (err) {
    // Creation echouee : on rend le verrou, sinon la tache ne produirait
    // jamais sa suite meme apres un nouvel essai.
    await TaskModel.updateOne({ _id: tache._id }, { $set: { occurrenceGeneree: false } });
    throw err;
  }
}

/**
 * Retire userId des assignes de toutes les taches NON terminees de la
 * colocation (membre qui part ou retire par l'admin) : sans ca, des taches
 * resteraient assignees a un fantome. Les taches "fait" gardent leurs
 * assignes, car elles servent d'historique. Une tache qui se retrouve sans
 * assigne devient ouverte a tous (voir peutChangerStatut). Renvoie le
 * nombre de taches modifiees.
 */
export async function retirerMembreDesTaches(
  householdId: string,
  userId: string
): Promise<number> {
  await connectDB();
  const res = await TaskModel.updateMany(
    { householdId, status: { $ne: "done" }, assignedTo: userId },
    { $pull: { assignedTo: userId } }
  );
  return res.modifiedCount;
}

// Deplacee dans ids.ts (utilisee aussi par households.ts) ; re-exportee ici
// pour ne rien casser chez les importeurs existants.
export { estObjectIdValide };

/**
 * Regles communes a la creation et a la modification d'une tache : les
 * assignes doivent etre membres de la colocation, et la rotation n'a de sens
 * que pour une tache recurrente (elle joue a la creation de l'occurrence
 * suivante). Renvoie le message d'erreur a afficher, ou null si tout va bien.
 * `estMembre` est injecte pour que la fonction reste pure et testable sans
 * base. A la modification, la route passe les valeurs FINALES (champ recu,
 * sinon valeur deja stockee) pour recurrence et rotation.
 */
export function validerAssignesEtRotation(
  entree: { assignedTo: string[]; recurrence: string; rotation: boolean },
  estMembre: (userId: string) => boolean
): string | null {
  if (!entree.assignedTo.every(estMembre)) {
    return "Une personne assignée ne fait pas partie de la colocation";
  }
  if (entree.rotation && entree.recurrence === "none") {
    return "La rotation n'est possible que pour une tâche hebdomadaire ou mensuelle";
  }
  return null;
}

/** Combien de temps une tache terminee reste dans la colonne "Fait" du Kanban. */
export const JOURS_FAIT_DANS_KANBAN = 7;

/**
 * Taches affichees dans le Kanban : toutes celles qui ne sont pas terminees
 * + celles terminees depuis moins de JOURS_FAIT_DANS_KANBAN jours. Les plus
 * anciennes ne sont que dans l'historique, sinon la colonne "Fait" grossirait
 * sans fin. Renvoie des documents : la page appelle serializeTasks.
 * `maintenant` est injectable pour figer la date dans un test.
 */
export async function listerTachesKanban(
  householdId: string,
  maintenant: Date = new Date()
): Promise<HydratedDocument<Task>[]> {
  await connectDB();
  const seuil = new Date(maintenant.getTime() - JOURS_FAIT_DANS_KANBAN * MS_PAR_JOUR);
  return TaskModel.find({
    householdId,
    $or: [{ status: { $ne: "done" } }, { completedAt: { $gte: seuil } }],
  }).sort({ createdAt: 1 });
}

/** Plafond de ?page= : evite un skip astronomique envoye a Mongo. */
const PAGE_HISTORIQUE_MAX = 100000;

export type PageHistorique = {
  taches: HydratedDocument<Task>[];
  /** Nombre total de taches terminees (toutes pages confondues). */
  total: number;
  page: number;
  parPage: number;
  /** Vrai s'il existe une page apres celle-ci. */
  pageSuivante: boolean;
};

/**
 * Historique : toutes les taches terminees, la plus recente en premier,
 * paginees (page 1 = la plus recente). Une page invalide (0, negative,
 * decimale) est ramenee a 1 plutot que de produire un skip negatif, que
 * Mongo refuse. Renvoie des documents : la page appelle serializeTasks.
 */
export async function listerHistorique(
  householdId: string,
  page = 1,
  parPage = 30
): Promise<PageHistorique> {
  await connectDB();
  const pageSure =
    Number.isSafeInteger(page) && page >= 1 ? Math.min(page, PAGE_HISTORIQUE_MAX) : 1;
  const parPageSur = Number.isInteger(parPage) && parPage >= 1 ? parPage : 30;

  const filtre = { householdId, status: "done" };
  const [taches, total] = await Promise.all([
    TaskModel.find(filtre)
      // _id en second critere : deux taches terminees a la meme milliseconde
      // sinon changeraient d'ordre d'une page a l'autre.
      .sort({ completedAt: -1, _id: -1 })
      .skip((pageSure - 1) * parPageSur)
      .limit(parPageSur),
    TaskModel.countDocuments(filtre),
  ]);

  return {
    taches,
    total,
    page: pageSure,
    parPage: parPageSur,
    pageSuivante: pageSure * parPageSur < total,
  };
}

export type PersonneNommee = { userId: string; name: string };

export type TacheDetail = {
  id: string;
  title: string;
  description: string | null;
  status: StatutTache;
  recurrence: "none" | "weekly" | "monthly";
  rotation: boolean;
  dueDate: string | null;
  completedAt: string | null;
  assignes: PersonneNommee[];
  creePar: PersonneNommee;
  faitPar: PersonneNommee | null;
  peuxChangerStatut: boolean;
  peuxModifier: boolean;
};

/**
 * Met en forme des taches pour l'API/les pages : meme principe que
 * serializeExpenses, les noms (assignes, createur, personne qui a termine)
 * sont recuperes en UNE seule requete groupee, pas une par tache (N+1).
 * Les deux booleens de droits sont calcules ici avec les memes fonctions
 * pures que les routes, pour que l'UI n'affiche jamais un bouton que le
 * serveur refuserait.
 */
export async function serializeTasks(
  taches: HydratedDocument<Task>[],
  viewerId: string,
  viewerEstAdmin: boolean
): Promise<TacheDetail[]> {
  await connectDB();

  const idsUtilisateurs = new Set<string>();
  for (const t of taches) {
    for (const a of t.assignedTo) idsUtilisateurs.add(a.toString());
    idsUtilisateurs.add(t.createdBy.toString());
    if (t.completedBy) idsUtilisateurs.add(t.completedBy.toString());
  }

  const users = await UserModel.find({ _id: { $in: [...idsUtilisateurs] } }, "name");
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));
  const nom = (id: string) => usersById.get(id)?.name ?? "Utilisateur supprimé";
  const personne = (id: string): PersonneNommee => ({ userId: id, name: nom(id) });

  return taches.map((t) => {
    const assigneIds = t.assignedTo.map((a) => a.toString());
    const createurId = t.createdBy.toString();
    return {
      id: t._id.toString(),
      title: t.title,
      description: t.description ?? null,
      status: t.status as StatutTache,
      recurrence: t.recurrence as TacheDetail["recurrence"],
      rotation: t.rotation,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      assignes: assigneIds.map(personne),
      creePar: personne(createurId),
      faitPar: t.completedBy ? personne(t.completedBy.toString()) : null,
      peuxChangerStatut: peutChangerStatut(assigneIds, viewerId, viewerEstAdmin),
      peuxModifier: peutModifierTache(createurId, viewerId, viewerEstAdmin),
    };
  });
}
