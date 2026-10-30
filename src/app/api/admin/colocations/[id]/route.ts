import { NextResponse } from "next/server";
import { z } from "zod";
import { lireAdminSite } from "@/lib/admin";
import { detruireColocation } from "@/lib/households";
import { estObjectIdValide } from "@/lib/ids";
import { connectDB } from "@/lib/mongodb";
import HouseholdModel from "@/models/Household";

const corpsSchema = z.object({ confirmation: z.string() });

// Meme reponse 404 pour un non-connecte, un non-admin, un id mal forme et une
// colocation absente : un non-admin ne peut pas deviner si l'id existe. Cela
// ne cache PAS la route elle-meme (un GET recoit un 405 qui montre qu'elle
// existe) : la vraie protection est `lireAdminSite`, appele a chaque requete.
function introuvable() {
  return NextResponse.json({ error: "Introuvable" }, { status: 404 });
}

/**
 * Destruction manuelle d'une colocation par l'administrateur du site.
 * Hors du matcher de proxy.ts a dessein : une redirection vers /connexion
 * revelerait que la route existe. La verification d'acces est faite ici, a
 * chaque appel. Une seule colocation par requete.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/admin/colocations/[id]">
) {
  // Avant tout le reste, y compris la lecture du corps : un non-admin ne doit
  // rien apprendre sur les colocations (existence d'un id, nom, validation du corps).
  const admin = await lireAdminSite();
  if (!admin) return introuvable();

  const { id } = await ctx.params;
  if (!estObjectIdValide(id)) return introuvable();

  let nom: string;
  try {
    await connectDB();
    const colocation = await HouseholdModel.findById(id).select("name").lean<{ name?: string }>();
    if (!colocation) return introuvable();
    nom = colocation.name ?? "";
  } catch {
    console.error(`[admin] lecture de la colocation impossible : ${id}`);
    return NextResponse.json({ error: "Erreur serveur. Réessaie." }, { status: 500 });
  }

  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  // Comparaison EXACTE : pas de trim ni de casse ignoree, taper le nom est le garde-fou.
  if (!corps.success || corps.data.confirmation !== nom) {
    return NextResponse.json(
      { error: "La confirmation ne correspond pas au nom de la colocation." },
      { status: 400 }
    );
  }

  try {
    await detruireColocation(id);
  } catch (error) {
    // Ni le nom ni le message d'erreur dans le log : ils peuvent contenir des donnees saisies.
    console.error(
      `[admin] echec de la destruction : ${id} (${error instanceof Error ? error.name : "erreur inconnue"})`
    );
    return NextResponse.json(
      { error: "La destruction a échoué. Réessaie." },
      { status: 500 }
    );
  }

  console.log(`[admin] colocation détruite : ${id}`);
  return NextResponse.json({ ok: true });
}
