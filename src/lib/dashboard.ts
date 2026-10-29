import type { HydratedDocument } from "mongoose";
import ExpenseModel, { type Expense } from "@/models/Expense";
import HouseholdModel from "@/models/Household";
import TaskModel, { type Task } from "@/models/Task";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import { serializeExpenses, type DepenseDetail } from "@/lib/expenses";
import { calculerSoldesNets } from "@/lib/settlements";
import { serializeTasks, type TacheDetail } from "@/lib/tasks";

const ANNEE_MIN = 2000;
const ANNEE_MAX = 2100;
const NB_DERNIERES_DEPENSES = 5;
const NB_TACHES_AFFICHEES = 5;

// ---------------------------------------------------------------------------
// Mois navigable (?mois=YYYY-MM)
// ---------------------------------------------------------------------------

export type MoisDashboard = {
  /** "YYYY-MM", la valeur a remettre dans ?mois= */
  cle: string;
  annee: number;
  /** 1 a 12 */
  mois: number;
  /** 1er du mois a 00:00 UTC (inclus) */
  debut: Date;
  /** 1er du mois SUIVANT a 00:00 UTC (borne EXCLUE) */
  fin: Date;
  /** null si l'annee sortirait de 2000..2100 */
  precedent: string | null;
  /** null pour le mois courant ou un mois posterieur : pas de navigation vers le futur */
  suivant: string | null;
  estMoisCourant: boolean;
};

function formaterCle(annee: number, mois: number): string {
  return `${annee}-${String(mois).padStart(2, "0")}`;
}

/**
 * Transforme le parametre ?mois= en bornes de mois. Tout ce qui n'est pas
 * EXACTEMENT "YYYY-MM" (mois 01 a 12, annee 2000 a 2100) retombe sur le mois
 * courant au lieu de lever une erreur : le parametre vient de l'URL, donc d'un
 * client qu'on ne controle pas, et une page de dashboard ne doit jamais
 * planter a cause d'un lien mal copie. Tout en UTC, parce que les dates de
 * depenses sont stockees a minuit UTC : des bornes locales decaleraient les
 * depenses du 1er et du dernier jour d'un mois a l'autre selon le fuseau.
 *
 * Un mois futur bien forme est accepte tel quel (il est juste vide) ; seule la
 * navigation `suivant` refuse d'y mener.
 */
export function parserMois(param: string | undefined, maintenant: Date): MoisDashboard {
  const anneeCourante = maintenant.getUTCFullYear();
  const moisCourant = maintenant.getUTCMonth() + 1;
  const cleCourante = formaterCle(anneeCourante, moisCourant);

  let annee = anneeCourante;
  let mois = moisCourant;
  // Pas de .trim() : une chaine avec espaces est consideree mal formee.
  const m = param === undefined ? null : /^(\d{4})-(\d{2})$/.exec(param);
  if (m) {
    const a = Number(m[1]);
    const mo = Number(m[2]);
    if (a >= ANNEE_MIN && a <= ANNEE_MAX && mo >= 1 && mo <= 12) {
      annee = a;
      mois = mo;
    }
  }

  const cle = formaterCle(annee, mois);
  // Date.UTC gere seul les debordements (mois 12 + 1 -> janvier suivant).
  // setUTCFullYear n'est pas necessaire : annee >= 2000 evite le piege des
  // annees 0 a 99 que Date.UTC interprete comme 1900 a 1999.
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 1));

  const anneePrecedente = mois === 1 ? annee - 1 : annee;
  const moisPrecedent = mois === 1 ? 12 : mois - 1;
  const precedent =
    anneePrecedente < ANNEE_MIN ? null : formaterCle(anneePrecedente, moisPrecedent);

  const anneeSuivante = mois === 12 ? annee + 1 : annee;
  const moisSuivant = mois === 12 ? 1 : mois + 1;
  // Cles "YYYY-MM" de meme longueur : la comparaison de chaines suit l'ordre
  // chronologique.
  const futur = cle >= cleCourante;
  const suivant =
    futur || anneeSuivante > ANNEE_MAX ? null : formaterCle(anneeSuivante, moisSuivant);

  return {
    cle,
    annee,
    mois,
    debut,
    fin,
    precedent,
    suivant,
    estMoisCourant: cle === cleCourante,
  };
}

// ---------------------------------------------------------------------------
// Depenses par categorie
// ---------------------------------------------------------------------------

// Ordre fixe : sert d'ordre de depart et de departage des egalites. "autre"
// est aussi la categorie de repli pour une valeur inconnue.
// Exporte pour que le recapitulatif mensuel nomme les categories avec la meme
// source que le graphique, au lieu d'une quatrieme copie de la liste.
export const CATEGORIES_DEPENSE = [
  { category: "courses", label: "Courses" },
  { category: "factures", label: "Factures" },
  { category: "loyer", label: "Loyer" },
  { category: "sorties", label: "Sorties" },
  { category: "autre", label: "Autre" },
] as const;

export type TotalCategorie = {
  category: string;
  label: string;
  /** euros */
  total: number;
  /** entier ; la somme de la liste vaut exactement 100 */
  pourcentage: number;
};

export type TotauxCategories = {
  categories: TotalCategorie[];
  /** euros */
  total: number;
};

/**
 * Somme des depenses par categorie, pour le graphique. Les sommes se font en
 * centimes entiers (meme raison que partout : 0.1 + 0.2 !== 0.3).
 *
 * Les pourcentages sont des entiers dont la somme fait exactement 100, sinon
 * un camembert afficherait 33 % + 33 % + 33 % = 99 %. Methode du plus fort
 * reste : on prend la partie entiere de chaque part, puis on donne les points
 * manquants aux categories dont la partie decimale perdue est la plus grande.
 * Le calcul reste en entiers (centimes * 100 et reste de division) pour ne pas
 * comparer des flottants qui seraient presque egaux.
 */
export function totauxParCategorie(
  depenses: { category: string; amount: number }[]
): TotauxCategories {
  const centimesParCategorie = new Map<string, number>(
    CATEGORIES_DEPENSE.map((c) => [c.category, 0])
  );
  for (const d of depenses) {
    const centimes = Math.round(d.amount * 100);
    if (!Number.isFinite(centimes)) continue;
    const cle = centimesParCategorie.has(d.category) ? d.category : "autre";
    centimesParCategorie.set(cle, (centimesParCategorie.get(cle) ?? 0) + centimes);
  }

  const lignes = CATEGORIES_DEPENSE.map((c, ordre) => ({
    category: c.category,
    label: c.label,
    ordre,
    centimes: centimesParCategorie.get(c.category) ?? 0,
  })).filter((l) => l.centimes > 0);

  const totalCentimes = lignes.reduce((s, l) => s + l.centimes, 0);
  if (totalCentimes === 0) return { categories: [], total: 0 };

  const parts = lignes.map((l) => ({
    ...l,
    base: Math.floor((l.centimes * 100) / totalCentimes),
    reste: (l.centimes * 100) % totalCentimes,
  }));

  const manquants = 100 - parts.reduce((s, p) => s + p.base, 0);
  const parRestes = [...parts].sort(
    (a, b) => b.reste - a.reste || b.centimes - a.centimes || a.ordre - b.ordre
  );
  const bonus = new Map<string, number>();
  for (let i = 0; i < manquants; i++) bonus.set(parRestes[i].category, 1);

  const categories = parts
    .sort((a, b) => b.centimes - a.centimes || a.ordre - b.ordre)
    .map((p) => ({
      category: p.category,
      label: p.label,
      total: p.centimes / 100,
      pourcentage: p.base + (bonus.get(p.category) ?? 0),
    }));

  return { categories, total: totalCentimes / 100 };
}

// ---------------------------------------------------------------------------
// Taches en cours
// ---------------------------------------------------------------------------

type TacheTriable = {
  _id: { toString(): string };
  dueDate?: Date | null;
  createdAt?: Date | null;
};

/**
 * Parmi des taches NON terminees : les `limite` premieres a afficher, le total
 * et le nombre en retard. Tri par echeance croissante, les sans-echeance en
 * dernier (Mongo les mettrait en PREMIER en tri croissant, d'ou le tri ici),
 * puis par date de creation, puis par _id pour un ordre reproductible.
 *
 * En retard = echeance strictement avant le debut du jour UTC courant : une
 * tache due aujourd'hui n'est pas en retard (meme regle que le Kanban, jour
 * UTC). Pure : une seule lecture en base suffit pour les trois resultats, au
 * lieu de deux comptages en plus.
 */
export function selectionnerTachesEnCours<T extends TacheTriable>(
  taches: T[],
  maintenant: Date,
  limite = NB_TACHES_AFFICHEES
): { aAfficher: T[]; nbTachesEnCours: number; nbTachesEnRetard: number } {
  const debutDuJour = Date.UTC(
    maintenant.getUTCFullYear(),
    maintenant.getUTCMonth(),
    maintenant.getUTCDate()
  );
  const echeance = (t: T) => (t.dueDate ? t.dueDate.getTime() : Infinity);
  const creation = (t: T) => (t.createdAt ? t.createdAt.getTime() : 0);

  const triees = [...taches].sort((a, b) => {
    const ea = echeance(a);
    const eb = echeance(b);
    if (ea !== eb) return ea < eb ? -1 : 1;
    const ca = creation(a);
    const cb = creation(b);
    if (ca !== cb) return ca - cb;
    const ia = a._id.toString();
    const ib = b._id.toString();
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  return {
    aAfficher: triees.slice(0, limite),
    nbTachesEnCours: taches.length,
    nbTachesEnRetard: taches.filter((t) => t.dueDate && t.dueDate.getTime() < debutDuJour)
      .length,
  };
}

// ---------------------------------------------------------------------------
// Fonctions base
// ---------------------------------------------------------------------------

export type SoldeMembre = {
  userId: string;
  name: string;
  /** euros ; positif = on lui doit de l'argent, negatif = il doit */
  amount: number;
};

/**
 * Solde de tous les membres ACTUELS, y compris ceux a 0 (le dashboard doit
 * montrer "a jour" plutot que de les faire disparaitre). Un solde qui
 * appartient a quelqu'un qui n'est plus membre (parti avec une dette) est
 * ignore ici. Ordre : plus gros creancier d'abord, puis les a-jour, puis les
 * debiteurs du plus lourd au moins lourd. Les noms viennent d'UNE requete.
 */
export async function calculerSoldesMembres(householdId: string): Promise<SoldeMembre[]> {
  await connectDB();
  const [household, soldes] = await Promise.all([
    HouseholdModel.findById(householdId, "members"),
    calculerSoldesNets(householdId),
  ]);
  if (!household) return [];

  const membreIds: string[] = household.members.map((m: { userId: { toString(): string } }) =>
    m.userId.toString()
  );
  const users = await UserModel.find({ _id: { $in: membreIds } }, "name");
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));

  const resultat = membreIds.map((userId) => {
    const centimes = soldes.get(userId) ?? 0;
    return {
      userId,
      name: usersById.get(userId)?.name ?? "Utilisateur supprimé",
      // Entiers en entree (sommes de Math.round), mais on ecrase aussi un
      // eventuel -0 pour qu'il ne s'affiche jamais "-0,00 €".
      amount: Math.abs(centimes) < 1 ? 0 : Math.round(centimes) / 100,
    };
  });

  // Rang 0 = creanciers, 1 = a jour, 2 = debiteurs. Dans un meme rang, le
  // montant absolu le plus grand d'abord (ce qui donne bien "plus lourd au
  // moins lourd" pour les dettes), puis le nom pour un ordre reproductible.
  const rang = (a: number) => (a > 0 ? 0 : a === 0 ? 1 : 2);
  return resultat.sort(
    (a, b) =>
      rang(a.amount) - rang(b.amount) ||
      Math.abs(b.amount) - Math.abs(a.amount) ||
      a.name.localeCompare(b.name, "fr") ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );
}

/**
 * Solde net de userId dans chacune de ses colocations (euros, signe, 0 si a
 * jour), pour la ligne de solde de /tableau-de-bord. Une colocation sans
 * depense donne 0. Les colocations sont calculees en parallele.
 */
export async function soldesPourUtilisateur(
  householdIds: string[],
  userId: string
): Promise<Map<string, number>> {
  const soldes = await Promise.all(
    householdIds.map(async (id) => {
      const centimes = (await calculerSoldesNets(id)).get(userId) ?? 0;
      return [id, Math.abs(centimes) < 1 ? 0 : Math.round(centimes) / 100] as const;
    })
  );
  return new Map(soldes);
}

export type DonneesDashboard = {
  mois: MoisDashboard;
  categories: TotalCategorie[];
  /** euros */
  totalMois: number;
  soldes: SoldeMembre[];
  dernieresDepenses: DepenseDetail[];
  tachesEnCours: TacheDetail[];
  nbTachesEnCours: number;
  nbTachesEnRetard: number;
};

/**
 * Tout ce que la section dashboard de /colocations/[id] affiche. Les lectures
 * independantes partent ensemble (Promise.all), puis la mise en forme des
 * depenses et des taches (une requete de noms chacune, pas une par ligne).
 *
 * Les taches non terminees sont lues en une fois puis triees en memoire : le
 * tri "echeance croissante, sans echeance en dernier" n'existe pas en Mongo
 * simple, et le Kanban charge deja toutes ces memes taches. Le total et le
 * nombre en retard en sortent gratuitement, sans requete de comptage.
 */
export async function donneesDashboard(
  householdId: string,
  moisParam: string | undefined,
  viewerId: string,
  viewerEstAdmin: boolean,
  maintenant: Date = new Date()
): Promise<DonneesDashboard> {
  await connectDB();
  const mois = parserMois(moisParam, maintenant);

  const [depensesDuMois, dernieres, tachesOuvertes, soldes] = await Promise.all([
    // lean + projection : on a juste besoin de category et amount.
    ExpenseModel.find(
      { householdId, date: { $gte: mois.debut, $lt: mois.fin } },
      "category amount"
    ).lean() as Promise<{ category: string; amount: number }[]>,
    ExpenseModel.find({ householdId })
      // _id en second critere : deux depenses du meme jour (minuit UTC) auraient
      // sinon un ordre instable d'un affichage a l'autre.
      .sort({ date: -1, _id: -1 })
      .limit(NB_DERNIERES_DEPENSES) as Promise<HydratedDocument<Expense>[]>,
    TaskModel.find({ householdId, status: { $ne: "done" } }) as Promise<
      HydratedDocument<Task>[]
    >,
    calculerSoldesMembres(householdId),
  ]);

  const { aAfficher, nbTachesEnCours, nbTachesEnRetard } = selectionnerTachesEnCours(
    tachesOuvertes,
    maintenant
  );
  const { categories, total } = totauxParCategorie(depensesDuMois);

  const [dernieresDepenses, tachesEnCours] = await Promise.all([
    serializeExpenses(dernieres, viewerId, viewerEstAdmin),
    serializeTasks(aAfficher, viewerId, viewerEstAdmin),
  ]);

  return {
    mois,
    categories,
    totalMois: total,
    soldes,
    dernieresDepenses,
    tachesEnCours,
    nbTachesEnCours,
    nbTachesEnRetard,
  };
}
