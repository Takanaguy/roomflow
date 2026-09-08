import { auth } from "@/auth";

/**
 * Renomme "middleware" -> "proxy" en Next.js 16 (le nom de fichier ET le nom
 * de la fonction/export par defaut ont change, next-auth beta.32 ne le
 * documente pas encore). L'export par defaut d'`auth` a exactement la
 * signature qu'attend Proxy : (request) => Response | void.
 *
 * La decision d'autoriser ou non passe par callbacks.authorized dans
 * src/auth.ts, pas ici.
 */
export default auth;

export const config = {
  // A completer au fil des lots : toute nouvelle zone reservee aux
  // utilisateurs connectes (colocations, depenses...) doit rejoindre cette
  // liste, sinon elle reste accessible sans etre connecte.
  matcher: ["/tableau-de-bord/:path*", "/profil/:path*"],
};
