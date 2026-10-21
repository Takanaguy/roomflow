"use client";

import { useSyncExternalStore } from "react";
import { Pie, PieChart, ResponsiveContainer } from "recharts";
// TYPES seulement : importer une valeur de dashboard.ts embarquerait Mongoose
// dans le navigateur.
import type { TotalCategorie } from "@/lib/dashboard";

// Une couleur fixe par categorie (et non par position dans la liste) : "Loyer"
// garde sa couleur d'un mois a l'autre meme si la liste change d'ordre. Teintes
// en 600 de Tailwind : au moins 3:1 sur fond blanc, seuil WCAG pour un element
// graphique. Les categories inconnues retombent sur le gris de "autre".
const COULEURS: Record<string, string> = {
  courses: "#2563eb",
  factures: "#d97706",
  loyer: "#7c3aed",
  sorties: "#0d9488",
  autre: "#71717a",
};
const COULEUR_PAR_DEFAUT = COULEURS.autre;

// Pas d'abonnement a faire : "est-on dans le navigateur ?" ne change jamais
// apres le montage. Le snapshot serveur (false) sert au rendu serveur ET a
// l'hydratation, puis React bascule sur le snapshot client (true) sans erreur
// d'hydratation. C'est l'equivalent d'un `useEffect(() => setMonte(true))`,
// que la regle react-hooks/set-state-in-effect interdit.
const sAbonner = () => () => {};
const estClient = () => true;
const estServeur = () => false;

function formaterMontant(montant: number): string {
  return `${montant.toFixed(2)} €`;
}

export default function GraphiqueCategories({
  categories,
  total,
}: {
  categories: TotalCategorie[];
  total: number;
}) {
  const monte = useSyncExternalStore(sAbonner, estClient, estServeur);

  if (categories.length === 0) {
    return <p className="text-sm text-zinc-600">Aucune dépense ce mois-ci.</p>;
  }

  // `fill` dans la donnee : Recharts 3 le lit directement pour colorer la part
  // (le composant <Cell> est depuis deprecie).
  const donnees = categories.map((c) => ({
    ...c,
    fill: COULEURS[c.category] ?? COULEUR_PAR_DEFAUT,
  }));

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      {/* Decoratif : la legende ci-dessous porte toute l'information. */}
      <div aria-hidden="true" className="relative h-44 w-44 shrink-0">
        {/* ResponsiveContainer mesure son parent dans le navigateur, il n'a rien
            de sense a rendre cote serveur : on reserve la place (meme taille,
            donc pas de saut de mise en page) et le graphique arrive au montage. */}
        {monte && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donnees}
                dataKey="total"
                nameKey="label"
                innerRadius="65%"
                outerRadius="100%"
                stroke="#ffffff"
                strokeWidth={2}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-zinc-500">Total</span>
          <span className="font-mono text-sm font-semibold">{formaterMontant(total)}</span>
        </div>
      </div>

      <ul className="flex w-full flex-col gap-2">
        {donnees.map((c) => (
          <li key={c.category} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: c.fill }}
            />
            <span className="flex-1">{c.label}</span>
            <span className="font-mono">{formaterMontant(c.total)}</span>
            <span className="w-12 text-right text-zinc-500">{c.pourcentage === 0 && c.total > 0 ? "< 1" : c.pourcentage} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
