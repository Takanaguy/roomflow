/**
 * Adresses du compte de demonstration. Fichier volontairement PUR et sans
 * aucun import (ni modele, ni mongoose, ni bcrypt) : `email.ts` et la route
 * d'inscription l'utilisent, et ils doivent rester legers.
 *
 * Le TLD `.invalid` est reserve par la RFC 2606 : une adresse en `.invalid`
 * n'est jamais livrable, donc meme si le garde-fou d'envoi sautait un jour,
 * aucun mail ne pourrait atteindre qui que ce soit.
 */

export const DEMO_EMAIL_PAR_DEFAUT = "demo@roomflow.invalid";

// Signature d'index : sans elle, TypeScript refuse de passer `process.env` (un
// objet sans propriete declaree) a un type qui n'a que des champs optionnels.
type EnvDemoEmail = { DEMO_EMAIL?: string; [cle: string]: string | undefined };

/** Domaine des colocataires FICTIFS de la colocation d'exemple. */
export const DOMAINE_COLOCATAIRES_DEMO = "demo.roomflow.invalid";

/**
 * Minuscules ASCII SEULEMENT, pas `toLowerCase()` : celui-ci est Unicode
 * complet et ramene par exemple le signe Kelvin (U+212A) sur un "k" ASCII
 * (meme raison que dans admin.ts). Ici le piege est dans l'autre sens : une
 * adresse qui ressemble a celle de la demo sans l'etre ne doit pas etre prise
 * pour elle.
 */
function normaliser(email: string): string {
  return email.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Email du compte demo : DEMO_EMAIL si elle a la forme d'une adresse, sinon la
 * valeur par defaut. Une valeur illisible ne doit pas desactiver les
 * protections (inscription, envoi de mails) : on retombe sur le defaut.
 */
export function emailCompteDemo(env: EnvDemoEmail): string {
  const brut = typeof env.DEMO_EMAIL === "string" ? normaliser(env.DEMO_EMAIL) : "";
  return /^[^\s@]+@[^\s@]+$/.test(brut) ? brut : DEMO_EMAIL_PAR_DEFAUT;
}

// Une SEULE adresse nue : pas d'espace, de virgule, de point-virgule, de chevrons
// ni de caractere de controle, et un seul `@`.
const ADRESSE_SIMPLE = /^[^\s@,;<>\u0000-\u001f\u007f-\u009f]+@[^\s@,;<>\u0000-\u001f\u007f-\u009f]+$/;

/**
 * Vrai si `to` est une adresse unique et nue (apres suppression des espaces en
 * bordure). `envoyerEmail` refuse tout le reste : l'application n'envoie jamais
 * qu'a UNE adresse lue en base, donc une liste (« a@x,b@y »), un nom affiche
 * (« Lea <lea@x> ») ou une adresse avec caractere de controle ne peut venir que
 * d'une donnee anormale, et le garde-fou « adresse demo » ne sait pas la lire.
 */
export function estAdresseSimple(to: unknown): boolean {
  return typeof to === "string" && ADRESSE_SIMPLE.test(to.trim());
}

/**
 * Vrai si l'adresse est celle du compte demo ou d'un colocataire fictif. Pure.
 * `emailDemo` est l'adresse du compte demo (voir `emailCompteDemo`). Une chaine
 * qui n'est pas UNE adresse nue (liste, nom affiche, caractere de controle au
 * milieu) n'est pas une adresse demo : elle est refusee en amont par
 * `estAdresseSimple` dans `envoyerEmail`. Les espaces et retours a la ligne en
 * bordure sont ignores (sur-blocage voulu : cette fonction sert a bloquer).
 */
export function estEmailDemo(
  email: unknown,
  emailDemo: string = DEMO_EMAIL_PAR_DEFAUT
): boolean {
  if (typeof email !== "string") return false;
  const adresse = normaliser(email);
  if (!ADRESSE_SIMPLE.test(adresse)) return false;
  return adresse.endsWith(`@${DOMAINE_COLOCATAIRES_DEMO}`) || adresse === normaliser(emailDemo);
}
