import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import { COUT_BCRYPT } from "@/lib/auth-schemas";
import { envoyerEmail, construireUrl } from "@/lib/email";
import { emailCompteExterne, emailMotDePasse } from "@/lib/email-templates";
import UserModel from "@/models/User";
import PasswordResetTokenModel from "@/models/PasswordResetToken";

export const DUREE_JETON_MINUTES = 60;
export const DELAI_MIN_ENTRE_DEMANDES_SECONDES = 60;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** SHA-256 en hexadecimal : c'est la seule forme du jeton qui touche la base. */
export function hacherJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/**
 * 32 octets aleatoires (256 bits) du generateur cryptographique : impossible a
 * deviner, donc un hash rapide (SHA-256) suffit, contrairement a un mot de
 * passe humain qui demanderait bcrypt. base64url : sans "+", "/" ni "=", le
 * jeton passe tel quel dans une URL.
 */
export function genererJeton(): { jeton: string; hash: string } {
  const jeton = randomBytes(32).toString("base64url");
  return { jeton, hash: hacherJeton(jeton) };
}

/**
 * Expire des que maintenant >= expiresAt. Ecrit en negatif ("pas encore
 * expire" doit etre vrai) pour qu'une date invalide (NaN) compte comme
 * expiree : en cas de doute, on refuse le lien.
 */
export function jetonExpire(expiresAt: Date, maintenant: Date): boolean {
  return !(maintenant.getTime() < expiresAt.getTime());
}

/**
 * Vrai si un jeton a ete cree pour cette personne il y a moins de
 * DELAI_MIN_ENTRE_DEMANDES_SECONDES. Aucun jeton connu (ou date illisible)
 * ne bloque pas : mieux vaut un mail de trop qu'une personne coincee.
 */
export function demandeTropRecente(
  dernierCreatedAt: Date | null | undefined,
  maintenant: Date
): boolean {
  if (!dernierCreatedAt) return false;
  const ecouleMs = maintenant.getTime() - dernierCreatedAt.getTime();
  if (Number.isNaN(ecouleMs)) return false;
  return ecouleMs < DELAI_MIN_ENTRE_DEMANDES_SECONDES * 1000;
}

/**
 * Date limite pour le verrou de frequence : une demande est acceptee si la
 * precedente est anterieure ou egale a ce seuil (meme frontiere que
 * demandeTropRecente : a exactement 60 s, la demande passe). Pure, pour
 * pouvoir verifier le calcul sans base.
 */
export function seuilDemandeRecente(maintenant: Date): Date {
  return new Date(maintenant.getTime() - DELAI_MIN_ENTRE_DEMANDES_SECONDES * 1000);
}

// ---------------------------------------------------------------------------
// Base de donnees
// ---------------------------------------------------------------------------

/**
 * Traitement d'une demande "mot de passe oublie". Appelee dans after() : la
 * reponse HTTP est deja partie, donc ni la duree ni l'issue de ce travail ne
 * peuvent trahir si l'email existe. NE LEVE JAMAIS (rien ne l'attraperait
 * apres la reponse). Dans les logs : le nom de l'erreur seulement, jamais
 * l'adresse, le jeton ou le message brut (une erreur de doublon Mongo cite
 * la valeur en cause).
 */
export async function traiterDemandeReinitialisation(email: string): Promise<void> {
  try {
    const adresse = email.trim().toLowerCase();
    if (!adresse) return;

    await connectDB();

    // Verrou de frequence, AVANT de regarder le provider, en UNE operation
    // atomique : "trouve cette personne SI sa derniere demande date de plus
    // de 60 s, et note la demande maintenant". Deux demandes simultanees ne
    // peuvent pas passer toutes les deux (la seconde ne trouve plus rien), et
    // la limite vaut aussi pour les comptes Google/GitHub, sans quoi on
    // pourrait bombarder une adresse de mails. Rien trouve = email inconnu OU
    // demande trop recente : dans les deux cas on s'arrete, et la reponse HTTP
    // est deja partie, identique.
    const maintenant = new Date();
    const user = await UserModel.findOneAndUpdate(
      {
        email: adresse,
        // Compte demo (mot de passe public) : jamais de jeton ni de mail. Rien
        // trouve = on s'arrete, comme pour un email inconnu, et la reponse HTTP
        // est deja partie, identique.
        demo: { $ne: true },
        $or: [
          { derniereDemandeMdpAt: { $exists: false } },
          { derniereDemandeMdpAt: null },
          { derniereDemandeMdpAt: { $lte: seuilDemandeRecente(maintenant) } },
        ],
      },
      { $set: { derniereDemandeMdpAt: maintenant } },
      { projection: { _id: 1, email: 1, provider: 1 } }
    );
    if (!user) return;

    // Compte Google/GitHub : pas de mot de passe a reinitialiser, donc pas de
    // jeton. Le mail explique de se connecter avec le bon bouton.
    if (user.provider !== "credentials") {
      const mail = emailCompteExterne({
        provider: user.provider,
        lien: construireUrl("/connexion"),
      });
      await envoyerEmail({ to: user.email, ...mail });
      return;
    }

    // Supprimer AVANT de creer : un seul jeton valide a la fois, l'ancien lien
    // cesse de marcher des qu'un nouveau est demande.
    await PasswordResetTokenModel.deleteMany({ userId: user._id });

    const { jeton, hash } = genererJeton();
    await PasswordResetTokenModel.create({
      userId: user._id,
      tokenHash: hash,
      expiresAt: new Date(maintenant.getTime() + DUREE_JETON_MINUTES * 60_000),
    });

    const mail = emailMotDePasse({
      lien: construireUrl(`/reinitialiser-mot-de-passe?token=${encodeURIComponent(jeton)}`),
      dureeMinutes: DUREE_JETON_MINUTES,
    });
    await envoyerEmail({ to: user.email, ...mail });
  } catch (e) {
    console.error(
      `[mot-de-passe] échec du traitement d'une demande : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
  }
}

/**
 * Pour la page du lien : le jeton existe et n'est pas expire. Ne consomme
 * rien (c'est reinitialiserMotDePasse qui le fait).
 */
export async function verifierJeton(jeton: string): Promise<boolean> {
  if (typeof jeton !== "string" || !jeton) return false;

  await connectDB();
  const doc = await PasswordResetTokenModel.findOne({ tokenHash: hacherJeton(jeton) }).select(
    "expiresAt"
  );
  if (!doc) return false;
  return !jetonExpire(doc.expiresAt, new Date());
}

/**
 * Change le mot de passe grace a un jeton. Le mot de passe doit deja etre
 * valide par l'appelant (Zod). Tout echec renvoie le meme { ok: false } : on
 * ne dit pas si le jeton est inconnu, expire ou deja utilise.
 *
 * Le jeton est supprime par un findOneAndDelete ATOMIQUE avant tout le reste :
 * si deux requetes arrivent en meme temps avec le meme lien, la base n'en
 * rend le document qu'a une seule, l'autre voit "inconnu". Un "lire puis
 * supprimer" laisserait passer les deux. Contrepartie assumee : si le serveur
 * s'arrete juste apres cette suppression, le lien est perdu sans que le mot
 * de passe ait change ; il suffit de refaire une demande (echec sans danger).
 */
export async function reinitialiserMotDePasse(
  jeton: string,
  nouveauMotDePasse: string
): Promise<{ ok: true } | { ok: false }> {
  if (typeof jeton !== "string" || !jeton) return { ok: false };

  await connectDB();
  const doc = await PasswordResetTokenModel.findOneAndDelete({ tokenHash: hacherJeton(jeton) });
  if (!doc) return { ok: false };

  // Expiration verifiee a la main : le TTL de Mongo peut avoir du retard.
  if (jetonExpire(doc.expiresAt, new Date())) return { ok: false };

  const passwordHash = await bcrypt.hash(nouveauMotDePasse, COUT_BCRYPT);

  // provider "credentials" dans le filtre : par precaution, un compte Google
  // ne doit jamais recevoir de mot de passe, meme avec un jeton valide. Meme
  // chose pour le compte demo (`demo: { $ne: true }`) : son mot de passe est
  // public et ne change pas ; le refus est le meme qu'un jeton invalide.
  // passwordChangedAt dans la MEME ecriture que le hash : pas d'instant ou le
  // mot de passe aurait change sans que les anciennes sessions soient
  // marquees a revoquer. Les sessions deja ouvertes (JWT stockes dans le
  // navigateur, aucune table de sessions cote serveur) ne sont pas coupees a
  // la seconde : le callback jwt de src/auth.ts relit cette date au plus tard
  // tous les INTERVALLE_REVERIFICATION_SECONDES (5 minutes par defaut) et
  // refuse alors toute session ouverte avant elle.
  const maj = await UserModel.updateOne(
    { _id: doc.userId, provider: "credentials", demo: { $ne: true } },
    { $set: { passwordHash, passwordChangedAt: new Date() } }
  );
  if (maj.matchedCount === 0) return { ok: false };

  // Usage unique : plus aucun lien de cette personne ne doit rester valide.
  await PasswordResetTokenModel.deleteMany({ userId: doc.userId });

  return { ok: true };
}
