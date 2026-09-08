import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  email: z.string().trim().toLowerCase().email("Email invalide"),
  password: z.string().min(8, "8 caractères minimum"),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  const { name, email, password } = parsed.data;

  await connectDB();

  const existing = await UserModel.findOne({ email });
  if (existing) {
    // Message volontairement generique : ne pas confirmer a un attaquant
    // qu'un email precis est deja enregistre.
    return NextResponse.json(
      { error: "Impossible de créer ce compte" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await UserModel.create({
    name,
    email,
    passwordHash,
    provider: "credentials",
  });

  return NextResponse.json(
    { id: user._id.toString(), name: user.name, email: user.email },
    { status: 201 }
  );
}
