import { z } from "zod";

/**
 * Regles de mot de passe et cout de hachage partages entre l'inscription et
 * la reinitialisation. Un seul endroit : si les deux routes avaient chacune
 * leur copie, un mot de passe refuse a l'inscription pourrait etre accepte
 * par la reinitialisation (ou l'inverse) le jour ou l'une des deux change.
 */
export const motDePasseSchema = z.string().min(8, "8 caractères minimum");

export const COUT_BCRYPT = 12;
