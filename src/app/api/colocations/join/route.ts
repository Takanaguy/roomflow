import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import HouseholdModel, { type HouseholdMember } from "@/models/Household";

const joinSchema = z.object({
  inviteCode: z.string().trim().min(1, "Code requis"),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  await connectDB();
  const household = await HouseholdModel.findOne({
    inviteCode: parsed.data.inviteCode,
  });
  if (!household) {
    return NextResponse.json({ error: "Code invalide" }, { status: 404 });
  }

  const dejaMembre = household.members.some(
    (m: HouseholdMember) => m.userId.toString() === session.user.id
  );
  if (dejaMembre) {
    return NextResponse.json(
      { error: "Tu es déjà membre de cette colocation" },
      { status: 409 }
    );
  }

  household.members.push({ userId: session.user.id, role: "member", joinedAt: new Date() });
  await household.save();

  return NextResponse.json({ id: household._id.toString(), name: household.name });
}
