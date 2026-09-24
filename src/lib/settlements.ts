import ExpenseModel from "@/models/Expense";
import SettlementModel from "@/models/Settlement";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";

export type DetteSimplifiee = {
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  amount: number;
};

type DetteCentimes = { fromUserId: string; toUserId: string; centimes: number };

/**
 * Solde net de chaque membre en centimes : ce qu'il a paye moins ce qu'il
 * doit sur toutes les depenses, ajuste des remboursements deja confirmes.
 * Positif = on lui doit de l'argent, negatif = il doit de l'argent. En
 * centimes (pas en euros) pour les memes raisons qu'ailleurs dans le projet
 * (repartirEgalement etc.) : eviter que l'algorithme de simplification
 * derive avec les flottants au fil de dizaines de depenses.
 */
async function calculerSoldesNets(householdId: string): Promise<Map<string, number>> {
  await connectDB();
  const [expenses, settlements] = await Promise.all([
    ExpenseModel.find({ householdId }),
    SettlementModel.find({ householdId }),
  ]);

  const soldes = new Map<string, number>();
  const ajouter = (userId: string, centimes: number) =>
    soldes.set(userId, (soldes.get(userId) ?? 0) + centimes);

  for (const e of expenses) {
    for (const p of e.payers) ajouter(p.userId.toString(), Math.round(p.amount * 100));
    for (const s of e.splits) ajouter(s.userId.toString(), -Math.round(s.amount * 100));
  }
  // Un remboursement confirme reduit la dette du payeur (fromUserId) et la
  // creance du beneficiaire (toUserId) d'autant.
  for (const s of settlements) {
    ajouter(s.fromUserId.toString(), Math.round(s.amount * 100));
    ajouter(s.toUserId.toString(), -Math.round(s.amount * 100));
  }
  return soldes;
}

/**
 * Reduit les dettes croisees au nombre minimal de transactions (section 4.4,
 * "algorithme de simplification / minimum cash flow") : a chaque tour, le
 * plus gros crediteur eponge le plus gros debiteur, jusqu'a ce que tout le
 * monde soit a zero. Une colocation compte quelques membres tout au plus,
 * une methode gloutonne O(n^2) est largement suffisante - pas besoin d'un
 * tas binaire pour ce volume.
 */
function simplifier(soldesCentimes: Map<string, number>): DetteCentimes[] {
  const soldes = [...soldesCentimes.entries()]
    .filter(([, c]) => Math.abs(c) >= 1) // ignore les ecarts sous le centime
    .map(([userId, centimes]) => ({ userId, centimes }));

  const resultat: DetteCentimes[] = [];

  for (;;) {
    const crediteur = soldes.reduce(
      (max, s) => (s.centimes > max.centimes ? s : max),
      soldes[0]
    );
    const debiteur = soldes.reduce(
      (min, s) => (s.centimes < min.centimes ? s : min),
      soldes[0]
    );
    if (!crediteur || !debiteur || crediteur.centimes <= 0 || debiteur.centimes >= 0) break;

    const montant = Math.min(crediteur.centimes, -debiteur.centimes);
    crediteur.centimes -= montant;
    debiteur.centimes += montant;
    resultat.push({ fromUserId: debiteur.userId, toUserId: crediteur.userId, centimes: montant });
  }
  return resultat;
}

/** Vue "qui doit quoi" prete a afficher, avec les noms resolus. */
export async function calculerDettesSimplifiees(householdId: string): Promise<DetteSimplifiee[]> {
  const soldes = await calculerSoldesNets(householdId);
  const dettes = simplifier(soldes);
  if (dettes.length === 0) return [];

  await connectDB();
  const ids = new Set<string>();
  for (const d of dettes) {
    ids.add(d.fromUserId);
    ids.add(d.toUserId);
  }
  const users = await UserModel.find({ _id: { $in: [...ids] } }, "name");
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));
  const nom = (id: string) => usersById.get(id)?.name ?? "Utilisateur supprimé";

  return dettes.map((d) => ({
    fromUserId: d.fromUserId,
    toUserId: d.toUserId,
    fromName: nom(d.fromUserId),
    toName: nom(d.toUserId),
    amount: d.centimes / 100,
  }));
}

/**
 * Utilisee par la route "quitter la colocation" (avertissement avant depart,
 * section 4.2). Remplace le stub qui renvoyait toujours false avant que les
 * depenses (lot 4) puis les dettes (lot 5) n'existent.
 */
export async function aUneDetteEnCours(householdId: string, userId: string): Promise<boolean> {
  const soldes = await calculerSoldesNets(householdId);
  return Math.abs(soldes.get(userId) ?? 0) >= 1;
}

/**
 * Confirme un remboursement : uniquement le CREDITEUR (celui a qui l'argent
 * est du, ici toUserId) peut confirmer l'avoir recu - jamais le debiteur
 * lui-meme, pour eviter qu'il se declare a jour sans avoir reellement paye
 * (confirme par Tanguy le 24/09/2026). Le montant n'est jamais fourni par le
 * client : on recalcule la dette simplifiee au moment de l'appel et on
 * regle exactement ce montant-la (tout-ou-rien, pas de remboursement
 * partiel en v1) - ca empeche aussi de regler un montant invente ou une
 * dette qui n'existe pas/plus (deja soldee, ou jamais calculee ainsi).
 */
export async function confirmerReglement(
  householdId: string,
  fromUserId: string,
  toUserId: string
): Promise<{ ok: true; amount: number } | { ok: false; erreur: string }> {
  const soldes = await calculerSoldesNets(householdId);
  const dettes = simplifier(soldes);
  const dette = dettes.find((d) => d.fromUserId === fromUserId && d.toUserId === toUserId);
  if (!dette) {
    return { ok: false, erreur: "Cette dette n'existe pas ou plus" };
  }

  await connectDB();
  await SettlementModel.create({
    householdId,
    fromUserId,
    toUserId,
    amount: dette.centimes / 100,
  });
  return { ok: true, amount: dette.centimes / 100 };
}
