import Link from "next/link";
import { verifierJeton } from "@/lib/password-reset";
import ReinitialisationForm from "./ReinitialisationForm";

// Le jeton est dans l'URL : sans cette consigne, le navigateur enverrait
// l'adresse complete (jeton compris) en en-tete Referer a tout site externe
// vers lequel un lien ou une ressource de la page pointerait.
export const metadata = { referrer: "no-referrer" };

export default async function ReinitialiserMotDePassePage({
  searchParams,
}: PageProps<"/reinitialiser-mot-de-passe">) {
  const sp = await searchParams;
  // ?token=a&token=b donne un tableau : on le refuse plutot que de choisir.
  const jeton = typeof sp.token === "string" ? sp.token : "";
  const valide = jeton !== "" && (await verifierJeton(jeton));

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Nouveau mot de passe</h1>

      {valide ? (
        <ReinitialisationForm jeton={jeton} />
      ) : (
        <>
          <p className="mt-6 text-sm text-zinc-700">Ce lien est invalide ou a expiré.</p>
          <p className="mt-6 text-sm text-zinc-600">
            <Link href="/mot-de-passe-oublie" className="underline">
              Faire une nouvelle demande
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
