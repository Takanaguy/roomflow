import type { DefaultSession } from "next-auth";

/**
 * Par defaut, session.user ne porte que name/email/image. On y ajoute id
 * (notre _id Mongo) pour pouvoir filtrer les requetes (mes depenses, mes
 * colocations) sans redemander l'email a chaque fois.
 *
 * connecteLe (ms) : date de la connexion, pour exiger une connexion recente
 * avant une action sensible. Optionnel : absent pour un jeton ouvert avant
 * l'ajout de ce champ et pas encore reverifie (voir callbacks.jwt).
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    connecteLe?: number;
  }
}

/**
 * Claims propres ajoutes au JWT par callbacks.jwt (src/auth.ts). Optionnels :
 * un jeton emis avant leur ajout ne les porte pas. On augmente @auth/core/jwt
 * et non next-auth/jwt : ce dernier ne fait que reexporter l'interface
 * (`export * from "@auth/core/jwt"`), et tsc ignorait l'augmentation.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    connecteLe?: number;
    verifieLe?: number;
  }
}
