import { connectDB } from "@/lib/mongodb";
import LoginAttemptModel from "@/models/LoginAttempt";

export const MAX_TENTATIVES_EMAIL = 5;
export const MAX_TENTATIVES_IP = 20;
export const FENETRE_MINUTES = 15;

const FENETRE_MS = FENETRE_MINUTES * 60_000;

// Une IPv6 ecrite en texte fait au plus 45 caracteres (forme IPv4 mappee,
// "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255"). Au-dela, ce n'est pas
// une adresse : on ne s'en sert pas comme cle.
const LONGUEUR_MAX_IP = 45;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/**
 * Meme normalisation que authorize() (minuscules, trim) : sinon "A@x.fr" et
 * "a@x.fr" auraient chacun leur compteur, et on doublerait la limite rien
 * qu'en changeant la casse.
 */
export function cleEmail(email: string): string {
  return "email:" + email.toLowerCase().trim();
}

/**
 * Longueur maximale d'une adresse email utilisable (RFC 5321 : 254
 * caracteres). La cle du compteur contient l'email entier : sans plafond, un
 * anonyme pourrait remplir la base gratuite avec des cles enormes.
 */
export const LONGUEUR_MAX_EMAIL = 254;

/**
 * Forme MINIMALE d'une adresse, verifiee avant de creer un compteur pour
 * elle : au plus 254 caracteres, aucun espace, un seul "@", partie locale et
 * domaine non vides. Volontairement large (pas de validation complete) : un
 * email reel ne doit jamais etre refuse ici. Attend une valeur deja normalisee
 * (trim, minuscules) comme dans authorize().
 */
export function emailUtilisableCommeCle(email: string): boolean {
  if (typeof email !== "string" || email.length > LONGUEUR_MAX_EMAIL) return false;
  return /^[^\s@]+@[^\s@]+$/.test(email);
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const GROUPE_IPV6 = /^[0-9a-f]{1,4}$/;

/**
 * Les 8 groupes de 16 bits d'une IPv6 (deja en minuscules), "::" developpe et
 * IPv4 finale eventuelle ("::ffff:1.2.3.4") convertie en deux groupes. null si
 * ce n'est pas une IPv6 valide.
 */
function groupesIpv6(ip: string): number[] | null {
  let texte = ip;
  if (texte.includes(".")) {
    const deuxPoints = texte.lastIndexOf(":");
    if (deuxPoints === -1) return null;
    const v4 = texte.slice(deuxPoints + 1);
    if (!IPV4.test(v4)) return null;
    const o = v4.split(".").map(Number);
    texte =
      texte.slice(0, deuxPoints + 1) +
      ((o[0] << 8) | o[1]).toString(16) +
      ":" +
      ((o[2] << 8) | o[3]).toString(16);
  }

  const moities = texte.split("::");
  if (moities.length > 2) return null;
  const lire = (s: string) => (s === "" ? [] : s.split(":"));
  const avant = lire(moities[0]);
  const apres = moities.length === 2 ? lire(moities[1]) : [];
  const explicites = [...avant, ...apres];
  if (!explicites.every((g) => GROUPE_IPV6.test(g))) return null;

  if (moities.length === 1) {
    if (avant.length !== 8) return null;
  } else if (explicites.length > 7) {
    return null; // "::" remplace au moins un groupe
  }
  const zeros = moities.length === 2 ? 8 - explicites.length : 0;
  return [...avant, ...Array<string>(zeros).fill("0"), ...apres].map((g) => parseInt(g, 16));
}

/**
 * Ecriture unique d'une IP pour le compteur :
 *  - minuscules ;
 *  - IPv4 : telle quelle ;
 *  - IPv4 mappee en IPv6 ("::ffff:1.2.3.4", ou sa forme hexadecimale
 *    "::ffff:102:304") : ramenee a l'IPv4 "1.2.3.4", sinon une meme machine
 *    aurait deux compteurs selon l'ecriture ;
 *  - autre IPv6 : son PREFIXE /64, ecrit en forme canonique choisie ici :
 *    les 4 premiers groupes en hexadecimal minuscule sans zeros de tete,
 *    separes par ":", suivis de "::/64" (ex. "2001:db8::1" ->
 *    "2001:db8:0:0::/64", "2A01:E0A:100B:B220:1:2:3:4" ->
 *    "2a01:e0a:100b:b220::/64"). Un abonne recoit en general un bloc /64
 *    entier : compter par adresse lui donnerait des milliards de compteurs
 *    neufs ;
 *  - toute autre valeur : renvoyee en minuscules, sans exception.
 */
export function normaliserIp(ip: string): string {
  const texte = String(ip).toLowerCase();
  if (IPV4.test(texte)) return texte;
  if (!texte.includes(":")) return texte;

  const groupes = groupesIpv6(texte);
  if (!groupes) return texte;

  const mappee = groupes.slice(0, 5).every((g) => g === 0) && groupes[5] === 0xffff;
  if (mappee) {
    return [groupes[6] >> 8, groupes[6] & 0xff, groupes[7] >> 8, groupes[7] & 0xff].join(".");
  }
  return (
    groupes
      .slice(0, 4)
      .map((g) => g.toString(16))
      .join(":") + "::/64"
  );
}

/**
 * Prefixe different de cleEmail : les deux compteurs ne se melangent jamais.
 * L'IP est normalisee (voir normaliserIp) pour qu'une meme machine, ou un
 * meme bloc IPv6 /64, n'ait qu'un seul compteur.
 */
export function cleIp(ip: string): string {
  return "ip:" + normaliserIp(ip);
}

function ipUtilisable(valeur: string | null | undefined): string | null {
  if (typeof valeur !== "string") return null;
  const ip = valeur.trim();
  if (!ip || ip.length > LONGUEUR_MAX_IP) return null;
  return ip;
}

/**
 * x-forwarded-for peut contenir une chaine "client, proxy1, proxy2" : le
 * client est le PREMIER element. Limite assumee : hors d'un hebergeur qui
 * reecrit cet en-tete (Vercel), un client peut l'inventer ; la limite par
 * email, elle, ne depend pas de l'en-tete.
 */
export function extraireIp(headers: { get(nom: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const premiere = ipUtilisable(forwarded.split(",")[0]);
    if (premiere) return premiere;
  }
  return ipUtilisable(headers.get("x-real-ip"));
}

/**
 * Fenetre absente ou date illisible = terminee : on repart d'un compteur
 * neuf plutot que de bloquer sur une donnee qu'on ne sait pas lire. Meme
 * frontiere que le pipeline de reserverTentative (a exactement 15 minutes,
 * la fenetre est terminee).
 */
export function fenetreTerminee(debut: Date | null | undefined, maintenant: Date): boolean {
  if (!debut) return true;
  const ecouleMs = maintenant.getTime() - debut.getTime();
  if (Number.isNaN(ecouleMs)) return true;
  return ecouleMs >= FENETRE_MS;
}

/** n compte la tentative en cours : avec max = 5, la 5e passe, la 6e non. */
export function tentativeAutorisee(n: number, max: number): boolean {
  return n <= max;
}

// ---------------------------------------------------------------------------
// Base de donnees
// ---------------------------------------------------------------------------

/**
 * Compte la tentative AVANT que le mot de passe soit verifie, en UNE
 * operation atomique (findOneAndUpdate + upsert + pipeline). On compte les
 * tentatives et non les echecs : 50 essais envoyes en meme temps recoivent
 * chacun un numero different (1 a 50), seuls les 5 premiers sont evalues.
 * Compter les echecs apres coup laisserait passer les 50, car aucun n'aurait
 * encore echoue au moment ou les autres verifient le compteur.
 *
 * Le pipeline (et non un $inc simple) permet de decider DANS la base si la
 * fenetre est terminee : un "lire puis ecrire" cote serveur ne serait pas
 * atomique. A la creation (upsert), le document ne contient que `cle`, donc
 * `debut` est absent et la premiere branche s'applique.
 */
export async function reserverTentative(
  cle: string,
  max: number,
  maintenant = new Date()
): Promise<{ autorise: boolean; n: number; reessayerApres: Date }> {
  await connectDB();

  const seuil = new Date(maintenant.getTime() - FENETRE_MS);
  // $type different de "date" couvre le champ absent (upsert) et null.
  const fenetreFinie = {
    $or: [{ $ne: [{ $type: "$debut" }, "date"] }, { $lte: ["$debut", seuil] }],
  };

  const compter = () =>
    LoginAttemptModel.findOneAndUpdate(
      { cle },
      [
        {
          $set: {
            n: { $cond: [fenetreFinie, 1, { $add: ["$n", 1] }] },
            debut: { $cond: [fenetreFinie, maintenant, "$debut"] },
          },
        },
        // Deuxieme etape : lit le `debut` deja mis a jour par la premiere.
        { $set: { expiresAt: { $add: ["$debut", FENETRE_MS] } } },
      ],
      { upsert: true, returnDocument: "after", updatePipeline: true, lean: true }
    );

  let doc;
  try {
    doc = await compter();
  } catch (e) {
    // Deux upserts simultanes sur une cle NEUVE : les deux tentent de creer
    // le document, l'index unique en refuse un (code 11000). Le second essai
    // trouve le document deja cree et l'incremente normalement : aucune
    // tentative n'est perdue ni comptee deux fois.
    if ((e as { code?: unknown })?.code !== 11000) throw e;
    doc = await compter();
  }

  // Ne peut pas arriver avec upsert + "after" ; si ca arrivait quand meme,
  // on refuse plutot que de laisser passer sans compter.
  if (!doc) {
    return { autorise: false, n: max + 1, reessayerApres: new Date(maintenant.getTime() + FENETRE_MS) };
  }

  return {
    autorise: tentativeAutorisee(doc.n, max),
    n: doc.n,
    reessayerApres: doc.expiresAt,
  };
}

/**
 * Appelee apres une connexion REUSSIE, pour la cle email seulement : la
 * personne a prouve qu'elle connait le mot de passe. Jamais pour la cle IP,
 * sinon un attaquant qui possede UN compte pourrait remettre le compteur de
 * son IP a zero entre deux series d'essais sur d'autres comptes.
 */
export async function reinitialiserCompteur(cle: string): Promise<void> {
  await connectDB();
  await LoginAttemptModel.deleteOne({ cle });
}
