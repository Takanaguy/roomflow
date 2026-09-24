import HouseholdModel, {
  type Household,
  type HouseholdMember,
} from "@/models/Household";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import type { HydratedDocument } from "mongoose";

/**
 * Charge une colocation et verifie que userId en fait partie. Regroupe les
 * deux car quasi toutes les routes colocation ont besoin des deux : eviter
 * qu'un membre d'une AUTRE colocation puisse lire/agir sur celle-ci juste en
 * devinant son id dans l'URL.
 */
export async function getHouseholdForMember(householdId: string, userId: string) {
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
  inviteCode: string;
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
    inviteCode: household.inviteCode,
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
