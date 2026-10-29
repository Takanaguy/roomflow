import { auth } from "@/auth";
import { evaluerSuppressionCompte, type ProviderCompte } from "@/lib/account";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";
import ProfilClient from "./ProfilClient";
import SuppressionCompte from "./SuppressionCompte";

export default async function ProfilPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // proxy.ts protege deja cette route

  await connectDB();
  const [user, evaluation] = await Promise.all([
    UserModel.findById(session.user.id)
      .select("notificationsEmail provider")
      .lean<{ notificationsEmail?: boolean; provider?: ProviderCompte }>(),
    evaluerSuppressionCompte(session.user.id),
  ]);

  // Absent (compte cree avant le champ) = active, comme partout ailleurs.
  return (
    <ProfilClient notificationsEmail={user?.notificationsEmail !== false}>
      {/* provider inconnu : on demande le mot de passe, la route tranchera
          avec la valeur en base. */}
      <SuppressionCompte evaluation={evaluation} provider={user?.provider ?? "credentials"} />
    </ProfilClient>
  );
}
