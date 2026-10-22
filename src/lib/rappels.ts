import { timingSafeEqual } from "node:crypto";
import HouseholdModel from "@/models/Household";
import TaskModel from "@/models/Task";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import { construireUrl, envoyerEmail } from "@/lib/email";
import { emailRappelTache } from "@/lib/email-templates";

/** Plafond de taches traitees par passage du Cron : borne la duree de la fonction. */
const MAX_TACHES_PAR_EXECUTION = 200;

/**
 * Nombre d'emails envoyes en parallele. Resend limite le debit des requetes
 * (quelques par seconde sur l'offre gratuite) : tout lancer d'un coup ferait
 * echouer une partie des envois en 429. Valeur prudente, pas tiree d'un
 * document du projet : a ajuster d'apres les logs une fois en production.
 */
const TAILLE_LOT_ENVOI = 5;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/**
 * Fenetre des echeances a rappeler : [debut, fin) avec debut = minuit UTC du
 * jour de `maintenant` (inclus) et fin = minuit UTC du surlendemain (EXCLU),
 * soit "aujourd'hui ou demain". Demain suffit pour "la veille" ; aujourd'hui
 * rattrape une tache creee tardivement ou un passage du Cron manque. Les
 * echeances deja depassees n'en font pas partie : on ne rappelle pas un
 * retard. Tout en UTC car dueDate est stockee a minuit UTC ; Date.UTC gere
 * seul les debordements de fin de mois et d'annee.
 */
export function fenetreRappel(maintenant: Date): { debut: Date; fin: Date } {
  if (Number.isNaN(maintenant.getTime())) {
    throw new RangeError("Date de reference invalide");
  }
  const annee = maintenant.getUTCFullYear();
  const mois = maintenant.getUTCMonth();
  const jour = maintenant.getUTCDate();
  return {
    debut: new Date(Date.UTC(annee, mois, jour)),
    fin: new Date(Date.UTC(annee, mois, jour + 2)),
  };
}

/**
 * Une tache est a rappeler si elle n'est pas terminee, a une echeance valide
 * dans la fenetre, n'a pas deja ete rappelee (absent = pas rappelee) et a au
 * moins une personne a prevenir. Meme criteres que la requete de
 * envoyerRappelsTaches, en version testable sans base.
 */
export function tacheARappeler(
  tache: {
    status: string;
    dueDate?: Date | null;
    rappelEnvoye?: boolean | null;
    assignedTo: string[];
  },
  maintenant: Date
): boolean {
  if (tache.status === "done") return false;
  if (tache.rappelEnvoye === true) return false;
  if (tache.assignedTo.length === 0) return false;
  if (!tache.dueDate || Number.isNaN(tache.dueDate.getTime())) return false;
  if (Number.isNaN(maintenant.getTime())) return false;

  const { debut, fin } = fenetreRappel(maintenant);
  return tache.dueDate.getTime() >= debut.getTime() && tache.dueDate.getTime() < fin.getTime();
}

/**
 * Verifie l'en-tete `Authorization: Bearer <secret>` envoye par Vercel Cron.
 * FERMEE PAR DEFAUT : sans secret configure (absent ou vide), personne ne
 * passe, sinon une route oubliee sans CRON_SECRET serait ouverte a tout le
 * monde. Comparaison a temps constant (timingSafeEqual) pour ne pas laisser
 * deviner le secret caractere par caractere en mesurant les temps de reponse.
 * timingSafeEqual exige deux buffers de meme taille, d'ou le test des longueurs
 * avant : il ne revele que la longueur, pas le contenu.
 */
export function secretCronValide(
  enteteAuthorization: string | null | undefined,
  secretAttendu: string | undefined
): boolean {
  if (!secretAttendu || secretAttendu.trim() === "") return false;
  if (!enteteAuthorization) return false;

  const attendu = Buffer.from(`Bearer ${secretAttendu}`);
  const recu = Buffer.from(enteteAuthorization);
  if (recu.length !== attendu.length) return false;
  return timingSafeEqual(recu, attendu);
}

// ---------------------------------------------------------------------------
// Envoi (effets de bord)
// ---------------------------------------------------------------------------

export type BilanRappels = {
  tachesTraitees: number;
  emailsEnvoyes: number;
  echecs: number;
};

// Formes lues avec .lean() (objets Mongo bruts, sans default applique).
type TacheLue = {
  _id: { toString(): string };
  householdId: { toString(): string };
  title: string;
  dueDate: Date;
  assignedTo: { toString(): string }[];
};
type UtilisateurLu = {
  _id: { toString(): string };
  email?: string;
  notificationsEmail?: boolean;
};
type ColocationLue = { _id: { toString(): string }; name?: string };

type Envoi = { to: string; mail: ReturnType<typeof emailRappelTache> };

/**
 * Rappelle par email les assignes des taches dont l'echeance tombe dans la
 * fenetre (voir fenetreRappel), UNE seule fois par tache. Appelee par le Cron
 * quotidien. Ne leve pas d'exception pour un echec d'envoi : il est compte
 * dans `echecs`. Seules les erreurs de base de donnees remontent (la route
 * repond alors 500 et le Cron le montre dans les logs Vercel).
 *
 * Choix assume : la tache est marquee `rappelEnvoye` AVANT l'envoi, par une
 * mise a jour atomique conditionnelle. Si deux passages du Cron se chevauchent,
 * un seul gagne la tache, donc pas de double mail. Contrepartie : si l'envoi
 * echoue ensuite, le rappel est perdu (pas de nouvel essai). Un rappel manque
 * est preferable a un mail en double.
 *
 * Dans les logs : des compteurs seulement, jamais d'adresse ni de contenu.
 * `maintenant` est injectable pour figer la date dans un test.
 */
export async function envoyerRappelsTaches(
  maintenant: Date = new Date()
): Promise<BilanRappels> {
  await connectDB();
  const { debut, fin } = fenetreRappel(maintenant);

  // Une seule requete. Memes criteres que tacheARappeler ; "assignedTo.0"
  // existe = au moins un assigne.
  const taches = await TaskModel.find({
    status: { $ne: "done" },
    rappelEnvoye: { $ne: true },
    "assignedTo.0": { $exists: true },
    dueDate: { $gte: debut, $lt: fin },
  })
    .sort({ dueDate: 1, _id: 1 })
    .limit(MAX_TACHES_PAR_EXECUTION)
    .select("householdId title dueDate assignedTo")
    .lean<TacheLue[]>();

  if (taches.length === 0) {
    console.log("[rappels] aucune tâche à rappeler");
    return { tachesTraitees: 0, emailsEnvoyes: 0, echecs: 0 };
  }

  // Assignes et colocations en deux requetes groupees (pas de N+1), lues
  // AVANT de marquer les taches : un echec de lecture ne doit pas faire perdre
  // des rappels deja marques.
  const idsUtilisateurs = new Set<string>();
  const idsColocations = new Set<string>();
  for (const t of taches) {
    idsColocations.add(t.householdId.toString());
    for (const a of t.assignedTo) idsUtilisateurs.add(a.toString());
  }
  const [utilisateurs, colocations] = await Promise.all([
    UserModel.find({ _id: { $in: [...idsUtilisateurs] } })
      .select("email notificationsEmail")
      .lean<UtilisateurLu[]>(),
    HouseholdModel.find({ _id: { $in: [...idsColocations] } })
      .select("name")
      .lean<ColocationLue[]>(),
  ]);
  const utilisateurParId = new Map(utilisateurs.map((u) => [u._id.toString(), u]));
  const nomColocationParId = new Map(colocations.map((c) => [c._id.toString(), c.name]));
  const lienProfil = construireUrl("/profil");

  let tachesTraitees = 0;
  const envois: Envoi[] = [];
  let echecs = 0;

  for (const tache of taches) {
    const householdId = tache.householdId.toString();
    const nomColocation = nomColocationParId.get(householdId);
    if (!nomColocation) continue;

    // Absent = notifications actives (comptes anterieurs au champ).
    const adresses = tache.assignedTo
      .map((a) => utilisateurParId.get(a.toString()))
      .filter((u): u is UtilisateurLu => Boolean(u && u.email && u.notificationsEmail !== false))
      .map((u) => u.email as string);
    // Personne a prevenir : on ne marque pas la tache, pour qu'elle puisse
    // encore etre rappelee si un assigne reactive ses notifications avant
    // la fin de la fenetre.
    if (adresses.length === 0) continue;

    // Reservation atomique : modifiedCount vaut 0 si un autre passage a deja
    // pris la tache (ou si elle vient d'etre terminee). On saute alors.
    let reservee = false;
    try {
      const res = await TaskModel.updateOne(
        { _id: tache._id, rappelEnvoye: { $ne: true }, status: { $ne: "done" } },
        { $set: { rappelEnvoye: true } }
      );
      reservee = res.modifiedCount === 1;
    } catch (e) {
      console.error(
        `[rappels] échec du marquage d'une tâche : ${e instanceof Error ? e.name : "erreur inconnue"}`
      );
    }
    if (!reservee) continue;
    tachesTraitees++;

    try {
      const mail = emailRappelTache({
        titre: tache.title,
        nomColocation,
        echeance: tache.dueDate,
        lien: construireUrl(`/colocations/${householdId}/taches`),
        lienProfil,
      });
      for (const to of adresses) envois.push({ to, mail });
    } catch (e) {
      // Gabarit en erreur : la tache est deja marquee, ses mails sont perdus.
      echecs += adresses.length;
      console.error(
        `[rappels] échec de préparation d'un mail : ${e instanceof Error ? e.name : "erreur inconnue"}`
      );
    }
  }

  // Envois par lots : en parallele dans un lot, lots l'un apres l'autre.
  let emailsEnvoyes = 0;
  for (let i = 0; i < envois.length; i += TAILLE_LOT_ENVOI) {
    const lot = envois.slice(i, i + TAILLE_LOT_ENVOI);
    const resultats = await Promise.allSettled(
      lot.map(({ to, mail }) => envoyerEmail({ to, ...mail }))
    );
    for (const r of resultats) {
      if (r.status === "fulfilled" && r.value.ok) emailsEnvoyes++;
      else echecs++;
    }
  }

  console.log(
    `[rappels] ${tachesTraitees} tâche(s), ${emailsEnvoyes} email(s) envoyé(s), ${echecs} échec(s)`
  );
  return { tachesTraitees, emailsEnvoyes, echecs };
}
