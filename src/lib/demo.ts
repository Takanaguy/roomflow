import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import ExpenseModel from "@/models/Expense";
import HouseholdModel from "@/models/Household";
import SettlementModel from "@/models/Settlement";
import ShoppingItemModel from "@/models/ShoppingItem";
import TaskModel from "@/models/Task";
import UserModel from "@/models/User";
import { COUT_BCRYPT } from "@/lib/auth-schemas";
import { DOMAINE_COLOCATAIRES_DEMO, emailCompteDemo } from "@/lib/demo-email";
import { resoudreRepartition, type RepartitionInput } from "@/lib/expenses";
import { detruireColocation } from "@/lib/households";
import { connectDB } from "@/lib/mongodb";
import { remboursementsDepense } from "@/lib/settlements";
import type { CategorieCourses } from "@/lib/shopping-constants";

/**
 * Compte de demonstration PARTAGE : un compte dont les identifiants sont dans
 * le README, avec une colocation d'exemple remplie de fausses donnees, remise
 * a zero chaque nuit par le cron de nettoyage. Ce fichier a deux parties : la
 * partie PURE (constantes, `demoActive`, `construireDonneesDemo`), testable
 * sans base, puis la partie BASE (`reinitialiserDemo`).
 */

// Reexportes : les constantes d'adresse vivent dans demo-email.ts (fichier sans
// import, pour que email.ts reste leger), mais on les cherche ici.
export { DEMO_EMAIL_PAR_DEFAUT, estEmailDemo } from "@/lib/demo-email";

// ---------------------------------------------------------------------------
// Constantes et activation (PUR)
// ---------------------------------------------------------------------------

export const NOM_COMPTE_DEMO = "Compte démo";
export const NOM_COLOCATION_DEMO = "Colocation Démo";
export const DESCRIPTION_COLOCATION_DEMO =
  "Colocation d'exemple avec des données fictives, remise à zéro chaque nuit.";

/** Colocataires FICTIFS. Adresses en `.invalid` (RFC 2606) : jamais livrables. */
export const COLOCATAIRES_DEMO = [
  { cle: "lea", nom: "Léa", email: `lea@${DOMAINE_COLOCATAIRES_DEMO}` },
  { cle: "hugo", nom: "Hugo", email: `hugo@${DOMAINE_COLOCATAIRES_DEMO}` },
  { cle: "camille", nom: "Camille", email: `camille@${DOMAINE_COLOCATAIRES_DEMO}` },
] as const;

/** Meme minimum que `motDePasseSchema` (8 caracteres). */
const LONGUEUR_MIN_MOT_DE_PASSE_DEMO = 8;

type EnvDemo = { DEMO_PASSWORD?: string; DEMO_EMAIL?: string; [cle: string]: string | undefined };

/**
 * Mot de passe du compte demo, lu UNIQUEMENT dans DEMO_PASSWORD (jamais ecrit
 * dans le code ni en base en clair). null = demo desactivee. Ce mot de passe
 * est PUBLIC (il est dans le README) : il ne doit jamais etre reutilise
 * ailleurs.
 */
export function motDePasseDemo(env: EnvDemo): string | null {
  const valeur = env.DEMO_PASSWORD;
  if (typeof valeur !== "string" || valeur.length < LONGUEUR_MIN_MOT_DE_PASSE_DEMO) return null;
  // Huit espaces atteignent la longueur mais font un mot de passe public trivial.
  if (valeur.trim() === "") return null;
  return valeur;
}

/**
 * La demo est active seulement si DEMO_PASSWORD est definie et assez longue.
 * Sinon rien n'est cree : pas de compte demo avec un mot de passe vide ou
 * devinable.
 */
export function demoActive(env: EnvDemo): boolean {
  return motDePasseDemo(env) !== null;
}

// ---------------------------------------------------------------------------
// Donnees de demonstration (PUR)
// ---------------------------------------------------------------------------

/** Un id d'utilisateur : une chaine ou un ObjectId (normalise en chaine). */
type IdUtilisateur = string | { toString(): string };

export type IdsDemo = {
  demo: IdUtilisateur;
  lea: IdUtilisateur;
  hugo: IdUtilisateur;
  camille: IdUtilisateur;
};

type Part = { userId: string; amount: number };

export type DepenseDemo = {
  payers: Part[];
  createdBy: string;
  amount: number;
  description: string;
  category: "courses" | "factures" | "loyer" | "sorties" | "autre";
  date: Date;
  splitType: "equal" | "custom";
  splits: Part[];
  createdAt: Date;
};

export type RemboursementDemo = {
  fromUserId: string;
  toUserId: string;
  amount: number;
  settledAt: Date;
};

export type TacheDemo = {
  title: string;
  description?: string;
  assignedTo: string[];
  status: "todo" | "in_progress" | "done";
  recurrence: "none" | "weekly" | "monthly";
  createdBy: string;
  rotation: boolean;
  dueDate?: Date;
  completedAt?: Date;
  completedBy?: string;
  occurrenceGeneree: boolean;
  rappelEnvoye: boolean;
  createdAt: Date;
};

export type ArticleDemo = {
  name: string;
  quantity?: string;
  category?: CategorieCourses;
  addedBy: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: Date;
  createdAt: Date;
};

export type MembreDemo = { userId: string; role: "admin" | "member"; joinedAt: Date };

export type DonneesDemo = {
  creeLe: Date;
  membres: MembreDemo[];
  depenses: DepenseDemo[];
  remboursements: RemboursementDemo[];
  taches: TacheDemo[];
  articles: ArticleDemo[];
};

const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * Jour `jour` du mois courant (decalage 0) ou du mois precedent (decalage -1),
 * a minuit UTC (les dates de depenses sont stockees ainsi, et le dashboard
 * borne les mois en UTC). Le jour est ramene au dernier jour du mois s'il
 * depasse, et, pour le mois courant, a aujourd'hui : une date de depense ne
 * doit jamais etre dans le futur. Le 1er du mois, toutes les depenses du mois
 * courant tombent donc le 1er : c'est voulu, elles restent dans le bon mois.
 */
function jourDuMois(maintenant: Date, decalage: 0 | -1, jour: number): Date {
  const annee = maintenant.getUTCFullYear();
  const mois = maintenant.getUTCMonth() + decalage;
  const dernierJour = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  let j = Math.min(jour, dernierJour);
  if (decalage === 0) j = Math.min(j, maintenant.getUTCDate());
  return new Date(Date.UTC(annee, mois, j));
}

/** Minuit UTC, `jours` jours avant (negatif) ou apres (positif) aujourd'hui. */
function minuitDecale(maintenant: Date, jours: number): Date {
  return new Date(
    Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate() + jours)
  );
}

/** Instant `jours` jours avant `maintenant` (toujours dans le passe). */
function ilYa(maintenant: Date, jours: number): Date {
  return new Date(maintenant.getTime() - jours * JOUR_MS);
}

/**
 * Fabrique une depense en reutilisant `resoudreRepartition` (la meme que les
 * routes) pour les payeurs ET les parts : la somme colle au centime pres, sans
 * recalcul a la main. Une donnee de demo incoherente est un bogue du code, pas
 * une entree utilisateur : on leve plutot que d'inserer des comptes faux.
 */
function depense(p: {
  description: string;
  category: DepenseDemo["category"];
  montant: number;
  date: Date;
  payeurs: RepartitionInput;
  participants: RepartitionInput;
}): DepenseDemo {
  const payeurs = resoudreRepartition(p.montant, p.payeurs, () => true);
  const parts = resoudreRepartition(p.montant, p.participants, () => true);
  if (!payeurs.ok || !parts.ok) {
    throw new Error("Données de démonstration incohérentes");
  }
  return {
    payers: payeurs.parts,
    createdBy: payeurs.parts[0].userId,
    amount: p.montant,
    description: p.description,
    category: p.category,
    date: p.date,
    splitType: p.participants.type === "equal" ? "equal" : "custom",
    splits: parts.parts,
    createdAt: p.date,
  };
}

/**
 * Colocation d'exemple : 4 membres (le compte demo, admin, et 3 fictifs), des
 * depenses sur le mois precedent et le mois courant, des taches, des articles
 * de courses et des remboursements. PURE et deterministe : tout est relatif a
 * `maintenant`, aucune date n'est ecrite en dur. Dates dans le passe, sauf les
 * echeances de taches. Les id sont rendus en chaines (Mongoose les convertit en
 * ObjectId a l'insertion).
 */
export function construireDonneesDemo(maintenant: Date, ids: IdsDemo): DonneesDemo {
  const demo = String(ids.demo);
  const lea = String(ids.lea);
  const hugo = String(ids.hugo);
  const camille = String(ids.camille);
  const tous = [demo, lea, hugo, camille];

  const seul = (userId: string): RepartitionInput => ({ type: "equal", memberIds: [userId] });
  const egal = (memberIds: string[] = tous): RepartitionInput => ({ type: "equal", memberIds });
  const precedent = (jour: number) => jourDuMois(maintenant, -1, jour);
  const courant = (jour: number) => jourDuMois(maintenant, 0, jour);

  const depensesPrecedentes: DepenseDemo[] = [
    depense({ description: "Loyer", category: "loyer", montant: 1480, date: precedent(1), payeurs: seul(lea), participants: egal() }),
    depense({ description: "Courses du supermarché", category: "courses", montant: 86.43, date: precedent(3), payeurs: seul(camille), participants: egal() }),
    depense({ description: "Facture d'électricité", category: "factures", montant: 94.7, date: precedent(5), payeurs: seul(hugo), participants: egal() }),
    depense({ description: "Internet (fibre)", category: "factures", montant: 29.99, date: precedent(8), payeurs: seul(demo), participants: egal() }),
    // Payeurs multiples : deux personnes avancent l'addition, pas a parts egales.
    depense({
      description: "Restaurant du samedi soir",
      category: "sorties",
      montant: 112,
      date: precedent(12),
      payeurs: { type: "amounts", splits: [{ userId: demo, amount: 40 }, { userId: lea, amount: 72 }] },
      participants: egal(),
    }),
    depense({ description: "Courses de la semaine", category: "courses", montant: 54.2, date: precedent(16), payeurs: seul(lea), participants: egal() }),
    // Lea n'etait pas la : seulement trois participants.
    depense({ description: "Bowling", category: "sorties", montant: 36, date: precedent(20), payeurs: seul(hugo), participants: egal([demo, hugo, camille]) }),
    // Repartition personnalisee en montants exacts.
    depense({
      description: "Courses du brunch",
      category: "courses",
      montant: 58.4,
      date: precedent(22),
      payeurs: seul(camille),
      participants: {
        type: "amounts",
        splits: [
          { userId: demo, amount: 18 },
          { userId: lea, amount: 18 },
          { userId: hugo, amount: 8.4 },
          { userId: camille, amount: 14 },
        ],
      },
    }),
    depense({ description: "Produits d'entretien", category: "autre", montant: 23.45, date: precedent(24), payeurs: seul(camille), participants: egal() }),
  ];

  const depensesCourantes: DepenseDemo[] = [
    depense({ description: "Loyer", category: "loyer", montant: 1480, date: courant(1), payeurs: seul(lea), participants: egal() }),
    depense({ description: "Courses du supermarché", category: "courses", montant: 72.18, date: courant(2), payeurs: seul(demo), participants: egal() }),
    // Repartition personnalisee en pourcentages : Hugo n'a presque rien mange.
    depense({
      description: "Courses du barbecue",
      category: "courses",
      montant: 64.5,
      date: courant(4),
      payeurs: seul(camille),
      participants: {
        type: "percentages",
        pourcentages: [
          { userId: demo, pourcentage: 30 },
          { userId: lea, pourcentage: 30 },
          { userId: hugo, pourcentage: 10 },
          { userId: camille, pourcentage: 30 },
        ],
      },
    }),
    depense({
      description: "Pizzas pour la soirée jeux",
      category: "sorties",
      montant: 58,
      date: courant(6),
      payeurs: { type: "amounts", splits: [{ userId: demo, amount: 30 }, { userId: hugo, amount: 28 }] },
      participants: egal(),
    }),
    depense({ description: "Internet (fibre)", category: "factures", montant: 29.99, date: courant(8), payeurs: seul(demo), participants: egal() }),
    depense({ description: "Courses de la semaine", category: "courses", montant: 63.95, date: courant(9), payeurs: seul(lea), participants: egal() }),
    // Le compte demo doit de l'argent a Hugo, qui a avance toute la somme.
    depense({ description: "Perceuse et chevilles", category: "autre", montant: 45.9, date: courant(11), payeurs: seul(hugo), participants: egal([demo, hugo]) }),
  ];

  // Remboursements : les deux premiers virements que proposerait la page « Qui
  // doit quoi » une fois le mois precedent termine. Calcules avec le meme
  // algorithme (remboursementsDepense additionne par personne puis simplifie),
  // donc toujours cohérents avec les depenses ci-dessus.
  const virements = remboursementsDepense(
    depensesPrecedentes.flatMap((d) => d.payers),
    depensesPrecedentes.flatMap((d) => d.splits)
  );
  const remboursements: RemboursementDemo[] = virements.slice(0, 2).map((v, i) => ({
    fromUserId: v.fromUserId,
    toUserId: v.toUserId,
    amount: v.amount,
    settledAt: precedent(27 + i),
  }));

  const taches: TacheDemo[] = [
    {
      title: "Sortir les poubelles",
      description: "Poubelles jaune et grise.",
      assignedTo: [hugo],
      status: "todo",
      recurrence: "weekly",
      createdBy: demo,
      rotation: true,
      dueDate: minuitDecale(maintenant, 1),
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 30),
    },
    {
      title: "Faire le ménage de la cuisine",
      description: "Plan de travail, plaques, four et frigo.",
      assignedTo: [camille],
      status: "todo",
      recurrence: "monthly",
      createdBy: lea,
      rotation: true,
      dueDate: minuitDecale(maintenant, 9),
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 25),
    },
    {
      title: "Nettoyer la salle de bain",
      assignedTo: [lea],
      status: "todo",
      recurrence: "none",
      createdBy: lea,
      rotation: false,
      dueDate: minuitDecale(maintenant, 5),
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 6),
    },
    {
      title: "Passer l'aspirateur dans le salon",
      assignedTo: [demo],
      status: "in_progress",
      recurrence: "none",
      createdBy: demo,
      rotation: false,
      dueDate: minuitDecale(maintenant, 2),
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 4),
    },
    // En retard : echeance passee, jamais terminee.
    {
      title: "Relever le compteur d'eau",
      description: "À transmettre au propriétaire.",
      assignedTo: [demo],
      status: "todo",
      recurrence: "none",
      createdBy: hugo,
      rotation: false,
      dueDate: minuitDecale(maintenant, -3),
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 12),
    },
    {
      title: "Changer l'ampoule du couloir",
      assignedTo: [hugo],
      status: "done",
      recurrence: "none",
      createdBy: camille,
      rotation: false,
      completedAt: ilYa(maintenant, 2),
      completedBy: hugo,
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 8),
    },
    {
      title: "Descendre le verre au point de collecte",
      assignedTo: [camille],
      status: "done",
      recurrence: "none",
      createdBy: demo,
      rotation: false,
      completedAt: ilYa(maintenant, 5),
      completedBy: camille,
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 9),
    },
    // Terminee depuis plus de 7 jours : n'apparait plus que dans l'historique.
    {
      title: "Acheter des produits d'entretien",
      assignedTo: [lea],
      status: "done",
      recurrence: "none",
      createdBy: lea,
      rotation: false,
      completedAt: ilYa(maintenant, 10),
      completedBy: lea,
      occurrenceGeneree: false,
      rappelEnvoye: false,
      createdAt: ilYa(maintenant, 14),
    },
  ];

  const articles: ArticleDemo[] = [
    { name: "Lait", quantity: "2 L", category: "frais", addedBy: lea, checked: false, createdAt: ilYa(maintenant, 1) },
    { name: "Pâtes", quantity: "1 kg", category: "epicerie", addedBy: hugo, checked: false, createdAt: ilYa(maintenant, 2) },
    { name: "Tomates", quantity: "1 kg", category: "fruits-legumes", addedBy: camille, checked: false, createdAt: ilYa(maintenant, 1) },
    { name: "Papier toilette", quantity: "1 pack", category: "hygiene", addedBy: demo, checked: false, createdAt: ilYa(maintenant, 3) },
    { name: "Liquide vaisselle", category: "entretien", addedBy: lea, checked: false, createdAt: ilYa(maintenant, 1) },
    { name: "Eau pétillante", quantity: "6 bouteilles", category: "boissons", addedBy: hugo, checked: false, createdAt: ilYa(maintenant, 2) },
    { name: "Œufs", quantity: "12", category: "frais", addedBy: demo, checked: true, checkedBy: lea, checkedAt: ilYa(maintenant, 2), createdAt: ilYa(maintenant, 4) },
    { name: "Café", quantity: "500 g", category: "epicerie", addedBy: camille, checked: true, checkedBy: demo, checkedAt: ilYa(maintenant, 3), createdAt: ilYa(maintenant, 5) },
    { name: "Pommes", quantity: "1 kg", category: "fruits-legumes", addedBy: lea, checked: true, checkedBy: camille, checkedAt: ilYa(maintenant, 1), createdAt: ilYa(maintenant, 3) },
    { name: "Dentifrice", category: "hygiene", addedBy: hugo, checked: true, checkedBy: hugo, checkedAt: ilYa(maintenant, 4), createdAt: ilYa(maintenant, 6) },
    // Coche depuis plus de 7 jours : seulement dans l'historique.
    { name: "Éponges", quantity: "x3", category: "entretien", addedBy: demo, checked: true, checkedBy: demo, checkedAt: ilYa(maintenant, 9), createdAt: ilYa(maintenant, 11) },
  ];

  // Tout le monde est la depuis le debut du mois precedent, OU depuis la plus
  // ancienne donnee si elle est encore plus vieille : les anciennetes des taches
  // et des articles sont des durees fixes (jusqu'a 30 jours), alors que le mois
  // precedent peut n'en avoir que 28. Aucune donnee ne doit preceder la creation
  // de la colocation.
  const toutesLesDates = [
    ...depensesPrecedentes.flatMap((d) => [d.date, d.createdAt]),
    ...depensesCourantes.flatMap((d) => [d.date, d.createdAt]),
    ...remboursements.map((r) => r.settledAt),
    ...taches.flatMap((t) => [t.createdAt, t.completedAt, t.dueDate]),
    ...articles.flatMap((x) => [x.createdAt, x.checkedAt]),
  ].filter((d): d is Date => d !== undefined);
  const debut = new Date(Math.min(precedent(1).getTime(), ...toutesLesDates.map((d) => d.getTime())));
  return {
    creeLe: debut,
    membres: [
      { userId: demo, role: "admin", joinedAt: debut },
      { userId: lea, role: "member", joinedAt: debut },
      { userId: hugo, role: "member", joinedAt: debut },
      { userId: camille, role: "member", joinedAt: debut },
    ],
    depenses: [...depensesPrecedentes, ...depensesCourantes],
    remboursements,
    taches,
    articles,
  };
}

// ---------------------------------------------------------------------------
// Reinitialisation (BASE)
// ---------------------------------------------------------------------------

/** Compteurs seulement : aucune donnee personnelle (ni nom, ni adresse). */
export type RapportDemo = {
  active: boolean;
  colocationsDetruites: number;
  depenses: number;
  taches: number;
  articles: number;
  remboursements: number;
};

function rapportVide(active: boolean): RapportDemo {
  return { active, colocationsDetruites: 0, depenses: 0, taches: 0, articles: 0, remboursements: 0 };
}

/**
 * Cree ou met a jour un compte demo, retrouve par son email. Le filtre
 * contient `demo: true` : si un VRAI compte (non demo) portait deja cette
 * adresse, l'upsert tenterait d'inserer un doublon, la base refuserait (index
 * unique) et la reinitialisation s'arreterait, plutot que d'ecraser le compte
 * de quelqu'un. `demo: true` est aussi dans le $set : Mongoose ajouterait
 * sinon le defaut `demo: false` en $setOnInsert, qui l'emporterait sur le
 * filtre a la creation.
 */
async function assurerCompteDemo(email: string, champs: Record<string, unknown>): Promise<string> {
  const compte = await UserModel.findOneAndUpdate(
    { email, demo: true },
    { $set: { ...champs, provider: "credentials", demo: true, notificationsEmail: false } },
    { upsert: true, new: true, projection: { _id: 1 } }
  );
  if (!compte) throw new Error("Compte de démonstration introuvable après upsert");
  return compte._id.toString();
}

/**
 * Remet la demo a zero. RELANCABLE a tout moment et idempotente : deux appels
 * de suite donnent le meme etat, et un plantage au milieu est repare par le
 * suivant (chaque etape part de l'etat trouve en base, pas d'un etat suppose).
 * Ne touche qu'aux comptes `demo: true` et aux colocations `demo: true` ou
 * dont le compte demo est membre. Ne fait rien si la demo est desactivee.
 *
 * Ordre, et ce qui reste si ca plante :
 *  1. Comptes (upsert). Plantage : rien d'autre n'a bouge.
 *  2. Destruction des colocations demo (une par une, la colocation en dernier
 *     dans `detruireColocation`). Plantage : une colocation demo partiellement
 *     videe existe encore, le prochain passage la detruit.
 *  3. Creation de la colocation, puis de ses donnees. Plantage : une colocation
 *     demo incomplete ou absente, le prochain passage la detruit (`demo: true`)
 *     et recree tout. Si une insertion echoue apres la creation, la colocation
 *     est detruite aussitot (au mieux) avant de relancer l'erreur.
 */
export async function reinitialiserDemo({
  env,
  maintenant,
}: {
  env: EnvDemo;
  maintenant: Date;
}): Promise<RapportDemo> {
  const motDePasse = motDePasseDemo(env);
  if (motDePasse === null) return rapportVide(false);

  const rapport = rapportVide(true);
  await connectDB();

  // (a) Comptes. Les colocataires fictifs recoivent le hash d'une valeur
  // aleatoire jetee aussitot : personne ne la connait, ils ne peuvent pas se
  // connecter.
  const [hashDemo, hashFictifs] = await Promise.all([
    bcrypt.hash(motDePasse, COUT_BCRYPT),
    bcrypt.hash(randomBytes(32).toString("hex"), COUT_BCRYPT),
  ]);
  const idDemo = await assurerCompteDemo(emailCompteDemo(env), {
    name: NOM_COMPTE_DEMO,
    passwordHash: hashDemo,
    passwordChangedAt: maintenant,
  });
  const idsFictifs: Record<string, string> = {};
  for (const c of COLOCATAIRES_DEMO) {
    idsFictifs[c.cle] = await assurerCompteDemo(c.email, { name: c.nom, passwordHash: hashFictifs });
  }

  // (b) Destruction : toute colocation dont le compte demo est membre, plus
  // toute colocation `demo: true` orpheline.
  const aDetruire = await HouseholdModel.find({
    $or: [{ "members.userId": idDemo }, { demo: true }],
  })
    .select("_id")
    .lean<{ _id: { toString(): string } }[]>();
  for (const colocation of aDetruire) {
    await detruireColocation(colocation._id.toString());
    rapport.colocationsDetruites++;
  }

  // (c) Recreation.
  const donnees = construireDonneesDemo(maintenant, {
    demo: idDemo,
    lea: idsFictifs.lea,
    hugo: idsFictifs.hugo,
    camille: idsFictifs.camille,
  });
  const colocation = await HouseholdModel.create({
    name: NOM_COLOCATION_DEMO,
    description: DESCRIPTION_COLOCATION_DEMO,
    createdBy: idDemo,
    members: donnees.membres,
    demo: true,
    createdAt: donnees.creeLe,
    // inviteCode : le defaut du schema en genere un neuf a chaque creation.
  });
  const householdId = colocation._id;
  const avecColocation = <T extends object>(lignes: T[]) =>
    lignes.map((l) => ({ ...l, householdId }));

  // allSettled et non all : on attend la FIN des quatre ecritures avant de
  // decider, sinon une insertion encore en vol pourrait recreer des lignes
  // apres la destruction ci-dessous.
  const [depenses, remboursements, taches, articles] = await Promise.allSettled([
    ExpenseModel.insertMany(avecColocation(donnees.depenses)),
    SettlementModel.insertMany(avecColocation(donnees.remboursements)),
    TaskModel.insertMany(avecColocation(donnees.taches)),
    ShoppingItemModel.insertMany(avecColocation(donnees.articles)),
  ]);
  const echec = [depenses, remboursements, taches, articles].find(
    (r) => r.status === "rejected"
  );
  if (echec) {
    // Jamais de demo a moitie remplie : on detruit ce qui vient d'etre cree
    // (au mieux : si cette destruction echoue aussi, le prochain passage
    // la detruira, elle est `demo: true`), puis on relance l'erreur d'origine.
    await detruireColocation(householdId.toString()).catch(() => undefined);
    throw (echec as PromiseRejectedResult).reason;
  }
  rapport.depenses = (depenses as PromiseFulfilledResult<unknown[]>).value.length;
  rapport.remboursements = (remboursements as PromiseFulfilledResult<unknown[]>).value.length;
  rapport.taches = (taches as PromiseFulfilledResult<unknown[]>).value.length;
  rapport.articles = (articles as PromiseFulfilledResult<unknown[]>).value.length;

  return rapport;
}

// ---------------------------------------------------------------------------
// Appel par le cron
// ---------------------------------------------------------------------------

export type ResultatDemoCron = RapportDemo & {
  /** Faux si la reinitialisation a plante. */
  ok: boolean;
};

/**
 * Appel de la reinitialisation depuis le cron : NE LEVE JAMAIS, pour qu'un
 * echec de la demo ne casse ni le nettoyage ni la reponse du cron. Demo
 * desactivee : ok (il n'y avait rien a faire). Dans les logs : le nom de
 * l'erreur seulement, jamais de message brut (il peut citer une adresse).
 */
export async function reinitialiserDemoPourCron({
  env,
  maintenant,
}: {
  env: EnvDemo;
  maintenant: Date;
}): Promise<ResultatDemoCron> {
  if (!demoActive(env)) return { ...rapportVide(false), ok: true };
  try {
    const rapport = await reinitialiserDemo({ env, maintenant });
    console.log(`[demo] ${JSON.stringify(rapport)}`);
    return { ...rapport, ok: true };
  } catch (e) {
    console.error(
      `[demo] échec de la réinitialisation : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    return { ...rapportVide(true), ok: false };
  }
}
