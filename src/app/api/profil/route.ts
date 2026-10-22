import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";

// Chaque champ est optionnel (la page envoie le nom OU la preference), mais
// un corps sans aucun des deux n'a rien a enregistrer.
const profilSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom ne peut pas être vide").optional(),
    notificationsEmail: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.notificationsEmail !== undefined, {
    message: "Aucune modification fournie",
  });

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = profilSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  // On n'ecrit que les champs recus : sinon enregistrer la case effacerait le
  // nom (et inversement).
  const modifications: { name?: string; notificationsEmail?: boolean } = {};
  if (parsed.data.name !== undefined) modifications.name = parsed.data.name;
  if (parsed.data.notificationsEmail !== undefined) {
    modifications.notificationsEmail = parsed.data.notificationsEmail;
  }

  await connectDB();
  const user = await UserModel.findByIdAndUpdate(session.user.id, modifications, { new: true });

  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    name: user.name,
    // Absent (compte ancien) = active.
    notificationsEmail: user.notificationsEmail !== false,
  });
}
