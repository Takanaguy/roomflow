import ExpenseModel from "@/models/Expense";
import HouseholdModel from "@/models/Household";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import {
  CATEGORIES_DEPENSE,
  calculerSoldesMembres,
  parserMois,
  totauxParCategorie,
  type MoisDashboard,
  type SoldeMembre,
  type TotalCategorie,
} from "@/lib/dashboard";
import { formaterEuros } from "@/lib/email-templates";
import { estObjectIdValide } from "@/lib/ids";
import { calculerDettesSimplifiees, type DetteSimplifiee } from "@/lib/settlements";

const NOM_UTILISATEUR_SUPPRIME = "Utilisateur supprimé";

/**
 * Plafond de dépenses par export. Le temps de rendu de react-pdf croît plus vite
 * que le nombre de lignes (mesuré : 500 dépenses = 4 à 12 s selon la machine et
 * 22 s pour 10 exports simultanés, 1000 = 14 s et 320 Mo, 5000 = 273 s et 1,5 Go).
 * 300 reste très au-dessus d'un vrai mois de colocation. Au-delà, la fonction
 * serverless dépasserait son temps ou sa mémoire : on refuse proprement.
 */
export const MAX_DEPENSES_EXPORT = 300;

// UTC, comme les bornes du mois : une date stockee a minuit UTC ne doit pas
// basculer sur le mois voisin selon le fuseau du serveur.
const FORMAT_MOIS = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const LIBELLES_CATEGORIE = new Map<string, string>(
  CATEGORIES_DEPENSE.map((c) => [c.category, c.label])
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DepenseRecap = {
  date: Date;
  description: string;
  /** libelle francais ("Courses"), pas le code stocke */
  categorie: string;
  /** euros */
  montant: number;
  payeurs: { nom: string; montant: number }[];
};

export type VirementRecap = {
  de: string;
  a: string;
  /** euros */
  montant: number;
  /** true si le debiteur n'est plus membre (parti avec une dette) */
  deAncienMembre: boolean;
  /** true si le crediteur n'est plus membre */
  aAncienMembre: boolean;
};

export type RecapMensuel = {
  colocation: { nom: string };
  mois: MoisDashboard;
  /** ex. "octobre 2026" */
  moisLibelle: string;
  genereLe: Date;
  categories: TotalCategorie[];
  /** euros */
  totalMois: number;
  depenses: DepenseRecap[];
  soldes: SoldeMembre[];
  /** les soldes sont ceux du jour de generation, pas de la fin du mois */
  soldesAu: Date;
  virements: VirementRecap[];
};

/** Depense telle que lue en base (lean) : seuls les champs utiles au recap. */
export type DepenseBrute = {
  _id: { toString(): string };
  date: Date;
  description: string;
  category: string;
  amount: number;
  payers: { userId: { toString(): string }; amount: number }[];
};

export type EntreeRecap = {
  colocationNom: string;
  mois: MoisDashboard;
  maintenant: Date;
  depenses: DepenseBrute[];
  /** nom par id utilisateur ; un id absent est affiche comme supprime */
  nomsParId: Map<string, string>;
  soldes: SoldeMembre[];
  dettes: DetteSimplifiee[];
};

// ---------------------------------------------------------------------------
// Partie pure
// ---------------------------------------------------------------------------

/** Mois en toutes lettres, en francais ("octobre 2026"). */
export function libelleMois(mois: Pick<MoisDashboard, "annee" | "mois">): string {
  return FORMAT_MOIS.format(new Date(Date.UTC(mois.annee, mois.mois - 1, 1)));
}

/** Libelle francais d'une categorie ; une valeur inconnue retombe sur "Autre", comme le graphique. */
export function libelleCategorie(category: string): string {
  return LIBELLES_CATEGORIE.get(category) ?? "Autre";
}

// Complement des plages couvertes par la police du PDF : voir textePourPdf. \p{Cn} =
// points de code non attribues (ex. U+0378, dans le bloc grec) : la police n'a pas de
// glyphe, et le carre de remplacement chevauchait les lettres voisines.
const HORS_POLICE =
  /[^ -~ -ɏ̀-ͯͰ-ϡϰ-ϿЀ-ԯḀ-ỿ‐-‧‰-⁞₠-₿]|\p{Cn}/gu;

/**
 * Les noms et descriptions viennent d'utilisateurs, mais la police du PDF (Noto
 * Sans) ne couvre que latin, latin etendu, grec et cyrillique. Un caractere hors de
 * ces plages (emoji, chinois...) s'afficherait en carre ou, pire, ferait chevaucher
 * les lettres voisines (constate sur un PDF de controle). On le remplace donc par
 * "?" : on garde l'information "il y avait quelque chose ici" sans lettre fausse.
 * Les plages ont ete verifiees contre les deux fichiers de police.
 */
export function textePourPdf(texte: string): string {
  return (
    texte
      // Joiners et selecteur d'emoji : invisibles, inutiles une fois l'emoji remplace.
      .replace(/[​-‍️]/gu, "")
      // Retour a la ligne, tabulation : une description tient sur une ligne du tableau.
      .replace(/\p{Cc}/gu, " ")
      .replace(HORS_POLICE, "?")
  );
}

/** JJ/MM/AAAA en UTC : les dates de dépenses sont stockées à minuit UTC. */
export function formaterDate(date: Date): string {
  const jj = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${jj}/${mm}/${date.getUTCFullYear()}`;
}

/** "de octobre" serait faux : avril, août et octobre prennent l'apostrophe. */
export function deMois(moisLibelle: string): string {
  return /^[aeiouyéèêh]/i.test(moisLibelle) ? `d'${moisLibelle}` : `de ${moisLibelle}`;
}

/** Un seul payeur : son nom. Plusieurs : "Nom 60,00 €, Nom 40,00 €". Aucun : "(aucun payeur)". */
export function libellePayeurs(payeurs: { nom: string; montant: number }[]): string {
  if (payeurs.length === 0) return "(aucun payeur)";
  if (payeurs.length === 1) return payeurs[0].nom;
  return payeurs.map((p) => `${p.nom} ${formaterEuros(p.montant)}`).join(", ");
}

export function libellePourcentage(pourcentage: number): string {
  // Même règle que le dashboard : une petite catégorie ne s'affiche pas "0 %".
  return pourcentage === 0 ? "< 1 %" : `${pourcentage} %`;
}

/** Vocabulaire du dashboard : "doit", "on lui doit", "à jour". */
export function libelleSolde(montant: number): string {
  if (montant > 0) return `on lui doit ${formaterEuros(montant)}`;
  if (montant < 0) return `doit ${formaterEuros(Math.abs(montant))}`;
  return "à jour";
}

/** Un ancien membre (parti avec une dette) est signalé à côté de son nom. */
export function nomVirement(nom: string, ancienMembre: boolean): string {
  return ancienMembre ? `${nom} (ancien membre)` : nom;
}

/**
 * Date croissante, puis _id : deux depenses du meme jour (minuit UTC) auraient
 * sinon un ordre different d'une generation a l'autre, et donc un PDF
 * different pour les memes donnees.
 */
export function trierDepenses<T extends Pick<DepenseBrute, "_id" | "date">>(depenses: T[]): T[] {
  return [...depenses].sort((a, b) => {
    const ecart = a.date.getTime() - b.date.getTime();
    if (ecart !== 0) return ecart;
    const ia = a._id.toString();
    const ib = b._id.toString();
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/**
 * Assemble le recapitulatif a partir de donnees DEJA LUES : aucun acces base,
 * donc testable seul. Les totaux passent par totauxParCategorie (le meme calcul
 * que le dashboard), pour que le PDF et l'ecran ne puissent pas diverger.
 */
export function construireRecapMensuel(entree: EntreeRecap): RecapMensuel {
  const { mois, maintenant, nomsParId } = entree;
  const nom = (id: string) => textePourPdf(nomsParId.get(id) ?? NOM_UTILISATEUR_SUPPRIME);
  const { categories, total } = totauxParCategorie(entree.depenses);
  // `soldes` ne liste que les membres actuels : c'est la reference pour savoir
  // si un virement nomme un ancien membre. On compare des IDS, jamais des noms
  // (deux membres peuvent porter le meme nom).
  const membresActuels = new Set(entree.soldes.map((s) => s.userId));

  return {
    colocation: { nom: textePourPdf(entree.colocationNom) },
    mois,
    moisLibelle: libelleMois(mois),
    genereLe: maintenant,
    categories,
    totalMois: total,
    depenses: trierDepenses(entree.depenses).map((d) => ({
      date: d.date,
      description: textePourPdf(d.description),
      categorie: libelleCategorie(d.category),
      montant: d.amount,
      payeurs: d.payers.map((p) => ({
        nom: nom(p.userId.toString()),
        montant: p.amount,
      })),
    })),
    soldes: entree.soldes.map((s) => ({ ...s, name: textePourPdf(s.name) })),
    soldesAu: maintenant,
    // Les noms sont deja resolus par calculerDettesSimplifiees.
    virements: entree.dettes.map((d) => ({
      de: textePourPdf(d.fromName),
      a: textePourPdf(d.toName),
      montant: d.amount,
      deAncienMembre: !membresActuels.has(d.fromUserId),
      aAncienMembre: !membresActuels.has(d.toUserId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Partie base
// ---------------------------------------------------------------------------

/**
 * Resultat de donneesRecapMensuel. Union discriminee plutot qu'une exception :
 * "trop de depenses" est un cas normal et previsible (pas un bug), et le
 * compilateur force l'appelant a traiter les trois cas.
 */
export type ResultatRecap =
  | { statut: "ok"; recap: RecapMensuel }
  | { statut: "introuvable" }
  | { statut: "trop_de_depenses"; nombre: number; maximum: number };

/**
 * Lit tout ce qu'il faut au PDF du mois puis delegue la mise en forme a
 * construireRecapMensuel. Statut "introuvable" si la colocation n'existe pas (id
 * mal forme compris, pour eviter une CastError) ; "trop_de_depenses" si le mois
 * depasse MAX_DEPENSES_EXPORT, auquel cas les depenses ne sont meme pas chargees.
 * Aucune verification de droits ici : l'appelant (la route) doit avoir verifie
 * que l'utilisateur est membre.
 *
 * Les virements reprennent calculerDettesSimplifiees, donc exactement ceux de la
 * page "Qui doit quoi" (qui inclut un ancien membre parti avec une dette, alors
 * que `soldes` ne liste que les membres actuels).
 */
export async function donneesRecapMensuel(
  householdId: string,
  moisParam: string | undefined,
  maintenant: Date = new Date()
): Promise<ResultatRecap> {
  if (!estObjectIdValide(householdId)) return { statut: "introuvable" };
  await connectDB();

  const household = (await HouseholdModel.findById(householdId, "name").lean()) as {
    name: string;
  } | null;
  if (!household) return { statut: "introuvable" };

  const mois = parserMois(moisParam, maintenant);

  // Le meme filtre sert au comptage et a la lecture : le plafond porte donc sur
  // exactement les depenses qui iraient dans le PDF.
  const filtre = { householdId, date: { $gte: mois.debut, $lt: mois.fin } };
  const nombre = await ExpenseModel.countDocuments(filtre);
  if (nombre > MAX_DEPENSES_EXPORT) {
    return { statut: "trop_de_depenses", nombre, maximum: MAX_DEPENSES_EXPORT };
  }

  const [depenses, soldes, dettes] = await Promise.all([
    // Toutes les depenses du mois (au plus MAX_DEPENSES_EXPORT, verifie ci-dessus).
    ExpenseModel.find(filtre, "date description category amount payers").lean() as Promise<
      DepenseBrute[]
    >,
    calculerSoldesMembres(householdId),
    calculerDettesSimplifiees(householdId),
  ]);

  // Une seule requete pour tous les payeurs, pas une par ligne.
  const ids = new Set<string>();
  for (const d of depenses) for (const p of d.payers) ids.add(p.userId.toString());
  const users = await UserModel.find({ _id: { $in: [...ids] } }, "name").lean();
  const nomsParId = new Map<string, string>(
    users.map((u) => [u._id.toString(), u.name as string])
  );

  return {
    statut: "ok",
    recap: construireRecapMensuel({
      colocationNom: household.name,
      mois,
      maintenant,
      depenses,
      nomsParId,
      soldes,
      dettes,
    }),
  };
}

// ---------------------------------------------------------------------------
// Nom de fichier
// ---------------------------------------------------------------------------

const LONGUEUR_MAX_SLUG = 40;

/**
 * Nom du fichier PDF telecharge : "roomflow-<slug>-<AAAA-MM>.pdf".
 *
 * Le resultat finit dans l'en-tete Content-Disposition. Le nom de colocation
 * vient d'un utilisateur : on ne garde donc que [a-z0-9-] (ASCII pur), ce qui
 * exclut guillemet, point-virgule, barre oblique et retour ligne, et ferme la
 * porte a une injection d'en-tete. Un nom sans aucun caractere latin (cyrillique,
 * emoji) retombe sur "colocation".
 */
export function nomFichierRecap(
  nomColocation: string,
  mois: { annee: number; mois: number }
): string {
  const nettoye = (s: string) => s.replace(/^-+|-+$/g, "");
  let slug = nettoye(
    nomColocation
      .normalize("NFD")
      // U+0300 a U+036F : les accents separes de leur lettre par NFD.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
  );
  // Tronquer peut laisser un tiret en fin de slug.
  slug = nettoye(slug.slice(0, LONGUEUR_MAX_SLUG));
  if (slug === "") slug = "colocation";

  const aaaa = String(mois.annee).padStart(4, "0");
  const mm = String(mois.mois).padStart(2, "0");
  return `roomflow-${slug}-${aaaa}-${mm}.pdf`;
}
