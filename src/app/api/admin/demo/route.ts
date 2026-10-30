import { NextResponse } from "next/server";
import { lireAdminSite } from "@/lib/admin";
import { demoActive, reinitialiserDemo } from "@/lib/demo";

// Deux hachages bcrypt (cout 12), une destruction et une quinzaine d'insertions :
// rapide, mais la marge evite qu'une base lente coupe la fonction a mi-chemin.
export const maxDuration = 60;

/**
 * Reinitialisation manuelle de la demo par l'administrateur du site, meme
 * operation que le passage de nuit du cron. Meme 404 que les autres routes
 * admin pour un non-admin et un non-connecte, verifie a chaque appel et AVANT
 * tout le reste (y compris l'etat de la demo : un non-admin ne doit rien
 * apprendre). La reponse ne contient que des compteurs.
 */
export async function POST() {
  const admin = await lireAdminSite();
  if (!admin) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  if (!demoActive(process.env)) {
    return NextResponse.json(
      { error: "La démo est désactivée : définis DEMO_PASSWORD." },
      { status: 409 }
    );
  }

  try {
    const rapport = await reinitialiserDemo({ env: process.env, maintenant: new Date() });
    return NextResponse.json(rapport);
  } catch (e) {
    // Le nom de l'erreur seulement : le message brut peut citer une adresse.
    console.error(
      `[demo] échec de la réinitialisation manuelle : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    return NextResponse.json(
      { error: "La réinitialisation a échoué. Réessaie." },
      { status: 500 }
    );
  }
}
