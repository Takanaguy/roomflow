"use client";

import { useState, type ChangeEvent } from "react";

export default function NotificationsEmailForm({ initial }: { initial: boolean }) {
  const [active, setActive] = useState(initial);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Enregistrement immediat au clic (pas de bouton) : une case a cocher
  // s'attend a prendre effet tout de suite. La valeur affichee ne change
  // qu'une fois le serveur d'accord, pour ne jamais montrer un etat faux.
  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const valeur = e.target.checked;
    setMessage(null);
    setEnCours(true);

    // try/finally : si le reseau coupe, fetch leve une exception ; sans
    // finally la case resterait grisee (enCours bloque a true) pour toujours.
    try {
      const res = await fetch("/api/profil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationsEmail: valeur }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMessage(body?.error ?? "Impossible d'enregistrer.");
        return;
      }

      setActive(valeur);
      setMessage("Enregistré.");
    } catch {
      setMessage("Impossible d'enregistrer. Vérifie ta connexion et réessaie.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section className="mt-8 border-t border-zinc-200 pt-6">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={active}
          disabled={enCours}
          onChange={handleChange}
          className="mt-1"
        />
        <span>
          Recevoir les notifications par email
          <span className="mt-1 block text-zinc-600">
            Dépenses qui te concernent, arrivée dans une colocation et rappels de tâches. Les
            emails de sécurité (mot de passe oublié) sont toujours envoyés.
          </span>
        </span>
      </label>

      {message && (
        <p role="status" className="mt-2 text-sm text-zinc-600">
          {message}
        </p>
      )}
    </section>
  );
}
