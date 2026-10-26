import { z } from "zod";

/**
 * Regles de mot de passe et cout de hachage partages entre l'inscription et
 * la reinitialisation. Un seul endroit : si les deux routes avaient chacune
 * leur copie, un mot de passe refuse a l'inscription pourrait etre accepte
 * par la reinitialisation (ou l'inverse) le jour ou l'une des deux change.
 */
export const motDePasseSchema = z.string().min(8, "8 caractères minimum");

export const COUT_BCRYPT = 12;

/**
 * Hash bcrypt (cout 12, comme COUT_BCRYPT) d'une chaine aleatoire jetee
 * aussitot : personne ne connait le mot de passe qui correspond. Ce n'est pas
 * un secret. Sert a la connexion quand l'email est inconnu : on compare quand
 * meme le mot de passe a ce hash, pour que la reponse prenne le meme temps
 * qu'avec un email connu et un mauvais mot de passe (sinon le temps de
 * reponse revelerait quels comptes existent). A REGENERER si COUT_BCRYPT
 * change, sinon le temps ne serait plus le meme.
 */
export const HASH_BCRYPT_BIDON = "$2b$12$I/ZD5KEY3tPfZnGTKZsAM.FuJc7Gz9/nK/kEE/Fjy/LzbEEMl7q.S";
