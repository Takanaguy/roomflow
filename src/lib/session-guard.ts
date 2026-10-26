/**
 * Decisions de revocation des sessions JWT (callback jwt de src/auth.ts).
 * Fichier PUR, sans import : tout ce qui decide si une session reste valide
 * se teste sans base ni Auth.js.
 */

export const INTERVALLE_REVERIFICATION_PAR_DEFAUT = 300;

/**
 * SESSION_RECHECK_SECONDS ne sert qu'a tester avec un delai court. Seul un
 * entier strictement positif ecrit en chiffres est accepte ("60", " 60 ") ;
 * tout le reste ("0", "-5", "1.5", "abc", vide) retombe sur 5 minutes plutot
 * que de desactiver la verification par erreur.
 */
export function lireIntervalleReverification(valeurEnv: string | undefined): number {
  if (typeof valeurEnv !== "string") return INTERVALLE_REVERIFICATION_PAR_DEFAUT;
  const texte = valeurEnv.trim();
  if (!/^\d+$/.test(texte)) return INTERVALLE_REVERIFICATION_PAR_DEFAUT;
  const valeur = Number(texte);
  if (!Number.isSafeInteger(valeur) || valeur <= 0) return INTERVALLE_REVERIFICATION_PAR_DEFAUT;
  return valeur;
}

/**
 * Vrai s'il faut relire le compte en base. Aucune verification connue, ou
 * date illisible : on reverifie. Une derniere verification dans le FUTUR
 * (horloges legerement decalees entre deux serveurs) aussi : sinon un ecart
 * d'horloge suffirait a suspendre la verification pendant toute sa duree.
 */
export function doitReverifier(
  verifieLe: number | undefined,
  maintenant: number,
  intervalleSecondes: number
): boolean {
  if (typeof verifieLe !== "number" || !Number.isFinite(verifieLe)) return true;
  const ecouleMs = maintenant - verifieLe;
  if (ecouleMs < 0) return true;
  return ecouleMs >= intervalleSecondes * 1000;
}

/**
 * Une session est revoquee si le compte n'existe plus, ou si le mot de passe
 * a change APRES l'ouverture de la session (strictement apres : une
 * connexion dans la meme milliseconde que le changement reste valide).
 *
 * connecteLe absent = jeton ouvert avant l'existence de ce claim. Comme
 * passwordChangedAt n'est pose que par le code qui a introduit connecteLe, un
 * tel jeton est forcement anterieur a tout changement de mot de passe : s'il
 * y en a eu un, la session est revoquee ; sinon elle reste valide.
 *
 * Une date de changement illisible (NaN) est ignoree plutot que de revoquer :
 * elle revoquerait aussi chaque nouvelle connexion, donc bloquerait le compte
 * pour toujours. Elle ne peut pas venir de notre code, qui ecrit new Date().
 */
export function sessionRevoquee(p: {
  connecteLe: number | undefined;
  passwordChangedAt: Date | null | undefined;
  utilisateurExiste: boolean;
}): boolean {
  if (!p.utilisateurExiste) return true;
  if (!p.passwordChangedAt) return false;
  const changeLe = p.passwordChangedAt.getTime();
  if (Number.isNaN(changeLe)) return false;
  if (typeof p.connecteLe !== "number" || !Number.isFinite(p.connecteLe)) return true;
  return changeLe > p.connecteLe;
}
