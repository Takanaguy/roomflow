import ExpenseModel, { type Expense } from "@/models/Expense";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import type { HydratedDocument } from "mongoose";

export type Split = { userId: string; amount: number };

/**
 * Repartit un montant (en euros) entre plusieurs personnes sans les erreurs
 * d'arrondi classiques du flottant JS (10 / 3 ne tombe jamais juste ; encore
 * pire, 0.1 + 0.2 !== 0.3). Travaille en centimes (entiers) en interne, et
 * distribue le reste de la division euclidienne aux premiers de la liste,
 * pour que la somme colle TOUJOURS exactement au montant de depart - sinon
 * le calcul de solde du lot 5 accumulerait des ecarts d'un centime a chaque
 * depense.
 */
export function repartirEgalement(
  montantEuros: number,
  memberIds: string[]
): Split[] {
  const centimes = Math.round(montantEuros * 100);
  const base = Math.floor(centimes / memberIds.length);
  const reste = centimes - base * memberIds.length;

  return memberIds.map((userId, i) => ({
    userId,
    // Les `reste` premiers de la liste absorbent le centime en trop plutot
    // que de le laisser disparaitre dans l'arrondi.
    amount: (base + (i < reste ? 1 : 0)) / 100,
  }));
}

/**
 * Meme probleme, pour une repartition par pourcentages (4.3 : "montants ou
 * pourcentages differents par personne"). Le dernier de la liste absorbe
 * l'ecart d'arrondi final, methode standard pour ce genre de repartition
 * proportionnelle.
 */
export function repartirParPourcentages(
  montantEuros: number,
  parts: { userId: string; pourcentage: number }[]
): Split[] {
  const totalPourcentage = parts.reduce((s, p) => s + p.pourcentage, 0);
  const centimes = Math.round(montantEuros * 100);

  let attribues = 0;
  return parts.map((p, i) => {
    if (i === parts.length - 1) {
      return { userId: p.userId, amount: (centimes - attribues) / 100 };
    }
    const c = Math.round((centimes * p.pourcentage) / totalPourcentage);
    attribues += c;
    return { userId: p.userId, amount: c / 100 };
  });
}

/**
 * Somme des parts en passant par les centimes (memes raisons que
 * repartirEgalement) : utilise pour verifier qu'une repartition
 * personnalisee saisie a la main tombe bien sur le montant total avant
 * d'accepter la depense.
 */
export function sommeSplits(splits: { amount: number }[]): number {
  const centimes = splits.reduce((s, x) => s + Math.round(x.amount * 100), 0);
  return centimes / 100;
}

export type RepartitionInput =
  | { type: "equal"; memberIds: string[] }
  | { type: "amounts"; splits: Split[] }
  | { type: "percentages"; pourcentages: { userId: string; pourcentage: number }[] };

export type ResultatRepartition =
  | { ok: true; parts: Split[] }
  | { ok: false; erreur: string };

/**
 * Valide + calcule une repartition, dans un sens comme dans l'autre : qui
 * DOIT quoi (splits) et qui a PAYE quoi (payers) sont structurellement le
 * meme probleme - distribuer un montant entre des personnes en garantissant
 * la somme exacte. Centralise ici pour ne pas dupliquer 4 fois la meme
 * logique (POST/PATCH x payers/splits). Demande de Tanguy le 23/09/2026,
 * qui a fait remarquer qu'un resto peut etre avance par plusieurs personnes
 * a la fois, pas toujours une seule.
 */
export function resoudreRepartition(
  montantEuros: number,
  input: RepartitionInput,
  estMembre: (userId: string) => boolean
): ResultatRepartition {
  if (input.type === "equal") {
    if (input.memberIds.length === 0) {
      return { ok: false, erreur: "Sélectionne au moins un participant" };
    }
    if (!input.memberIds.every(estMembre)) {
      return { ok: false, erreur: "Un participant sélectionné ne fait pas partie de la colocation" };
    }
    return { ok: true, parts: repartirEgalement(montantEuros, input.memberIds) };
  }

  if (input.type === "percentages") {
    if (input.pourcentages.length === 0) {
      return { ok: false, erreur: "Répartition personnalisée manquante" };
    }
    if (!input.pourcentages.every((p) => estMembre(p.userId))) {
      return { ok: false, erreur: "Un participant sélectionné ne fait pas partie de la colocation" };
    }
    const total = input.pourcentages.reduce((s, p) => s + p.pourcentage, 0);
    if (Math.abs(total - 100) > 0.01) {
      return { ok: false, erreur: `Les pourcentages doivent totaliser 100 (actuellement ${total})` };
    }
    return { ok: true, parts: repartirParPourcentages(montantEuros, input.pourcentages) };
  }

  if (input.splits.length === 0) {
    return { ok: false, erreur: "Répartition personnalisée manquante" };
  }
  if (!input.splits.every((s) => estMembre(s.userId))) {
    return { ok: false, erreur: "Un participant sélectionné ne fait pas partie de la colocation" };
  }
  const somme = sommeSplits(input.splits);
  if (Math.abs(somme - montantEuros) > 0.005) {
    return {
      ok: false,
      erreur: `La somme des parts (${somme.toFixed(2)} €) ne correspond pas au montant (${montantEuros.toFixed(2)} €)`,
    };
  }
  return { ok: true, parts: input.splits };
}

export type RepartitionBody = {
  memberIds?: string[];
  splits?: Split[];
  pourcentages?: { userId: string; pourcentage: number }[];
};

/**
 * Traduit le corps de requete (POST/PATCH) en RepartitionInput. Utilisee
 * deux fois par requete - une pour les payeurs, une pour les participants -
 * avec les memes trois champs optionnels sous des noms differents (prefixes
 * "payer" cote client pour les payeurs). L'ordre de priorite (pourcentages
 * > montants > liste simple) est arbitraire mais doit rester le meme des
 * deux cotes.
 */
export function construireRepartitionInput(
  body: RepartitionBody
): RepartitionInput | null {
  if (body.pourcentages && body.pourcentages.length > 0) {
    return { type: "percentages", pourcentages: body.pourcentages };
  }
  if (body.splits && body.splits.length > 0) {
    return { type: "amounts", splits: body.splits };
  }
  if (body.memberIds && body.memberIds.length > 0) {
    return { type: "equal", memberIds: body.memberIds };
  }
  return null;
}

/**
 * Charge une depense ET verifie qu'elle appartient bien a householdId -
 * meme logique que getHouseholdForMember : sans ca, quelqu'un pourrait
 * agir sur la depense d'une AUTRE colocation en devinant son id dans
 * l'URL, tant que le householdId de l'URL, lui, correspond a une
 * colocation dont il est membre.
 */
export async function getExpenseInHousehold(householdId: string, expenseId: string) {
  await connectDB();
  const expense = await ExpenseModel.findOne({ _id: expenseId, householdId });
  return expense;
}

export type DepenseDetail = {
  id: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  splitType: "equal" | "custom";
  payeurs: (Split & { name: string })[];
  creePar: { userId: string; name: string };
  splits: (Split & { name: string })[];
  peuxModifier: boolean;
};

/**
 * Met en forme une liste de depenses pour l'API/les pages : recupere les
 * noms des payeurs/auteurs/participants en UNE seule requete groupee sur
 * tous les ids rencontres (pas une requete par depense, qui ferait un N+1
 * des que la liste s'allonge).
 */
export async function serializeExpenses(
  expenses: HydratedDocument<Expense>[],
  viewerId: string,
  viewerEstAdmin: boolean
): Promise<DepenseDetail[]> {
  await connectDB();

  const idsUtilisateurs = new Set<string>();
  for (const e of expenses) {
    for (const p of e.payers) idsUtilisateurs.add(p.userId.toString());
    idsUtilisateurs.add(e.createdBy.toString());
    for (const s of e.splits) idsUtilisateurs.add(s.userId.toString());
  }

  const users = await UserModel.find({ _id: { $in: [...idsUtilisateurs] } }, "name");
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));
  const nom = (id: string) => usersById.get(id)?.name ?? "Utilisateur supprimé";

  return expenses.map((e) => ({
    id: e._id.toString(),
    amount: e.amount,
    description: e.description,
    category: e.category,
    date: e.date.toISOString(),
    splitType: e.splitType as "equal" | "custom",
    payeurs: e.payers.map((p) => ({
      userId: p.userId.toString(),
      amount: p.amount,
      name: nom(p.userId.toString()),
    })),
    creePar: { userId: e.createdBy.toString(), name: nom(e.createdBy.toString()) },
    splits: e.splits.map((s) => ({
      userId: s.userId.toString(),
      amount: s.amount,
      name: nom(s.userId.toString()),
    })),
    peuxModifier: e.createdBy.toString() === viewerId || viewerEstAdmin,
  }));
}
