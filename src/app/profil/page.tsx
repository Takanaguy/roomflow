import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";
import ProfilClient from "./ProfilClient";

export default async function ProfilPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  await connectDB();
  const user = await UserModel.findById(session.user.id)
    .select("notificationsEmail")
    .lean<{ notificationsEmail?: boolean }>();

  // Absent (compte cree avant le champ) = active, comme partout ailleurs.
  return <ProfilClient notificationsEmail={user?.notificationsEmail !== false} />;
}
