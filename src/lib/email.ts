import { Resend } from "resend";
import { echapperHtml } from "@/lib/email-templates";

const EXPEDITEUR_PAR_DEFAUT = "RoomFlow <onboarding@resend.dev>";
const URL_PAR_DEFAUT = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

export type DestinataireResolu = {
  to: string;
  subject: string;
  avertissementHtml?: string;
  avertissementTexte?: string;
};

// Avertissements ecrits une seule fois par processus : sans ca, chaque mail
// enverrait la meme ligne dans les logs.
let avertiRedirection = false;
let avertiAppUrl = false;

/**
 * Production = VERCEL_ENV "production" ; sans VERCEL_ENV (hors Vercel), on se
 * rabat sur NODE_ENV. Un deploiement "preview" de Vercel n'est PAS de la
 * production : la redirection de test y reste permise.
 */
export function estEnProduction(env: { VERCEL_ENV?: string; NODE_ENV?: string }): boolean {
  const vercel = env.VERCEL_ENV?.trim();
  if (vercel) return vercel === "production";
  return env.NODE_ENV === "production";
}

/**
 * Adresse de redirection de test a appliquer, ou undefined. EMAIL_REDIRECT_TO
 * n'est JAMAIS appliquee en production : une variable de test oubliee dans
 * les reglages Vercel enverrait tous les mails de tous les utilisateurs (dont
 * les liens de reinitialisation de mot de passe) a une seule adresse.
 */
export function redirectionActive(env: {
  EMAIL_REDIRECT_TO?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}): string | undefined {
  const cible = env.EMAIL_REDIRECT_TO?.trim();
  if (!cible || estEnProduction(env)) return undefined;
  return cible;
}

/**
 * Redirection de TEST (variable EMAIL_REDIRECT_TO). Resend sans domaine verifie
 * n'envoie qu'a l'adresse du compte Resend : pour tester avec les comptes
 * test1@roomflow.test etc., on envoie TOUT a cette adresse unique, et on garde
 * trace du vrai destinataire dans l'objet et en tete du corps. Sans redirection
 * (production), renvoie les valeurs telles quelles : aucun risque de detourner
 * un vrai mail tant que la variable reste vide. Une valeur faite d'espaces
 * compte comme vide (un .env mal rempli ne doit pas rediriger vers "").
 */
export function resoudreDestinataire(
  to: string,
  redirectTo: string | undefined,
  subject: string
): DestinataireResolu {
  const cible = redirectTo?.trim();
  if (!cible) return { to, subject };

  return {
    to: cible,
    subject: `[pour : ${to}] ${subject}`,
    avertissementHtml:
      `<p style="margin:0 0 12px 0;padding:8px 12px;background-color:#fef3c7;border:1px solid #f59e0b;border-radius:6px;font-size:13px;color:#18181b;">` +
      `Mode test : cet email était destiné à <strong>${echapperHtml(to)}</strong>.</p>`,
    avertissementTexte: `[Mode test : cet email était destiné à ${to}]`,
  };
}

/**
 * Colle la base et le chemin avec exactement un "/" entre les deux, quelle que
 * soit la forme de APP_URL ("https://x.app" ou "https://x.app/") et du chemin
 * ("/profil" ou "profil"). La base par defaut vient de APP_URL ; une valeur
 * vide ou faite d'espaces retombe sur localhost, comme si elle etait absente.
 */
export function construireUrl(chemin: string, base?: string): string {
  const configuree = (base ?? process.env.APP_URL ?? "").trim();
  if (!configuree && estEnProduction(process.env) && !avertiAppUrl) {
    avertiAppUrl = true;
    console.warn(
      "[email] APP_URL absente en production : les liens des emails pointent vers localhost"
    );
  }
  const racine = configuree || URL_PAR_DEFAUT;
  return `${racine.replace(/\/+$/, "")}/${chemin.replace(/^\/+/, "")}`;
}

/**
 * "tanguy@gmail.com" => "t***@gmail.com". Les logs serveur (Vercel) sont
 * conserves et lisibles par d'autres : on y garde de quoi reperer un probleme
 * sans y ecrire une adresse complete.
 */
export function masquerAdresse(adresse: string): string {
  const arobase = adresse.lastIndexOf("@");
  if (arobase < 1) return "***";
  return `${adresse[0]}***${adresse.slice(arobase)}`;
}

/** Masque toute adresse presente dans un message d'erreur (Resend en cite parfois). */
function masquerAdressesDansTexte(texte: string): string {
  return texte.replace(/[^\s()<>,;"']+@[^\s()<>,;"']+/g, masquerAdresse);
}

/**
 * Ajoute l'avertissement de redirection en tete du mail : juste apres <body>
 * pour le HTML (a defaut, tout au debut), en premiere ligne pour le texte.
 */
export function injecterAvertissement(
  mail: { html: string; text: string },
  resolu: Pick<DestinataireResolu, "avertissementHtml" | "avertissementTexte">
): { html: string; text: string } {
  let { html, text } = mail;
  if (resolu.avertissementHtml) {
    const avertissement = resolu.avertissementHtml;
    html = /<body[^>]*>/i.test(html)
      ? html.replace(/<body[^>]*>/i, (balise) => balise + avertissement)
      : avertissement + html;
  }
  if (resolu.avertissementTexte) text = `${resolu.avertissementTexte}\n\n${text}`;
  return { html, text };
}

// ---------------------------------------------------------------------------
// Envoi (effet de bord)
// ---------------------------------------------------------------------------

export type ResultatEnvoi = { ok: true } | { ok: false; erreur: string };

/**
 * Envoie un email via Resend. NE LEVE JAMAIS : un echec d'envoi (cle absente,
 * quota depasse, reseau coupe) ne doit pas casser l'action de l'utilisateur
 * qui l'a declenchee (ajouter une depense reste reussi meme si le mail
 * n'part pas). L'appelant regarde au mieux `ok`, et ne doit pas afficher
 * `erreur` tel quel a l'utilisateur : c'est un message technique.
 *
 * Dans les logs : jamais la cle API, jamais le contenu du mail, et le
 * destinataire est masque.
 */
export async function envoyerEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<ResultatEnvoi> {
  try {
    const cle = process.env.RESEND_API_KEY?.trim();
    if (!cle) {
      console.warn("[email] RESEND_API_KEY absente : aucun email envoyé (voir .env.example)");
      return { ok: false, erreur: "Envoi d'emails non configuré" };
    }
    if (!to.trim()) {
      console.error("[email] destinataire vide : email ignoré");
      return { ok: false, erreur: "Destinataire manquant" };
    }

    const redirection = redirectionActive(process.env);
    if (!redirection && process.env.EMAIL_REDIRECT_TO?.trim() && !avertiRedirection) {
      avertiRedirection = true;
      console.warn("[email] EMAIL_REDIRECT_TO est ignorée en production : les emails partent aux vrais destinataires");
    }
    const resolu = resoudreDestinataire(to, redirection, subject);
    const corps = injecterAvertissement({ html, text }, resolu);

    const resend = new Resend(cle);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM?.trim() || EXPEDITEUR_PAR_DEFAUT,
      to: resolu.to,
      subject: resolu.subject,
      html: corps.html,
      text: corps.text,
    });

    if (error) {
      console.error(
        `[email] échec d'envoi à ${masquerAdresse(to)} : ${error.name} (${error.statusCode ?? "?"}) ${masquerAdressesDansTexte(error.message)}`
      );
      return { ok: false, erreur: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = masquerAdressesDansTexte(e instanceof Error ? e.message : "erreur inconnue");
    console.error(`[email] exception à l'envoi à ${masquerAdresse(to)} : ${message}`);
    return { ok: false, erreur: message };
  }
}
