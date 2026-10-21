import { z } from "zod";
import { normaliserNomArticle } from "@/lib/shopping";
import { VALEURS_CATEGORIES } from "@/lib/shopping-constants";

/**
 * Champs Zod de la liste de courses, dans un fichier a part car un fichier
 * route.ts de Next ne peut exporter que des handlers HTTP. Pas de .default()
 * ici (meme raison que tasks-schemas.ts) : c'est la route qui decide.
 */
export const champsArticle = {
  // Normalise AVANT de verifier la longueur : "   " devient "" et est refuse,
  // et 100 caracteres s'entendent espaces multiples reduits.
  name: z
    .string()
    .transform(normaliserNomArticle)
    .pipe(z.string().min(1, "Nom requis").max(100, "Nom trop long (100 caractères max)")),
  quantity: z.string().trim().max(30, "Quantité trop longue (30 caractères max)"),
  category: z.enum(VALEURS_CATEGORIES, "Catégorie invalide"),
  // Message explicite : sans lui, Zod renverrait son erreur de type en anglais.
  checked: z.boolean("Le champ « checked » doit être vrai ou faux"),
};
