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

/** Prefixe different de cleEmail : les deux compteurs ne se melangent jamais. */
export function cleIp(ip: string): string {
  return "ip:" + ip;
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
