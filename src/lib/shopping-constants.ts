/**
 * Constantes et fonctions PURES de la liste de courses. Fichier volontairement
 * sans aucun import (ni modele, ni mongoose) : un composant client peut
 * l'importer sans embarquer Mongoose dans le bundle du navigateur. C'est
 * aussi la source unique de la liste de categories, partagee par le modele,
 * les schemas Zod et l'UI.
 */

// Valeurs stockees en base. `as const` pour en tirer le type CategorieCourses
// et pour que z.enum accepte directement ce tableau.
export const VALEURS_CATEGORIES = [
  "fruits-legumes",
  "frais",
  "epicerie",
  "boissons",
  "hygiene",
  "entretien",
  "autre",
] as const;

export type CategorieCourses = (typeof VALEURS_CATEGORIES)[number];

// Record plutot qu'un tableau libre : ajouter une valeur ci-dessus sans son
// libelle ne compile plus, donc les deux listes ne peuvent pas diverger.
const LIBELLES: Record<CategorieCourses, string> = {
  "fruits-legumes": "Fruits et légumes",
  frais: "Frais",
  epicerie: "Épicerie",
  boissons: "Boissons",
  hygiene: "Hygiène",
  entretien: "Entretien",
  autre: "Autre",
};

/** Liste ordonnee (l'ordre sert aussi a l'affichage des groupes et du menu). */
export const CATEGORIES_COURSES: { value: CategorieCourses; label: string }[] =
  VALEURS_CATEGORIES.map((value) => ({ value, label: LIBELLES[value] }));

/** Titre du groupe des articles qui n'ont aucune categorie. */
export const LIBELLE_SANS_CATEGORIE = "Sans catégorie";

function estCategorieConnue(valeur: string | null | undefined): valeur is CategorieCourses {
  return valeur != null && (VALEURS_CATEGORIES as readonly string[]).includes(valeur);
}

/**
 * Libelle affichable d'une categorie. Absente ou inconnue (valeur qui ne
 * serait plus dans la liste un jour) : "Sans catégorie", plutot que
 * d'afficher une valeur technique brute a l'utilisateur.
 */
export function libelleCategorie(valeur: string | null | undefined): string {
  return estCategorieConnue(valeur) ? LIBELLES[valeur] : LIBELLE_SANS_CATEGORIE;
}

export type GroupeCategorie<T> = {
  /** null pour le groupe "Sans catégorie". */
  category: CategorieCourses | null;
  label: string;
  articles: T[];
};

/**
 * Regroupe des articles par categorie, dans l'ordre fixe de
 * CATEGORIES_COURSES, "Sans catégorie" en dernier. Les groupes vides sont
 * omis, et l'ordre d'entree est conserve a l'interieur d'un groupe (le tri
 * par date est fait avant, en base). Une categorie inconnue est rangee dans
 * "Sans catégorie" pour qu'aucun article ne disparaisse de l'affichage.
 * Generique : accepte tout objet qui a un champ `category`.
 */
export function grouperParCategorie<T extends { category: string | null }>(
  articles: readonly T[]
): GroupeCategorie<T>[] {
  const parCategorie = new Map<CategorieCourses | null, T[]>();
  for (const article of articles) {
    const cle = estCategorieConnue(article.category) ? article.category : null;
    const groupe = parCategorie.get(cle);
    if (groupe) groupe.push(article);
    else parCategorie.set(cle, [article]);
  }

  const groupes: GroupeCategorie<T>[] = [];
  for (const { value, label } of CATEGORIES_COURSES) {
    const liste = parCategorie.get(value);
    if (liste) groupes.push({ category: value, label, articles: liste });
  }
  const sans = parCategorie.get(null);
  if (sans) groupes.push({ category: null, label: LIBELLE_SANS_CATEGORIE, articles: sans });
  return groupes;
}
