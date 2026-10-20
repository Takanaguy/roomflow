import { z } from "zod";
import { estObjectIdValide } from "@/lib/tasks";

/**
 * Champs Zod partages entre la creation (POST) et la modification (PATCH)
 * d'une tache : un fichier a part car un fichier route.ts de Next ne peut
 * exporter que des handlers HTTP. Les valeurs par defaut (assignedTo [],
 * recurrence "none", rotation false) sont ajoutees par la creation seulement,
 * sinon un PATCH sans ces champs les remettrait a zero sans le dire.
 */
export const idUtilisateurSchema = z
  .string()
  .refine(estObjectIdValide, "Identifiant de membre invalide");

export const champsTache = {
  title: z.string().trim().min(1, "Titre requis").max(120, "Titre trop long (120 caractères max)"),
  description: z.string().trim().max(1000, "Description trop longue (1000 caractères max)"),
  assignedTo: z.array(idUtilisateurSchema).max(50, "Trop de personnes assignées (50 max)"),
  recurrence: z.enum(["none", "weekly", "monthly"]),
  rotation: z.boolean(),
  dueDate: z.string().datetime("Échéance invalide"),
};
