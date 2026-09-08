import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";

const profilSchema = z.object({
  name: z.string().trim().min(1, "Le nom ne peut pas être vide"),
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

  await connectDB();
  const user = await UserModel.findByIdAndUpdate(
    session.user.id,
    { name: parsed.data.name },
    { new: true }
  );

  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  return NextResponse.json({ name: user.name });
}
