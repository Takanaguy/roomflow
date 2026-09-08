import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";

/**
 * Verifie que l'app arrive a se connecter a MongoDB. Utile en dev pour
 * diagnostiquer un probleme de chaine de connexion sans devoir passer par
 * une vraie fonctionnalite, et reste un point de sante standard une fois
 * l'app en production.
 */
export async function GET() {
  try {
    const conn = await connectDB();
    return NextResponse.json({
      ok: true,
      database: conn.connection.db?.databaseName,
      host: conn.connection.host,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
