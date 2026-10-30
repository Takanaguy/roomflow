import { NextResponse } from "next/server";
import { executerNettoyage } from "@/lib/nettoyage-cron";
import { secretCronValide } from "@/lib/rappels";

// Un passage plafonne a 50 actions (envois d'emails, suppressions) peut depasser
// la duree par defaut d'une fonction.
export const maxDuration = 60;

/**
 * Appelee chaque jour par Vercel Cron (voir vercel.json), meme protection que
 * /api/cron/rappels-taches : fermee par defaut sans CRON_SECRET, meme reponse
 * 401 quel que soit le motif. La reponse ne contient que des compteurs.
 */
export async function GET(request: Request) {
  if (!secretCronValide(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const rapport = await executerNettoyage();
    return NextResponse.json(rapport);
  } catch (e) {
    console.error(
      `[nettoyage] échec du passage : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    return NextResponse.json({ error: "Échec du nettoyage" }, { status: 500 });
  }
}
