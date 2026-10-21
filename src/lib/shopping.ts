import type { HydratedDocument } from "mongoose";
import ShoppingItemModel, { type ShoppingItem } from "@/models/ShoppingItem";
import UserModel from "@/models/User";
import { connectDB } from "@/lib/mongodb";
import { estObjectIdValide } from "@/lib/ids";
import type { PersonneNommee } from "@/lib/tasks";

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * Supprimer un article : celui qui l'a ajoute ou l'admin (decision de
 * Tanguy). Cocher/decocher, lui, est ouvert a tout membre. Cette fonction ne
 * verifie PAS que userId est membre de la colocation : c'est le travail de
 * getHouseholdForMember, appele avant dans la route.
 */
export function peutSupprimerArticle(
  addedBy: string,
  userId: string,
  estAdmin: boolean
): boolean {
  return estAdmin || addedBy === userId;
}

/**
 * Champs a ecrire quand on coche ou decoche. Representation choisie :
 *  - cocher : checkedBy = userId, checkedAt = maintenant ;
 *  - decocher : checkedBy = null et checkedAt = null. null (et non undefined)
 *    pour que le resultat dise explicitement "ces champs sont a effacer" et
 *    reste comparable dans un test. C'est l'appelant (definirCocheArticle)
 *    qui traduit null en "champ retire" cote Mongoose.
 */
export function appliquerCoche(
  checked: boolean,
  userId: string,
  maintenant: Date
): { checked: boolean; checkedBy: string | null; checkedAt: Date | null } {
  if (checked) {
    return { checked: true, checkedBy: userId, checkedAt: maintenant };
  }
  return { checked: false, checkedBy: null, checkedAt: null };
}

/**
 * Nom d'article propre : espaces de debut/fin retires et espaces multiples
 * (y compris tabulations et retours a la ligne) ramenes a un seul. Sans ca,
 * "lait  demi-ecreme " s'afficherait de travers dans la liste.
 */
export function normaliserNomArticle(nom: string): string {
  return nom.trim().replace(/\s+/g, " ");
}

/**
 * Charge un article ET verifie qu'il appartient bien a householdId : meme
 * logique anti-cross-tenant que getTaskInHousehold. Les DEUX ids sont
 * verifies ici (lecon du lot 6) : un id mal forme ne doit jamais devenir une
 * CastError, donc un 500, quel que soit l'appelant.
 */
export async function getArticleInHousehold(
  householdId: string,
  articleId: string
): Promise<HydratedDocument<ShoppingItem> | null> {
  if (!estObjectIdValide(householdId) || !estObjectIdValide(articleId)) return null;
  await connectDB();
  return ShoppingItemModel.findOne({ _id: articleId, householdId });
}

/**
 * Applique l'etat de coche DEMANDE sur un article deja charge par
 * getArticleInHousehold. Etat explicite et non basculement : si l'utilisateur
 * double-clique, les deux requetes demandent "coche" et le resultat reste
 * "coche", au lieu de re-decocher. Meme etat qu'avant : rien ne change (sinon
 * un double envoi reecrirait checkedAt et checkedBy).
 *
 * Atomique : un simple "lire, comparer, save" laisserait deux requetes
 * simultanees (deux colocs, deux onglets, un retry) voir toutes les deux "pas
 * encore coche" et ecrire, la seconde ecrasant l'heure et l'auteur de
 * l'achat. Ici le filtre exige l'etat OPPOSE (checked: !checked) : une seule
 * requete le trouve, l'autre recoit null et ne reecrit rien. On ne se fie
 * pas a article.checked, qui peut deja etre perime au moment de l'appel.
 *
 * `maintenant` est injectable pour pouvoir figer la date dans un test.
 */
export async function definirCocheArticle(
  article: HydratedDocument<ShoppingItem>,
  checked: boolean,
  userId: string,
  maintenant: Date = new Date()
): Promise<HydratedDocument<ShoppingItem>> {
  await connectDB();
  const champs = appliquerCoche(checked, userId, maintenant);
  // $unset (et non $set a null) : le champ disparait du document, comme un
  // article jamais coche.
  const miseAJour = champs.checked
    ? {
        $set: {
          checked: true,
          checkedBy: champs.checkedBy,
          checkedAt: champs.checkedAt,
        },
      }
    : { $set: { checked: false }, $unset: { checkedBy: "", checkedAt: "" } };

  const modifie = await ShoppingItemModel.findOneAndUpdate(
    { _id: article._id, householdId: article.householdId, checked: !checked },
    miseAJour,
    { returnDocument: "after" }
  );
  if (modifie) return modifie;

  // Rien modifie : deja dans l'etat voulu (ou article supprime entre-temps).
  // On relit l'etat reel plutot que de renvoyer la copie chargee plus tot.
  const actuel = await ShoppingItemModel.findById(article._id);
  return actuel ?? article;
}

/** Combien de temps un article coche reste dans la section "Achetés" de la page principale. */
export const JOURS_ACHETES_DANS_LISTE = 7;

export type ListeCourses = {
  aAcheter: HydratedDocument<ShoppingItem>[];
  achetes: HydratedDocument<ShoppingItem>[];
};

/**
 * Articles de la page principale : ceux a acheter (non coches, du plus ancien
 * au plus recent) et ceux coches depuis moins de JOURS_ACHETES_DANS_LISTE
 * jours (le dernier coche en premier). Les plus anciens ne sont que dans
 * l'historique, sinon la section "Achetés" grossirait sans fin (meme logique
 * que la colonne Fait du Kanban). Renvoie des documents : la page appelle
 * serializeArticles. `maintenant` est injectable pour figer la date dans un test.
 */
export async function listerArticles(
  householdId: string,
  maintenant: Date = new Date()
): Promise<ListeCourses> {
  await connectDB();
  const seuil = new Date(maintenant.getTime() - JOURS_ACHETES_DANS_LISTE * MS_PAR_JOUR);
  const [aAcheter, achetes] = await Promise.all([
    // _id en second critere : deux articles ajoutes a la meme milliseconde
    // sinon changeraient d'ordre d'un rechargement a l'autre.
    ShoppingItemModel.find({ householdId, checked: false }).sort({ createdAt: 1, _id: 1 }),
    ShoppingItemModel.find({ householdId, checked: true, checkedAt: { $gte: seuil } }).sort({
      checkedAt: -1,
      _id: -1,
    }),
  ]);
  return { aAcheter, achetes };
}

/** Plafond de ?page= : evite un skip astronomique envoye a Mongo. */
const PAGE_HISTORIQUE_MAX = 100000;

export type PageHistoriqueCourses = {
  articles: HydratedDocument<ShoppingItem>[];
  /** Nombre total d'articles coches (toutes pages confondues). */
  total: number;
  page: number;
  parPage: number;
  /** Vrai s'il existe une page apres celle-ci. */
  pageSuivante: boolean;
};

/**
 * Historique : tous les articles coches, le plus recent en premier, pagines
 * (page 1 = le plus recent). Une page invalide (0, negative, decimale) est
 * ramenee a 1 plutot que de produire un skip negatif, que Mongo refuse.
 * Renvoie des documents : la page appelle serializeArticles.
 */
export async function listerHistoriqueCourses(
  householdId: string,
  page = 1,
  parPage = 30
): Promise<PageHistoriqueCourses> {
  await connectDB();
  const pageSure =
    Number.isSafeInteger(page) && page >= 1 ? Math.min(page, PAGE_HISTORIQUE_MAX) : 1;
  const parPageSur = Number.isInteger(parPage) && parPage >= 1 ? parPage : 30;

  const filtre = { householdId, checked: true };
  const [articles, total] = await Promise.all([
    ShoppingItemModel.find(filtre)
      // _id en second critere : deux articles coches a la meme milliseconde
      // sinon changeraient d'ordre d'une page a l'autre.
      .sort({ checkedAt: -1, _id: -1 })
      .skip((pageSure - 1) * parPageSur)
      .limit(parPageSur),
    ShoppingItemModel.countDocuments(filtre),
  ]);

  return {
    articles,
    total,
    page: pageSure,
    parPage: parPageSur,
    pageSuivante: pageSure * parPageSur < total,
  };
}

export type ArticleDetail = {
  id: string;
  name: string;
  quantity: string | null;
  category: string | null;
  checked: boolean;
  checkedAt: string | null;
  ajoutePar: PersonneNommee;
  cochePar: PersonneNommee | null;
  peuxSupprimer: boolean;
};

/**
 * Met en forme des articles pour l'API/les pages : meme principe que
 * serializeTasks, les noms (auteur de l'ajout, personne qui a coche) sont
 * recuperes en UNE seule requete groupee, pas une par article (N+1).
 * peuxSupprimer est calcule ici avec la meme fonction pure que la route, pour
 * que l'UI n'affiche jamais un bouton que le serveur refuserait.
 */
export async function serializeArticles(
  articles: HydratedDocument<ShoppingItem>[],
  viewerId: string,
  viewerEstAdmin: boolean
): Promise<ArticleDetail[]> {
  await connectDB();

  const idsUtilisateurs = new Set<string>();
  for (const a of articles) {
    idsUtilisateurs.add(a.addedBy.toString());
    if (a.checkedBy) idsUtilisateurs.add(a.checkedBy.toString());
  }

  const users = await UserModel.find({ _id: { $in: [...idsUtilisateurs] } }, "name");
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));
  // Un auteur parti ou supprime reste affiche par son nom s'il existe encore
  // en base, sinon par ce libelle.
  const personne = (id: string): PersonneNommee => ({
    userId: id,
    name: usersById.get(id)?.name ?? "Utilisateur supprimé",
  });

  return articles.map((a) => {
    const ajouteurId = a.addedBy.toString();
    return {
      id: a._id.toString(),
      name: a.name,
      quantity: a.quantity ?? null,
      category: a.category ?? null,
      checked: a.checked,
      checkedAt: a.checkedAt ? a.checkedAt.toISOString() : null,
      ajoutePar: personne(ajouteurId),
      cochePar: a.checkedBy ? personne(a.checkedBy.toString()) : null,
      peuxSupprimer: peutSupprimerArticle(ajouteurId, viewerId, viewerEstAdmin),
    };
  });
}
