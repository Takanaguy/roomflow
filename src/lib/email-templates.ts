// Modeles d'emails (lot 9). Fichier PUR : aucun import de modele, de Mongoose
// ni de Resend, pour pouvoir tester chaque mail avec de simples appels de
// fonction. L'envoi lui-meme vit dans src/lib/email.ts.
//
// Les mails sont du HTML ecrit a la main (tables + styles en ligne) : les
// clients mail (Outlook surtout) ignorent <style>, les classes CSS, flexbox et
// grid. Pas de react-email pour ne pas ajouter de dependance.

export type EmailRendu = { subject: string; html: string; text: string };

// Couleurs sobres, alignees sur les zinc de l'application.
const COULEUR_TEXTE = "#18181b";
const COULEUR_DISCRETE = "#52525b";
const COULEUR_FOND = "#f4f4f5";
const COULEUR_BORDURE = "#e4e4e7";
const POLICE = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const LONGUEUR_MAX_SUJET = 90;

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

const ECHAPPEMENTS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Neutralise les 5 caracteres dangereux en HTML. TOUTE donnee saisie par un
 * utilisateur (nom, description de depense, titre de tache, nom de
 * colocation) doit passer par ici avant d'entrer dans un corps HTML : sans
 * ca, un nom comme "<img src=x onerror=...>" deviendrait du vrai HTML dans la
 * boite mail des autres colocataires. Le & est traite dans le meme passage
 * que les autres (un seul replace) pour ne jamais re-echapper un resultat.
 */
export function echapperHtml(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ECHAPPEMENTS[c]);
}

/**
 * Montant en euros au format francais : 6.66 => "6,66 €", 1234.5 => "1 234,50 €".
 * On travaille sur des centimes entiers (comme le reste du projet) : le
 * toPrecision(15) retire le bruit binaire du flottant avant l'arrondi, sinon
 * 1.005 * 100 donnerait 100.49999999999999 et s'afficherait "1,00 €". L'arrondi
 * se fait sur la valeur absolue car Math.round(-100.5) vaut -100 (arrondi vers
 * le haut) alors qu'on veut la meme chose pour les deux signes. Une valeur non
 * finie s'affiche 0 plutot que de faire planter l'envoi d'un mail.
 */
export function formaterEuros(montant: number): string {
  const brut = Number.isFinite(montant) ? montant : 0;
  const centimes = Math.round(Math.abs(Number((brut * 100).toPrecision(15))));
  const euros = Math.floor(centimes / 100);
  const reste = String(centimes % 100).padStart(2, "0");
  const eurosGroupes = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const signe = brut < 0 && centimes > 0 ? "-" : "";
  return `${signe}${eurosGroupes},${reste} €`;
}

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * "jeudi 22 octobre 2026". En UTC pour la meme raison que le reste du projet :
 * les echeances sont stockees a minuit UTC, un affichage en heure locale du
 * serveur pourrait annoncer la veille.
 */
function formaterDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "date inconnue";
  return FORMAT_DATE.format(date);
}

/** "a", "a et b", "a, b et c" */
function listerEnFrancais(elements: string[]): string {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

/**
 * L'objet d'un mail est un en-tete : un retour a la ligne dans un nom de
 * colocation permettrait d'y injecter d'autres en-tetes. On aplatit les
 * espaces et on coupe les textes trop longs (l'objet est affiche tronque par
 * les clients mail de toute facon).
 */
function nettoyerSujet(sujet: string): string {
  const plat = sujet.replace(/\s+/g, " ").trim();
  return plat.length > LONGUEUR_MAX_SUJET ? `${plat.slice(0, LONGUEUR_MAX_SUJET - 1)}…` : plat;
}

/**
 * Bouton-lien en HTML, suivi du lien en clair : certains clients bloquent les
 * boutons ou affichent mal les liens, le texte brut permet de le copier. Le
 * libelle et l'URL sont echappes ici, l'appelant passe des valeurs brutes.
 */
export function boutonHtml(libelle: string, lien: string): string {
  const href = echapperHtml(lien);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">` +
    `<tr><td style="background-color:${COULEUR_TEXTE};border-radius:6px;">` +
    `<a href="${href}" style="display:inline-block;padding:12px 20px;font-family:${POLICE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${echapperHtml(libelle)}</a>` +
    `</td></tr></table>` +
    `<p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:${COULEUR_DISCRETE};">` +
    `Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur : ` +
    `<a href="${href}" style="color:${COULEUR_DISCRETE};word-break:break-all;">${href}</a></p>`
  );
}

/** Paragraphe de corps. Le contenu est du HTML DEJA echappe par l'appelant. */
function paragraphe(htmlDejaSur: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${COULEUR_TEXTE};">${htmlDejaSur}</p>`;
}

/**
 * Texte brut -> HTML echappe. Une URL n'est rendue cliquable QUE si elle fait
 * partie de `liensAutorises` (comparaison exacte) : le pied contient le nom de
 * la colocation, saisi par un utilisateur, et un nom comme "https://site-piege"
 * ne doit pas devenir un lien cliquable dans le mail de tous les membres.
 */
function texteVersHtml(texte: string, liensAutorises: string[]): string {
  const autorises = new Set(liensAutorises.map(echapperHtml));
  return echapperHtml(texte).replace(/https?:\/\/[^\s]+/g, (url) =>
    autorises.has(url)
      ? `<a href="${url}" style="color:${COULEUR_DISCRETE};word-break:break-all;">${url}</a>`
      : url
  );
}

/**
 * Gabarit commun a tous les mails : une carte blanche de 560px max sur fond
 * gris clair, entete "RoomFlow", pied optionnel. `corpsHtml` est du HTML
 * deja construit (et echappe) par le modele ; `titre` et `pied` sont du texte
 * brut, echappes ici. Renvoie aussi la version texte brut equivalente, car un
 * mail sans partie texte est un signal de spam pour certains filtres.
 */
export function habillerEmail({
  titre,
  corpsHtml,
  corpsTexte,
  pied,
  liensAutorises = [],
}: {
  titre: string;
  corpsHtml: string;
  corpsTexte: string;
  pied?: string;
  /** URL du pied qui peuvent devenir cliquables (toutes les autres restent du texte). */
  liensAutorises?: string[];
}): { html: string; text: string } {
  const bloc = (contenu: string) =>
    `<tr><td style="padding:0 4px;">${contenu}</td></tr>`;

  const html =
    `<!DOCTYPE html>` +
    `<html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${echapperHtml(titre)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${COULEUR_FOND};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COULEUR_FOND};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${POLICE};">` +
    bloc(
      `<p style="margin:0 0 12px 0;font-size:14px;font-weight:700;letter-spacing:0.5px;color:${COULEUR_DISCRETE};">RoomFlow</p>`
    ) +
    `<tr><td style="background-color:#ffffff;border:1px solid ${COULEUR_BORDURE};border-radius:8px;padding:28px 24px;">` +
    `<h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:${COULEUR_TEXTE};">${echapperHtml(titre)}</h1>` +
    corpsHtml +
    `</td></tr>` +
    (pied
      ? bloc(
          `<p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:${COULEUR_DISCRETE};">${texteVersHtml(pied, liensAutorises)}</p>`
        )
      : "") +
    `</table></td></tr></table></body></html>`;

  const text = [titre, "", corpsTexte, ...(pied ? ["", "--", pied] : [])].join("\n");
  return { html, text };
}

/**
 * Pied des mails de NOTIFICATION. Les mails de securite (mot de passe, compte
 * externe) n'en ont pas : on ne peut pas se desabonner d'un mail qu'on a soi
 * meme demande pour se connecter.
 */
function piedNotification(nomColocation: string, lienProfil: string): string {
  return (
    `Tu reçois cet email car tu fais partie de la colocation ${nomColocation}. ` +
    `Tu peux désactiver les notifications dans ton profil : ${lienProfil}`
  );
}

// ---------------------------------------------------------------------------
// Modeles
// ---------------------------------------------------------------------------

export function emailBienvenue({
  nomColocation,
  lien,
  lienProfil,
}: {
  nomColocation: string;
  lien: string;
  lienProfil: string;
}): EmailRendu {
  const titre = `Tu as rejoint la colocation ${nomColocation}`;
  const { html, text } = habillerEmail({
    titre,
    corpsHtml:
      paragraphe(
        `Tu fais maintenant partie de la colocation <strong>${echapperHtml(nomColocation)}</strong> sur RoomFlow.`
      ) +
      paragraphe("Tu peux consulter les dépenses, les tâches et la liste de courses de la colocation.") +
      boutonHtml("Ouvrir la colocation", lien),
    corpsTexte: [
      `Tu fais maintenant partie de la colocation ${nomColocation} sur RoomFlow.`,
      "Tu peux consulter les dépenses, les tâches et la liste de courses de la colocation.",
      "",
      `Ouvrir la colocation : ${lien}`,
    ].join("\n"),
    pied: piedNotification(nomColocation, lienProfil),
    liensAutorises: [lienProfil],
  });
  return { subject: nettoyerSujet(`RoomFlow : tu as rejoint ${nomColocation}`), html, text };
}

export function emailDepense({
  auteur,
  description,
  montant,
  nomColocation,
  remboursements,
  lien,
  lienProfil,
}: {
  auteur: string;
  description: string;
  montant: number;
  nomColocation: string;
  remboursements: { versNom: string; montant: number }[];
  lien: string;
  lienProfil: string;
}): EmailRendu {
  const titre = "Nouvelle dépense";
  const total = formaterEuros(montant);

  // "tu dois 6,66 € à Test 1 et 26,67 € à Test 2". Sans remboursement a faire
  // (tu es le payeur, ou tu as paye ta part), on le dit explicitement plutot
  // que d'envoyer une phrase vide.
  const dois = remboursements.map((r) => ({
    texte: `${formaterEuros(r.montant)} à ${r.versNom}`,
    html: `<strong>${echapperHtml(formaterEuros(r.montant))}</strong> à ${echapperHtml(r.versNom)}`,
  }));
  const phraseTexte =
    dois.length > 0
      ? `Pour cette dépense, tu dois ${listerEnFrancais(dois.map((d) => d.texte))}.`
      : "Pour cette dépense, tu ne dois rien.";
  const phraseHtml =
    dois.length > 0
      ? `Pour cette dépense, tu dois ${listerEnFrancais(dois.map((d) => d.html))}.`
      : "Pour cette dépense, tu ne dois rien.";

  const { html, text } = habillerEmail({
    titre,
    corpsHtml:
      paragraphe(
        `<strong>${echapperHtml(auteur)}</strong> a ajouté une dépense dans la colocation ` +
          `<strong>${echapperHtml(nomColocation)}</strong> : ${echapperHtml(description)} (${echapperHtml(total)}).`
      ) +
      paragraphe(phraseHtml) +
      boutonHtml("Voir la dépense", lien),
    corpsTexte: [
      `${auteur} a ajouté une dépense dans la colocation ${nomColocation} : ${description} (${total}).`,
      phraseTexte,
      "",
      `Voir la dépense : ${lien}`,
    ].join("\n"),
    pied: piedNotification(nomColocation, lienProfil),
    liensAutorises: [lienProfil],
  });
  return {
    subject: nettoyerSujet(`RoomFlow : nouvelle dépense dans ${nomColocation}`),
    html,
    text,
  };
}

export function emailRappelTache({
  titre,
  nomColocation,
  echeance,
  lien,
  lienProfil,
}: {
  titre: string;
  nomColocation: string;
  echeance: Date;
  lien: string;
  lienProfil: string;
}): EmailRendu {
  const date = formaterDate(echeance);
  const { html, text } = habillerEmail({
    titre: "Rappel de tâche",
    corpsHtml:
      paragraphe(
        `La tâche <strong>${echapperHtml(titre)}</strong> de la colocation ` +
          `<strong>${echapperHtml(nomColocation)}</strong> t'est assignée.`
      ) +
      paragraphe(`Échéance : <strong>${echapperHtml(date)}</strong>.`) +
      boutonHtml("Voir la tâche", lien),
    corpsTexte: [
      `La tâche ${titre} de la colocation ${nomColocation} t'est assignée.`,
      `Échéance : ${date}.`,
      "",
      `Voir la tâche : ${lien}`,
    ].join("\n"),
    pied: piedNotification(nomColocation, lienProfil),
    liensAutorises: [lienProfil],
  });
  return { subject: nettoyerSujet(`RoomFlow : rappel de tâche, ${titre}`), html, text };
}

export function emailMotDePasse({
  lien,
  dureeMinutes,
}: {
  lien: string;
  dureeMinutes: number;
}): EmailRendu {
  const duree = `${dureeMinutes} minute${dureeMinutes > 1 ? "s" : ""}`;
  const { html, text } = habillerEmail({
    titre: "Réinitialise ton mot de passe",
    corpsHtml:
      paragraphe("Tu as demandé à réinitialiser le mot de passe de ton compte RoomFlow.") +
      paragraphe(`Ce lien est valable ${echapperHtml(duree)}.`) +
      boutonHtml("Choisir un nouveau mot de passe", lien) +
      paragraphe("Si tu n'es pas à l'origine de cette demande, ignore ce message : ton mot de passe ne changera pas."),
    corpsTexte: [
      "Tu as demandé à réinitialiser le mot de passe de ton compte RoomFlow.",
      `Ce lien est valable ${duree} :`,
      lien,
      "",
      "Si tu n'es pas à l'origine de cette demande, ignore ce message : ton mot de passe ne changera pas.",
    ].join("\n"),
  });
  return { subject: "RoomFlow : réinitialise ton mot de passe", html, text };
}

/** "google" => "Google", "github" => "GitHub", autre => tel quel. */
function nomAffichableProvider(provider: string): string {
  const connus: Record<string, string> = { google: "Google", github: "GitHub" };
  return connus[provider.trim().toLowerCase()] ?? provider;
}

export function emailCompteExterne({
  provider,
  lien,
}: {
  provider: string;
  lien: string;
}): EmailRendu {
  const nom = nomAffichableProvider(provider);
  const { html, text } = habillerEmail({
    titre: `Connecte-toi avec ${nom}`,
    corpsHtml:
      paragraphe("Tu as demandé à réinitialiser ton mot de passe RoomFlow.") +
      paragraphe(
        `Ton compte utilise la connexion <strong>${echapperHtml(nom)}</strong> : il n'y a pas de mot de passe à réinitialiser. ` +
          "Connecte-toi simplement avec ce bouton."
      ) +
      boutonHtml(`Se connecter avec ${nom}`, lien) +
      paragraphe("Si tu n'es pas à l'origine de cette demande, ignore ce message."),
    corpsTexte: [
      "Tu as demandé à réinitialiser ton mot de passe RoomFlow.",
      `Ton compte utilise la connexion ${nom} : il n'y a pas de mot de passe à réinitialiser. Connecte-toi simplement avec ce lien :`,
      lien,
      "",
      "Si tu n'es pas à l'origine de cette demande, ignore ce message.",
    ].join("\n"),
  });
  return { subject: nettoyerSujet(`RoomFlow : connecte-toi avec ${nom}`), html, text };
}
