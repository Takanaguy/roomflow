import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";

// Route publique : elle ne dit que « oui » ou « non ». Le nom de la base, le
// cluster et les messages d'erreur donnaient des informations utiles a un
// attaquant. no-store pour qu'aucun cache ne renvoie un vieux « ok ».
const ENTETES = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await connectDB();
    return NextResponse.json({ ok: true }, { headers: ENTETES });
  } catch (err) {
    // Le nom de l'erreur seulement : son message peut contenir l'adresse du cluster.
    console.error("health: connexion MongoDB impossible", err instanceof Error ? err.name : "inconnue");
    return NextResponse.json({ ok: false }, { status: 503, headers: ENTETES });
  }
}
