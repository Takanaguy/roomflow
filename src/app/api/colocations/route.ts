import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import HouseholdModel from "@/models/Household";

const createSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(80),
  description: z.string().trim().max(500).optional(),
});

/** Colocations dont l'utilisateur connecte est membre. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  await connectDB();
  const households = await HouseholdModel.find({
    "members.userId": session.user.id,
  }).sort({ createdAt: -1 });

  return NextResponse.json(
    households.map((h) => ({
      id: h._id.toString(),
      name: h.name,
      description: h.description,
      memberCount: h.members.length,
    }))
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  await connectDB();
  const household = await HouseholdModel.create({
    name: parsed.data.name,
    description: parsed.data.description,
    createdBy: session.user.id,
    members: [{ userId: session.user.id, role: "admin" }],
    // inviteCode a une valeur par defaut dans le schema (voir Household.ts) ;
    // en cas de collision improbable, la contrainte unique de Mongo ferait
    // echouer create() plutot que de creer un code duplique.
  });

  return NextResponse.json(
    {
      id: household._id.toString(),
      name: household.name,
      inviteCode: household.inviteCode,
    },
    { status: 201 }
  );
}
