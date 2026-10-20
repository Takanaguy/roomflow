/**
 * Un id vient de l'URL ou du corps d'une requete, donc d'un client qu'on ne
 * controle pas. Mongoose lance une CastError (donc un 500) sur un id mal
 * forme : on teste d'abord avec ceci pour repondre 404/400 proprement. On ne
 * se sert PAS de Types.ObjectId.isValid, qui accepte aussi n'importe quelle
 * chaine de 12 caracteres. Dans son propre fichier (sans import) pour que
 * households.ts et tasks.ts puissent l'utiliser sans dependance croisee.
 */
export function estObjectIdValide(valeur: string): boolean {
  return /^[a-f\d]{24}$/i.test(valeur);
}
