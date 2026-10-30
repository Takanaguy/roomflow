import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";
import { COUT_BCRYPT, motDePasseSchema } from "@/lib/auth-schemas";
import { emailCompteDemo, estEmailDemo } from "@/lib/demo-email";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  email: z.string().trim().toLowerCase().email("Email invalide"),
  password: motDePasseSchema,
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

  // L'adresse du compte demo et celles des colocataires fictifs sont reservees,
  // meme si le compte n'existe pas encore (demo desactivee, avant la premiere
  // reinitialisation). Meme reponse qu'un email deja utilise.
  const existing =
    estEmailDemo(email, emailCompteDemo(process.env)) || (await UserModel.findOne({ email }));
  if (existing) {
    // Message volontairement generique : ne pas confirmer a un attaquant
    // qu'un email precis est deja enregistre.
    return NextResponse.json(
      { error: "Impossible de créer ce compte" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, COUT_BCRYPT);

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
