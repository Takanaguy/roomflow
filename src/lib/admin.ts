import type { Model } from "mongoose";
import { Types } from "mongoose";
import ExpenseModel from "@/models/Expense";
import HouseholdModel from "@/models/Household";
import ShoppingItemModel from "@/models/ShoppingItem";
import TaskModel from "@/models/Task";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import { estObjectIdValide } from "@/lib/ids";
import {
  DELAI_SUPPRESSION_JOURS,
  dernieresActivites,
  evaluerNettoyage,
  type EntreeNettoyage,
  type MotifSuppression,
} from "@/lib/nettoyage";

/**
 * Panneau admin du site (section 15 du CLAUDE.md). Ce fichier decide QUI est
 * administrateur et lit la liste des colocations. Il ne detruit rien : la
 * destruction reste `detruireColocation` (households.ts), appelee par la route.
 */

// ---------------------------------------------------------------------------
// Acces
// ---------------------------------------------------------------------------

/** Les seuls providers dont l'email est verifie par le fournisseur lui-meme. */
const PROVIDERS_VERIFIES = ["google", "github"] as const;

export type AdminSite = {
  id: string;
  email: string;
  provider: (typeof PROVIDERS_VERIFIES)[number];
};

/**
 * Minuscules ASCII SEULEMENT, pas `toLowerCase()` : celui-ci est Unicode
 * complet et ramene par exemple le signe Kelvin (U+212A) sur un "k" ASCII.
 * Pour un controle d'acces, deux chaines differentes ne doivent jamais etre
 * jugees egales ; seule la casse des lettres ASCII est ignoree.
 */
function normaliser(email: string): string {
  return email.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Decide si un utilisateur est administrateur du site. PURE : tout vient des
 * arguments, rien n'est lu en base ni dans process.env.
 *
 * Deux conditions, toutes deux obligatoires :
 *  1. son email est dans SITE_ADMIN_EMAILS (virgules, casse et espaces
 *     ignores, elements vides ignores). Variable absente ou vide : personne.
 *  2. son compte vient de Google ou GitHub. Jamais "credentials" : a
 *     l'inscription par mot de passe l'email n'est pas verifie, n'importe qui
 *     pourrait creer un compte avec l'adresse de l'administrateur.
 *
 * Un email ou un provider absent, vide ou inconnu donne false.
 */
export function estAdminSite(
  utilisateur: { email?: string | null; provider?: string | null },
  env: { SITE_ADMIN_EMAILS?: string }
): boolean {
  if (typeof utilisateur.email !== "string" || typeof utilisateur.provider !== "string") {
    return false;
  }
  if (!(PROVIDERS_VERIFIES as readonly string[]).includes(utilisateur.provider)) return false;

  const email = normaliser(utilisateur.email);
  if (email === "") return false;

  const liste = (env.SITE_ADMIN_EMAILS ?? "")
    .split(",")
    .map(normaliser)
    .filter((e) => e !== "");
  return liste.includes(email);
}

/**
 * L'administrateur connecte, ou null. Ne leve jamais d'exception : session
 * absente, id mal forme, utilisateur supprime, panne de base, tout donne null,
 * donc la meme reponse « introuvable » cote page et cote API.
 *
 * L'email et le provider sont relus EN BASE a partir de l'id de session : on
 * ne fait pas confiance a l'email porte par la session. A appeler a CHAQUE
 * requete (page et route), jamais seulement pour afficher ou masquer un lien.
 */
export async function lireAdminSite(): Promise<AdminSite | null> {
  try {
    // Import dynamique : @/auth charge Auth.js et Next, inutiles (et lourds)
    // pour les tests Vitest de `estAdminSite` et `etatColocation` qui
    // importent ce fichier.
    const { auth } = await import("@/auth");
    const session = await auth();
    const id = session?.user?.id;
    if (typeof id !== "string" || !estObjectIdValide(id)) return null;

    await connectDB();
    const utilisateur = await UserModel.findById(id)
      .select("email provider")
      .lean<{ email?: string; provider?: string }>();
    if (!utilisateur) return null;

    if (!estAdminSite(utilisateur, { SITE_ADMIN_EMAILS: process.env.SITE_ADMIN_EMAILS })) return null;
    // estAdminSite a deja verifie le type et la valeur de ces deux champs.
    return {
      id,
      email: utilisateur.email as string,
      provider: utilisateur.provider as AdminSite["provider"],
    };
  } catch {
    // Message fixe : une erreur de driver peut contenir une adresse ou une URI.
    console.error("[admin] lecture de l'administrateur impossible");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Etat d'une colocation (partie PURE)
// ---------------------------------------------------------------------------

export type EtatColocation =
  | { code: "demo" }
  | { code: "suppression_prevue"; suppressionPrevueLe: Date; motif: MotifSuppression }
  | { code: "vide" }
  | { code: "inactive" }
  | { code: "active" };

export type EntreeEtat = Omit<EntreeNettoyage, "derniereActivite"> & {
  /** null si inconnue : la creation tient lieu d'activite. */
  derniereActivite: Date | null;
};

/**
 * Etat affiche dans le panneau. PURE. Les seuils et les cas limites (strictement
 * plus de 90 jours, activite future, plan incoherent...) ne sont PAS recopies
 * ici : on interroge `evaluerNettoyage`, qui fait foi.
 *
 * Table de decision, premiere ligne vraie gagne :
 *
 *  1. demo === true                                          -> demo
 *  2. suppressionPrevueLe est une date valide ET un plan
 *     COHERENT existe (evaluerNettoyage rend « rien » ou
 *     « supprimer » avec les champs de la colocation)         -> suppression_prevue (date + motif)
 *  3. 0 membre                                               -> vide
 *  4. membres > 0 ET inactive depuis plus de
 *     DELAI_INACTIVITE_JOURS                                  -> inactive
 *  5. sinon                                                  -> active
 *
 * Un plan perime (activite revenue, quelqu'un a rejoint, donnees abimees) rend
 * « annuler » ou « planifier_vide » : on ne l'affiche pas comme une suppression
 * prevue, l'etat se deduit alors des faits (lignes 3 a 5), comme le fera le
 * prochain passage du nettoyage.
 */
export function etatColocation(entree: EntreeEtat, maintenant: Date): EtatColocation {
  if (entree.demo === true) return { code: "demo" };

  const complete: EntreeNettoyage = {
    ...entree,
    derniereActivite: entree.derniereActivite ?? entree.creeLe,
  };

  const echeance = entree.suppressionPrevueLe;
  if (echeance instanceof Date && !Number.isNaN(echeance.getTime())) {
    const decision = evaluerNettoyage(complete, maintenant);
    // evaluerNettoyage rend « rien » dans certains cas SANS juger la coherence
    // du plan (avertieLe dans le futur) : on la reverifie ici, pour ne jamais
    // annoncer une suppression que le nettoyage n'executera pas. Motif connu,
    // date de depart valide et passee, delai de 30 jours non raccourci.
    const depart =
      entree.motifSuppression === "vide"
        ? entree.videDepuis
        : entree.motifSuppression === "inactive"
          ? entree.avertieLe
          : null;
    const planCoherent =
      depart instanceof Date &&
      !Number.isNaN(depart.getTime()) &&
      depart.getTime() <= maintenant.getTime() &&
      echeance.getTime() >= depart.getTime() + DELAI_SUPPRESSION_JOURS * 86_400_000;
    if (planCoherent && (decision.action === "rien" || decision.action === "supprimer")) {
      // Un plan coherent a toujours un motif valide (verifie par evaluerNettoyage).
      const motif: MotifSuppression =
        entree.motifSuppression === "vide" ? "vide" : "inactive";
      return { code: "suppression_prevue", suppressionPrevueLe: echeance, motif };
    }
  }

  // Sans plan : « planifier_vide » = colocation vide, « avertir_inactive » =
  // inactive. Les champs de plan sont retires pour juger les faits seuls.
  const faits = evaluerNettoyage(
    {
      nombreMembres: complete.nombreMembres,
      creeLe: complete.creeLe,
      derniereActivite: complete.derniereActivite,
    },
    maintenant
  );
  if (faits.action === "planifier_vide") return { code: "vide" };
  if (faits.action === "avertir_inactive") return { code: "inactive" };
  return { code: "active" };
}

// ---------------------------------------------------------------------------
// Liste (lecture)
// ---------------------------------------------------------------------------

/** Plafond de la liste : le panneau ne pagine pas, il previent s'il tronque. */
export const MAX_COLOCATIONS_ADMIN = 200;

/**
 * Une ligne du panneau. Volontairement AUCUN nom d'utilisateur, email ni
 * contenu de depense, tache ou course : le nom de la colocation et des
 * compteurs suffisent a un administrateur de plateforme.
 */
export type LigneColocationAdmin = {
  id: string;
  nom: string;
  nombreMembres: number;
  creeLe: Date;
  derniereActivite: Date;
  nombreDepenses: number;
  nombreTaches: number;
  nombreArticles: number;
  demo: boolean;
  etat: EtatColocation;
};

export type ListeColocationsAdmin = {
  colocations: LigneColocationAdmin[];
  /** Nombre total de colocations en base (peut depasser colocations.length). */
  total: number;
  tronquee: boolean;
};

type LigneCompte = { _id: Types.ObjectId; n: number };

/** UNE agregation pour toutes les colocations demandees : id -> nombre de documents. */
async function compterParColocation(
  modele: Model<unknown>,
  ids: Types.ObjectId[]
): Promise<Map<string, number>> {
  const lignes = await modele.aggregate<LigneCompte>([
    { $match: { householdId: { $in: ids } } },
    { $group: { _id: "$householdId", n: { $sum: 1 } } },
  ]);
  return new Map(lignes.map((l) => [l._id.toString(), l.n]));
}

type ColocationLue = {
  _id: Types.ObjectId;
  name?: string;
  createdAt?: Date;
  members?: unknown[];
  demo?: boolean | null;
  videDepuis?: Date | null;
  avertieLe?: Date | null;
  suppressionPrevueLe?: Date | null;
  motifSuppression?: string | null;
};

/**
 * Les MAX_COLOCATIONS_ADMIN colocations les plus recentes, avec compteurs et
 * etat. Nombre de requetes fixe, quel que soit le nombre de colocations : le
 * total, la liste, `dernieresActivites` (appelee une seule fois) et une
 * agregation par collection pour les compteurs.
 */
export async function listerColocationsAdmin(
  maintenant: Date = new Date()
): Promise<ListeColocationsAdmin> {
  await connectDB();

  const [total, lues] = await Promise.all([
    HouseholdModel.countDocuments(),
    HouseholdModel.find()
      // _id en second critere : ordre stable entre deux colocations creees a la meme milliseconde.
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_COLOCATIONS_ADMIN)
      // members.userId : on ne compte que la longueur, les ids ne sortent jamais d'ici.
      .select(
        "name createdAt members.userId demo videDepuis avertieLe suppressionPrevueLe motifSuppression"
      )
      .lean<ColocationLue[]>(),
  ]);

  if (lues.length === 0) return { colocations: [], total, tronquee: false };

  const idsTexte = lues.map((c) => c._id.toString());
  const ids = lues.map((c) => c._id);
  const [activites, depenses, taches, articles] = await Promise.all([
    dernieresActivites(idsTexte),
    compterParColocation(ExpenseModel, ids),
    compterParColocation(TaskModel, ids),
    compterParColocation(ShoppingItemModel, ids),
  ]);

  const colocations = lues.map((c): LigneColocationAdmin => {
    const id = c._id.toString();
    // Anciens documents sans createdAt : l'horodatage de l'ObjectId en tient lieu.
    const creeLe = c.createdAt ?? c._id.getTimestamp();
    const derniereActivite = activites.get(id) ?? creeLe;
    const nombreMembres = c.members?.length ?? 0;
    return {
      id,
      nom: c.name ?? "",
      nombreMembres,
      creeLe,
      derniereActivite,
      nombreDepenses: depenses.get(id) ?? 0,
      nombreTaches: taches.get(id) ?? 0,
      nombreArticles: articles.get(id) ?? 0,
      demo: c.demo === true,
      etat: etatColocation(
        {
          nombreMembres,
          creeLe,
          derniereActivite,
          demo: c.demo,
          videDepuis: c.videDepuis,
          avertieLe: c.avertieLe,
          suppressionPrevueLe: c.suppressionPrevueLe,
          motifSuppression: c.motifSuppression,
        },
        maintenant
      ),
    };
  });

  return { colocations, total, tronquee: total > colocations.length };
}
