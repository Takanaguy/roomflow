import type { DefaultSession } from "next-auth";

/**
 * Par defaut, session.user ne porte que name/email/image. On y ajoute id
 * (notre _id Mongo) pour pouvoir filtrer les requetes (mes depenses, mes
 * colocations) sans redemander l'email a chaque fois.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
