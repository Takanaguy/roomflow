import { NextResponse } from "next/server";
import { envoyerRappelsTaches, secretCronValide } from "@/lib/rappels";

/**
 * Appelee chaque jour par Vercel Cron (voir vercel.json), qui envoie
 * `Authorization: Bearer <CRON_SECRET>` quand la variable CRON_SECRET existe.
 * Hors session utilisateur donc hors du matcher de proxy.ts, et c'est voulu :
 * la protection, c'est ce secret. Meme reponse 401 quel que soit le motif
 * (en-tete absent, faux, ou secret non configure) pour ne rien reveler.
 *
 * Pas de `export const dynamic` : depuis Next 15 un GET n'est plus mis en cache
 * par defaut, et lire request.headers le rend de toute facon dynamique.
 */
export async function GET(request: Request) {
  if (!secretCronValide(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const bilan = await envoyerRappelsTaches();
  return NextResponse.json(bilan);
}
