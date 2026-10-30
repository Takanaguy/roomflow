import HouseholdModel, {
  type Household,
  type HouseholdMember,
} from "@/models/Household";
import UserModel from "@/models/User";
import ExpenseModel from "@/models/Expense";
import SettlementModel from "@/models/Settlement";
import ShoppingItemModel from "@/models/ShoppingItem";
import TaskModel from "@/models/Task";
import { connectDB } from "@/lib/mongodb";
import { estObjectIdValide } from "@/lib/ids";
import type { HydratedDocument } from "mongoose";

/**
 * Charge une colocation et verifie que userId en fait partie. Regroupe les
 * deux car quasi toutes les routes colocation ont besoin des deux : eviter
 * qu'un membre d'une AUTRE colocation puisse lire/agir sur celle-ci juste en
 * devinant son id dans l'URL.
 */
export async function getHouseholdForMember(householdId: string, userId: string) {
  // Un id mal forme dans l'URL donnerait une CastError (500) : on repond
  // comme pour une colocation inconnue, donc 404 cote appelant.
  if (!estObjectIdValide(householdId)) return null;
  await connectDB();
  const household = await HouseholdModel.findById(householdId);
  if (!household) return null;

  const membership = household.members.find(
    (m: HouseholdMember) => m.userId.toString() === userId
  );
  if (!membership) return null;

  return { household, membership };
}

export function isAdminMember(membership: { role: string }) {
  return membership.role === "admin";
}

/**
 * Promeut automatiquement le membre present depuis le plus longtemps quand
 * l'admin quitte la colocation. Sans ca, une colocation dont l'admin part
 * se retrouverait sans personne pour la gerer (modifier, retirer un membre,
 * la detruire) - demande explicite de Tanguy le 09/09/2026, comme
 * alternative plus sure a "forcer l'admin a designer un successeur avant de
 * pouvoir partir" (qui bloquerait un depart si l'admin n'y a pas pense).
 *
 * Mute `members` en place (deja le pattern des autres routes colocation,
 * qui font `household.members = ...` puis `.save()`) ; ne fait rien si la
 * liste est vide (la colocation reste alors sans admin - resolu au prochain
 * `join`, voir join/route.ts).
 */
export function promouvoirDoyen(members: HouseholdMember[]): void {
  if (members.length === 0) return;

  const doyen = members.reduce((plusAncien, m) =>
    m.joinedAt < plusAncien.joinedAt ? m : plusAncien
  );
  doyen.role = "admin";
}

/**
 * Destruction definitive d'une colocation et de tout ce qui lui appartient.
 * Les droits (admin) sont verifies par l'appelant. Partagee par
 * DELETE /api/colocations/[id] et la suppression de compte (colocation dont
 * le compte supprime etait le dernier membre).
 *
 * Cascade sur Expense depuis le lot 4 (constate en testant : une colocation
 * detruite laissait ses depenses orphelines en base, sans plus aucune
 * colocation pour les referencer). Task (lot 6), Settlement (oubli du
 * lot 5) et ShoppingItem (lot 7) suivent la meme logique. La colocation est
 * supprimee EN DERNIER : si le processus s'arrete au milieu, elle existe
 * encore et un second appel termine le menage.
 */
export async function detruireColocation(householdId: string): Promise<void> {
  await connectDB();
  await ExpenseModel.deleteMany({ householdId });
  await SettlementModel.deleteMany({ householdId });
  await TaskModel.deleteMany({ householdId });
  await ShoppingItemModel.deleteMany({ householdId });
  await HouseholdModel.findByIdAndDelete(householdId);
}

export type ColocationMembreDetail = {
  userId: string;
  role: "admin" | "member";
  name: string;
  email?: string;
  image?: string;
};

export type ColocationDetail = {
  id: string;
  name: string;
  description?: string;
  // Chaine VIDE pour la colocation de demonstration : son code ne doit jamais
  // sortir (un vrai utilisateur pourrait la rejoindre puis perdre ses donnees a
  // la remise a zero). L'interface masque alors le bloc (`demo`).
  inviteCode: string;
  demo: boolean;
  monRole: "admin" | "member";
  members: ColocationMembreDetail[];
};

/**
 * Met en forme une colocation + ses membres pour l'API et la page detail
 * (Server Component) : les deux affichaient la meme chose en double avant
 * cette extraction. `monRole` vient de `viewerId`, pas d'un champ stocke.
 */
export async function serializeHousehold(
  household: HydratedDocument<Household>,
  viewerId: string
): Promise<ColocationDetail> {
  await connectDB();

  const memberIds = household.members.map((m: HouseholdMember) => m.userId);
  const users = await UserModel.find({ _id: { $in: memberIds } }, "name email image");
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));

  const moi = household.members.find(
    (m: HouseholdMember) => m.userId.toString() === viewerId
  );

  return {
    id: household._id.toString(),
    name: household.name,
    description: household.description ?? undefined,
    inviteCode: household.demo === true ? "" : household.inviteCode,
    demo: household.demo === true,
    monRole: (moi?.role as "admin" | "member") ?? "member",
    members: household.members.map((m: HouseholdMember) => {
      const u = usersById.get(m.userId.toString());
      return {
        userId: m.userId.toString(),
        role: m.role as "admin" | "member",
        name: u?.name ?? "Utilisateur supprimé",
        email: u?.email,
        image: u?.image,
      };
    }),
  };
}
