import { describe, expect, it } from "vitest";
import {
  parserMois,
  selectionnerTachesEnCours,
  totauxParCategorie,
} from "@/lib/dashboard";

// Dates ecrites en ISO avec "Z" : le test ne depend ainsi jamais du fuseau de
// la machine qui le lance (poste de dev en France, CI en UTC...).
const d = (iso: string) => new Date(iso);

// "Maintenant" fige pour tous les tests de parserMois : on ne lit jamais
// l'horloge reelle, sinon un test passerait ou casserait selon le jour.
const MAINTENANT = d("2026-10-21T12:00:00.000Z");

// ---------------------------------------------------------------------------
// parserMois
// ---------------------------------------------------------------------------

describe("parserMois : parametre valide", () => {
  it("2026-09 : ce mois, bornes exactes en UTC", () => {
    const m = parserMois("2026-09", MAINTENANT);
    expect(m.cle).toBe("2026-09");
    expect(m.annee).toBe(2026);
    expect(m.mois).toBe(9);
    expect(m.debut.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(m.fin.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(m.precedent).toBe("2026-08");
    expect(m.suivant).toBe("2026-10");
    expect(m.estMoisCourant).toBe(false);
  });

  it("fevrier non bissextile : fin = 1er mars", () => {
    const m = parserMois("2026-02", MAINTENANT);
    expect(m.debut.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(m.fin.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("fevrier bissextile 2028 : fin = 1er mars 2028 (29 jours)", () => {
    const m = parserMois("2028-02", MAINTENANT);
    expect(m.fin.toISOString()).toBe("2028-03-01T00:00:00.000Z");
    expect((m.fin.getTime() - m.debut.getTime()) / 86_400_000).toBe(29);
  });

  // 2100 n'est PAS bissextile (divisible par 100 mais pas par 400).
  it("fevrier 2100 : 28 jours (siecle non bissextile)", () => {
    const m = parserMois("2100-02", MAINTENANT);
    expect((m.fin.getTime() - m.debut.getTime()) / 86_400_000).toBe(28);
  });

  it("decembre : fin = 1er janvier de l'annee suivante, suivant = janvier", () => {
    const m = parserMois("2025-12", MAINTENANT);
    expect(m.debut.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(m.fin.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(m.precedent).toBe("2025-11");
    expect(m.suivant).toBe("2026-01");
  });

  it("janvier : precedent = decembre de l'annee d'avant", () => {
    const m = parserMois("2026-01", MAINTENANT);
    expect(m.precedent).toBe("2025-12");
    expect(m.suivant).toBe("2026-02");
    expect(m.debut.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("bornes de plage acceptees : 2000-01 et 2100-12", () => {
    expect(parserMois("2000-01", MAINTENANT).cle).toBe("2000-01");
    expect(parserMois("2100-12", MAINTENANT).cle).toBe("2100-12");
  });
});

describe("parserMois : parametre invalide, retour au mois courant", () => {
  // Un lien mal copie ne doit jamais faire planter la page : on retombe sur le
  // mois courant, quelle que soit la forme du defaut.
  const invalides: [string, string | undefined][] = [
    ["undefined", undefined],
    ["chaine vide", ""],
    ["texte", "abc"],
    ["mois 13", "2026-13"],
    ["mois 00", "2026-00"],
    ["mois sur un chiffre", "2026-1"],
    ["annee sur deux chiffres", "26-09"],
    ["espace devant", " 2026-05"],
    ["espace derriere", "2026-05 "],
    ["saut de ligne derriere", "2026-05\n"],
    ["jour en trop", "2026-5-1"],
    ["jour complet", "2026-05-01"],
    ["separateur different", "2026/05"],
    ["annee avant 2000", "1999-12"],
    ["annee apres 2100", "2101-01"],
    ["annee 0000", "0000-05"],
    ["mois negatif", "2026--5"],
  ];

  it.each(invalides)("%s -> mois courant", (_nom, param) => {
    const m = parserMois(param, MAINTENANT);
    expect(m.cle).toBe("2026-10");
    expect(m.annee).toBe(2026);
    expect(m.mois).toBe(10);
    expect(m.estMoisCourant).toBe(true);
    expect(m.debut.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(m.fin.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("parserMois : mois courant lu en UTC", () => {
  // Le 31 octobre a 23h30 UTC, il est deja le 1er novembre a Paris, mais le
  // dashboard raisonne en UTC comme les dates de depenses : c'est octobre.
  it("31 octobre 23:30 UTC : octobre, pas novembre", () => {
    const m = parserMois(undefined, d("2026-10-31T23:30:00.000Z"));
    expect(m.cle).toBe("2026-10");
    expect(m.estMoisCourant).toBe(true);
  });

  it("basculement a la milliseconde pres", () => {
    expect(parserMois(undefined, d("2026-10-31T23:59:59.999Z")).cle).toBe("2026-10");
    expect(parserMois(undefined, d("2026-11-01T00:00:00.000Z")).cle).toBe("2026-11");
  });

  it("basculement d'annee a la milliseconde pres", () => {
    expect(parserMois(undefined, d("2026-12-31T23:59:59.999Z")).cle).toBe("2026-12");
    const m = parserMois(undefined, d("2027-01-01T00:00:00.000Z"));
    expect(m.cle).toBe("2027-01");
    expect(m.precedent).toBe("2026-12");
  });

  it("un param valide ne depend pas de l'heure de maintenant", () => {
    expect(parserMois("2026-03", d("2026-10-31T23:59:59.999Z")).cle).toBe("2026-03");
  });

  it("le mois courant en janvier a precedent = decembre", () => {
    const m = parserMois(undefined, d("2026-01-15T08:00:00.000Z"));
    expect(m.cle).toBe("2026-01");
    expect(m.precedent).toBe("2025-12");
  });
});

describe("parserMois : navigation vers le futur", () => {
  it("mois courant : suivant null et estMoisCourant vrai", () => {
    const m = parserMois("2026-10", MAINTENANT);
    expect(m.estMoisCourant).toBe(true);
    expect(m.suivant).toBeNull();
    expect(m.precedent).toBe("2026-09");
  });

  it("mois passe : suivant = le mois d'apres, estMoisCourant faux", () => {
    const m = parserMois("2026-08", MAINTENANT);
    expect(m.suivant).toBe("2026-09");
    expect(m.estMoisCourant).toBe(false);
  });

  it("le mois juste avant le courant a bien un suivant (= le courant)", () => {
    expect(parserMois("2026-09", MAINTENANT).suivant).toBe("2026-10");
  });

  // Un mois futur bien forme est accepte tel quel (page vide), mais on ne
  // propose pas de lien pour y aller.
  it("mois futur bien forme : accepte, suivant null, pas courant", () => {
    const m = parserMois("2027-01", MAINTENANT);
    expect(m.cle).toBe("2027-01");
    expect(m.estMoisCourant).toBe(false);
    expect(m.suivant).toBeNull();
    expect(m.precedent).toBe("2026-12");
    expect(m.debut.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("le mois d'apres le courant est deja du futur", () => {
    expect(parserMois("2026-11", MAINTENANT).suivant).toBeNull();
  });

  it("estMoisCourant n'est vrai que pour le mois courant", () => {
    const vrais = Array.from({ length: 12 }, (_, i) =>
      parserMois(`2026-${String(i + 1).padStart(2, "0")}`, MAINTENANT)
    ).filter((m) => m.estMoisCourant);
    expect(vrais.map((m) => m.cle)).toEqual(["2026-10"]);
  });
});

describe("parserMois : bornes de la plage 2000..2100", () => {
  it("2000-01 : precedent null (l'annee 1999 sortirait de la plage)", () => {
    const m = parserMois("2000-01", MAINTENANT);
    expect(m.precedent).toBeNull();
    expect(m.suivant).toBe("2000-02");
  });

  it("2000-02 et 2001-01 ont un precedent", () => {
    expect(parserMois("2000-02", MAINTENANT).precedent).toBe("2000-01");
    expect(parserMois("2001-01", MAINTENANT).precedent).toBe("2000-12");
  });

  it("2100-12 : suivant null", () => {
    expect(parserMois("2100-12", MAINTENANT).suivant).toBeNull();
  });

  // Avec un maintenant en 2026, 2100-12 est deja "futur" : le test ci-dessus
  // ne prouverait pas la borne ANNEE_MAX. On avance donc l'horloge apres 2100
  // pour que seul le plafond de la plage puisse produire le null.
  it("2100-12 avec une horloge apres 2100 : suivant null a cause du plafond", () => {
    const m = parserMois("2100-12", d("2101-03-01T00:00:00.000Z"));
    expect(m.estMoisCourant).toBe(false);
    expect(m.suivant).toBeNull();
  });

  it("2100-11 avec une horloge apres 2100 : suivant = 2100-12", () => {
    expect(parserMois("2100-11", d("2101-03-01T00:00:00.000Z")).suivant).toBe("2100-12");
  });
});

describe("parserMois : continuite et longueur des mois", () => {
  // Table ecrite a la main, independante du code teste (qui s'appuie sur
  // Date.UTC) : janvier a decembre.
  const joursAttendus = (annee: number, mois: number) => {
    const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
    const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return jours[mois - 1];
  };

  // Horloge loin dans le futur : tous les mois de la suite sont "passes", donc
  // aucun cas particulier lie au mois courant ne vient fausser la boucle.
  const loin = d("2030-01-01T00:00:00.000Z");
  // 24 mois consecutifs de 2027-06 a 2029-05, qui contiennent fevrier 2028.
  const suite = Array.from({ length: 24 }, (_, i) => {
    const index = 2027 * 12 + 5 + i;
    return { annee: Math.floor(index / 12), mois: (index % 12) + 1 };
  }).map(({ annee, mois }) =>
    parserMois(`${annee}-${String(mois).padStart(2, "0")}`, loin)
  );

  it("la suite compte bien 24 mois, de 2027-06 a 2029-05", () => {
    expect(suite).toHaveLength(24);
    expect(suite[0].cle).toBe("2027-06");
    expect(suite[23].cle).toBe("2029-05");
  });

  it("le debut du mois M+1 est exactement la fin du mois M", () => {
    for (let i = 0; i < suite.length - 1; i++) {
      expect(suite[i + 1].debut.getTime()).toBe(suite[i].fin.getTime());
    }
  });

  it("fin - debut vaut 28, 29, 30 ou 31 jours selon le mois", () => {
    for (const m of suite) {
      const jours = (m.fin.getTime() - m.debut.getTime()) / 86_400_000;
      expect(jours, m.cle).toBe(joursAttendus(m.annee, m.mois));
    }
  });

  it("precedent et suivant s'enchainent sur toute la suite", () => {
    for (let i = 1; i < suite.length - 1; i++) {
      expect(suite[i].precedent).toBe(suite[i - 1].cle);
      expect(suite[i].suivant).toBe(suite[i + 1].cle);
    }
  });

  it("debut et fin tombent toujours a minuit UTC pile, le 1er du mois", () => {
    for (const m of suite) {
      for (const borne of [m.debut, m.fin]) {
        expect(borne.getUTCDate()).toBe(1);
        expect(borne.getUTCHours()).toBe(0);
        expect(borne.getUTCMinutes()).toBe(0);
        expect(borne.getUTCSeconds()).toBe(0);
        expect(borne.getUTCMilliseconds()).toBe(0);
      }
    }
  });
});

describe("parserMois : pas d'etat partage", () => {
  it("modifier une Date retournee n'affecte pas un 2e appel", () => {
    const a = parserMois("2026-09", MAINTENANT);
    a.debut.setUTCFullYear(1990);
    a.fin.setUTCFullYear(1990);
    const b = parserMois("2026-09", MAINTENANT);
    expect(b.debut.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(b.fin.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("debut et fin sont deux objets distincts", () => {
    const m = parserMois("2026-09", MAINTENANT);
    expect(m.debut).not.toBe(m.fin);
  });

  it("ne modifie pas la Date `maintenant` recue", () => {
    const maintenant = d("2026-10-21T12:00:00.000Z");
    parserMois(undefined, maintenant);
    parserMois("2026-03", maintenant);
    expect(maintenant.toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// totauxParCategorie
// ---------------------------------------------------------------------------

type Depense = { category: string; amount: number };

describe("totauxParCategorie : cas simples", () => {
  // Liste vide (aucune depense ce mois-ci) : pas de division par zero, donc
  // pas de NaN dans les pourcentages.
  it("liste vide : aucune categorie et total 0, sans NaN", () => {
    const r = totauxParCategorie([]);
    expect(r).toEqual({ categories: [], total: 0 });
    expect(Number.isNaN(r.total)).toBe(false);
  });

  it("une seule categorie : 100 %", () => {
    const r = totauxParCategorie([{ category: "courses", amount: 42.5 }]);
    expect(r.categories).toEqual([
      { category: "courses", label: "Courses", total: 42.5, pourcentage: 100 },
    ]);
    expect(r.total).toBe(42.5);
  });

  it("deux depenses de la meme categorie sont additionnees", () => {
    const r = totauxParCategorie([
      { category: "loyer", amount: 400 },
      { category: "loyer", amount: 100.5 },
    ]);
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0].total).toBe(500.5);
  });

  it("les cinq categories ont le bon libelle", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 5 },
      { category: "factures", amount: 4 },
      { category: "loyer", amount: 3 },
      { category: "sorties", amount: 2 },
      { category: "autre", amount: 1 },
    ]);
    expect(r.categories.map((c) => [c.category, c.label])).toEqual([
      ["courses", "Courses"],
      ["factures", "Factures"],
      ["loyer", "Loyer"],
      ["sorties", "Sorties"],
      ["autre", "Autre"],
    ]);
  });

  // Une categorie ajoutee plus tard en base (ou une donnee corrompue) ne doit
  // ni disparaitre du total, ni planter : elle tombe dans "autre".
  it("categorie inconnue : comptee dans autre", () => {
    const r = totauxParCategorie([
      { category: "vacances", amount: 30 },
      { category: "autre", amount: 20 },
    ]);
    expect(r.categories).toEqual([
      { category: "autre", label: "Autre", total: 50, pourcentage: 100 },
    ]);
    expect(r.total).toBe(50);
  });

  it("categorie vide : comptee dans autre", () => {
    const r = totauxParCategorie([{ category: "", amount: 12 }]);
    expect(r.categories).toEqual([
      { category: "autre", label: "Autre", total: 12, pourcentage: 100 },
    ]);
  });

  it("la casse compte : COURSES n'est pas courses, donc va dans autre", () => {
    const r = totauxParCategorie([{ category: "COURSES", amount: 10 }]);
    expect(r.categories[0].category).toBe("autre");
  });

  it("une categorie nommee comme une propriete d'objet va dans autre", () => {
    const r = totauxParCategorie([
      { category: "constructor", amount: 5 },
      { category: "__proto__", amount: 5 },
      { category: "toString", amount: 5 },
    ]);
    expect(r.categories).toEqual([
      { category: "autre", label: "Autre", total: 15, pourcentage: 100 },
    ]);
  });

  it("une depense de 0 euro ne cree pas de categorie", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 0 },
      { category: "loyer", amount: 10 },
    ]);
    expect(r.categories.map((c) => c.category)).toEqual(["loyer"]);
  });

  it("que des depenses a 0 : meme resultat que la liste vide", () => {
    expect(totauxParCategorie([{ category: "courses", amount: 0 }])).toEqual({
      categories: [],
      total: 0,
    });
  });

  // Montant corrompu (NaN) : on l'ignore plutot que de contaminer le total.
  it("un montant NaN est ignore et ne contamine pas le total", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: Number.NaN },
      { category: "courses", amount: 10 },
    ]);
    expect(r.total).toBe(10);
    expect(r.categories[0].total).toBe(10);
    expect(Number.isNaN(r.categories[0].pourcentage)).toBe(false);
  });
});

describe("totauxParCategorie : sommes exactes en centimes", () => {
  it("0.1 + 0.2 donne exactement 0.3", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 0.1 },
      { category: "courses", amount: 0.2 },
    ]);
    expect(r.categories[0].total).toBe(0.3);
    expect(r.total).toBe(0.3);
  });

  it("0.1 + 0.2 reparti sur deux categories : total exactement 0.3", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 0.1 },
      { category: "loyer", amount: 0.2 },
    ]);
    expect(r.total).toBe(0.3);
  });

  it("7 fois 10.01 donne exactement 70.07", () => {
    const depenses: Depense[] = Array.from({ length: 7 }, () => ({
      category: "factures",
      amount: 10.01,
    }));
    const r = totauxParCategorie(depenses);
    expect(r.categories[0].total).toBe(70.07);
    expect(r.total).toBe(70.07);
  });

  it("100 fois 0.1 donne exactement 10", () => {
    const depenses: Depense[] = Array.from({ length: 100 }, () => ({
      category: "sorties",
      amount: 0.1,
    }));
    expect(totauxParCategorie(depenses).total).toBe(10);
  });

  it("le total general est la somme exacte des totaux de categories", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 33.33 },
      { category: "loyer", amount: 66.67 },
      { category: "sorties", amount: 0.01 },
    ]);
    expect(r.total).toBe(100.01);
  });
});

describe("totauxParCategorie : tri", () => {
  it("tri decroissant par total", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 10 },
      { category: "sorties", amount: 30 },
      { category: "loyer", amount: 20 },
    ]);
    expect(r.categories.map((c) => c.category)).toEqual(["sorties", "loyer", "courses"]);
  });

  // L'ordre fixe evite qu'un camembert change de couleurs d'un rafraichissement
  // a l'autre quand deux parts sont a egalite.
  it("egalite de total : ordre fixe courses, factures, loyer, sorties, autre", () => {
    const r = totauxParCategorie([
      { category: "autre", amount: 10 },
      { category: "sorties", amount: 10 },
      { category: "loyer", amount: 10 },
      { category: "factures", amount: 10 },
      { category: "courses", amount: 10 },
    ]);
    expect(r.categories.map((c) => c.category)).toEqual([
      "courses",
      "factures",
      "loyer",
      "sorties",
      "autre",
    ]);
  });

  it("egalite entre deux categories seulement : factures avant sorties", () => {
    const r = totauxParCategorie([
      { category: "sorties", amount: 7 },
      { category: "factures", amount: 7 },
      { category: "courses", amount: 100 },
    ]);
    expect(r.categories.map((c) => c.category)).toEqual(["courses", "factures", "sorties"]);
  });

  it("l'ordre des depenses en entree ne change pas le resultat", () => {
    const depenses: Depense[] = [
      { category: "loyer", amount: 400 },
      { category: "courses", amount: 82.4 },
      { category: "sorties", amount: 35 },
      { category: "courses", amount: 17.6 },
      { category: "factures", amount: 60 },
    ];
    const renverse = [...depenses].reverse();
    expect(totauxParCategorie(renverse)).toEqual(totauxParCategorie(depenses));
  });

  it("une categorie inconnue ajoutee a autre peut remonter dans le tri", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 10 },
      { category: "autre", amount: 6 },
      { category: "truc", amount: 6 },
    ]);
    expect(r.categories.map((c) => [c.category, c.total])).toEqual([
      ["autre", 12],
      ["courses", 10],
    ]);
  });
});

describe("totauxParCategorie : pourcentages entiers dont la somme fait 100", () => {
  const somme = (r: ReturnType<typeof totauxParCategorie>) =>
    r.categories.reduce((s, c) => s + c.pourcentage, 0);

  // 1/3 chacun : base 33 pour tous, les trois restes sont identiques, donc le
  // point manquant va a la premiere categorie dans l'ordre fixe (ici factures).
  it("trois categories egales : 34 + 33 + 33, le bonus va a la premiere dans l'ordre fixe", () => {
    const r = totauxParCategorie([
      { category: "autre", amount: 10 },
      { category: "sorties", amount: 10 },
      { category: "factures", amount: 10 },
    ]);
    expect(r.categories.map((c) => [c.category, c.pourcentage])).toEqual([
      ["factures", 34],
      ["sorties", 33],
      ["autre", 33],
    ]);
    expect(somme(r)).toBe(100);
  });

  it("trois categories egales avec courses : courses prend le point en plus", () => {
    const r = totauxParCategorie([
      { category: "loyer", amount: 5 },
      { category: "courses", amount: 5 },
      { category: "autre", amount: 5 },
    ]);
    expect(r.categories.map((c) => c.pourcentage)).toEqual([34, 33, 33]);
    expect(r.categories[0].category).toBe("courses");
  });

  it("deux categories 1/3 et 2/3 : 33 + 67", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 1 },
      { category: "loyer", amount: 2 },
    ]);
    expect(r.categories.map((c) => [c.category, c.pourcentage])).toEqual([
      ["loyer", 67],
      ["courses", 33],
    ]);
  });

  it("deux categories egales : 50 + 50", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 8 },
      { category: "loyer", amount: 8 },
    ]);
    expect(r.categories.map((c) => c.pourcentage)).toEqual([50, 50]);
  });

  // 0.01 vs 99.99 : la petite part vaut 0,01 %, donc 0 en entier, et la
  // grosse prend le point restant pour arriver a 100. Une categorie presente
  // peut donc afficher 0 %.
  it("0.01 contre 99.99 : 100 et 0", () => {
    const r = totauxParCategorie([
      { category: "sorties", amount: 0.01 },
      { category: "loyer", amount: 99.99 },
    ]);
    expect(r.categories.map((c) => [c.category, c.total, c.pourcentage])).toEqual([
      ["loyer", 99.99, 100],
      ["sorties", 0.01, 0],
    ]);
    expect(somme(r)).toBe(100);
  });

  it("cinq categories egales : 20 chacune", () => {
    const r = totauxParCategorie(
      ["courses", "factures", "loyer", "sorties", "autre"].map((category) => ({
        category,
        amount: 12.34,
      }))
    );
    expect(r.categories.map((c) => c.pourcentage)).toEqual([20, 20, 20, 20, 20]);
  });

  it("sept categories en tout (avec doublons) : la somme reste 100", () => {
    const r = totauxParCategorie([
      { category: "courses", amount: 13.37 },
      { category: "factures", amount: 42.42 },
      { category: "loyer", amount: 399.99 },
      { category: "sorties", amount: 21.5 },
      { category: "autre", amount: 3.33 },
      { category: "courses", amount: 8.88 },
      { category: "inconnue", amount: 1.11 },
    ]);
    expect(somme(r)).toBe(100);
    expect(r.categories.every((c) => Number.isInteger(c.pourcentage))).toBe(true);
  });
});

describe("totauxParCategorie : proprietes sur jeux pseudo-aleatoires", () => {
  // Generateur a graine fixe (mulberry32) : un echec est reproductible, ce que
  // Math.random() ne permettrait pas.
  function generateur(graine: number) {
    let etat = graine >>> 0;
    return () => {
      etat = (etat + 0x6d2b79f5) >>> 0;
      let t = etat;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NOMS = ["courses", "factures", "loyer", "sorties", "autre"];
  const ORDRE = new Map(NOMS.map((n, i) => [n, i]));

  // 1 a 5 categories distinctes, chacune avec 1 a 4 depenses en centimes
  // aleatoires (de 1 centime a 5000 euros), parfois une categorie inconnue.
  function jeu(rnd: () => number): { depenses: Depense[]; centimesAttendus: number } {
    const nbCategories = 1 + Math.floor(rnd() * 5);
    const choisies = [...NOMS].sort(() => rnd() - 0.5).slice(0, nbCategories);
    const depenses: Depense[] = [];
    let centimesAttendus = 0;
    for (const category of choisies) {
      const nbDepenses = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < nbDepenses; i++) {
        const centimes = 1 + Math.floor(rnd() * 500_000);
        centimesAttendus += centimes;
        depenses.push({ category, amount: centimes / 100 });
      }
    }
    return { depenses, centimesAttendus };
  }

  const rnd = generateur(20261021);
  const jeux = Array.from({ length: 200 }, () => jeu(rnd));

  it("200 jeux : somme des pourcentages === 100", () => {
    for (const { depenses } of jeux) {
      const r = totauxParCategorie(depenses);
      expect(r.categories.reduce((s, c) => s + c.pourcentage, 0)).toBe(100);
    }
  });

  it("200 jeux : chaque pourcentage est un entier >= 0 et <= 100", () => {
    for (const { depenses } of jeux) {
      for (const c of totauxParCategorie(depenses).categories) {
        expect(Number.isInteger(c.pourcentage)).toBe(true);
        expect(c.pourcentage).toBeGreaterThanOrEqual(0);
        expect(c.pourcentage).toBeLessThanOrEqual(100);
      }
    }
  });

  it("200 jeux : le total general vaut la somme des centimes d'entree", () => {
    for (const { depenses, centimesAttendus } of jeux) {
      const r = totauxParCategorie(depenses);
      expect(Math.round(r.total * 100)).toBe(centimesAttendus);
      const centimesCategories = r.categories.reduce((s, c) => s + Math.round(c.total * 100), 0);
      expect(centimesCategories).toBe(centimesAttendus);
    }
  });

  it("200 jeux : tri decroissant, egalites departagees par l'ordre fixe", () => {
    for (const { depenses } of jeux) {
      const { categories } = totauxParCategorie(depenses);
      for (let i = 1; i < categories.length; i++) {
        const avant = categories[i - 1];
        const apres = categories[i];
        expect(avant.total).toBeGreaterThanOrEqual(apres.total);
        if (avant.total === apres.total) {
          expect(ORDRE.get(avant.category)!).toBeLessThan(ORDRE.get(apres.category)!);
        }
      }
    }
  });

  it("200 jeux : chaque categorie apparait une seule fois", () => {
    for (const { depenses } of jeux) {
      const noms = totauxParCategorie(depenses).categories.map((c) => c.category);
      expect(new Set(noms).size).toBe(noms.length);
    }
  });

  // Methode du plus fort reste : l'arrondi s'ecarte de la vraie part de moins
  // d'un point, jamais plus.
  it("200 jeux : chaque pourcentage est a moins d'un point de la vraie part", () => {
    for (const { depenses, centimesAttendus } of jeux) {
      for (const c of totauxParCategorie(depenses).categories) {
        const exact = (Math.round(c.total * 100) * 100) / centimesAttendus;
        expect(Math.abs(c.pourcentage - exact)).toBeLessThan(1);
      }
    }
  });

  it("200 jeux : une part plus grosse n'a jamais un pourcentage plus petit", () => {
    for (const { depenses } of jeux) {
      const { categories } = totauxParCategorie(depenses);
      for (let i = 1; i < categories.length; i++) {
        expect(categories[i - 1].pourcentage).toBeGreaterThanOrEqual(categories[i].pourcentage);
      }
    }
  });

  it("200 jeux : l'entree n'est jamais modifiee", () => {
    for (const { depenses } of jeux) {
      const copie = structuredClone(depenses);
      totauxParCategorie(depenses);
      expect(depenses).toEqual(copie);
    }
  });

  it("une entree gelee (Object.freeze) ne fait pas planter la fonction", () => {
    const gelee = Object.freeze([
      Object.freeze({ category: "courses", amount: 3 }),
      Object.freeze({ category: "loyer", amount: 6 }),
    ]) as unknown as Depense[];
    expect(() => totauxParCategorie(gelee)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// selectionnerTachesEnCours
// ---------------------------------------------------------------------------

type TacheTest = {
  _id: { toString(): string };
  dueDate?: Date | null;
  createdAt?: Date | null;
};

// Objet minimal : la fonction ne lit que _id, dueDate et createdAt, donc pas
// besoin de document Mongoose.
function tache(id: string, dueDate?: string | null, createdAt?: string | null): TacheTest {
  return {
    _id: { toString: () => id },
    ...(dueDate !== undefined && { dueDate: dueDate === null ? null : d(dueDate) }),
    ...(createdAt !== undefined && { createdAt: createdAt === null ? null : d(createdAt) }),
  };
}

const ids = (liste: TacheTest[]) => liste.map((t) => t._id.toString());

// Jour courant : le 21 octobre 2026, en milieu d'apres-midi UTC.
const AUJOURDHUI = d("2026-10-21T15:00:00.000Z");

describe("selectionnerTachesEnCours : cas vides et limites", () => {
  it("liste vide : rien a afficher, deux compteurs a 0", () => {
    expect(selectionnerTachesEnCours([], AUJOURDHUI)).toEqual({
      aAfficher: [],
      nbTachesEnCours: 0,
      nbTachesEnRetard: 0,
    });
  });

  it("limite par defaut : 5 taches affichees, total non limite", () => {
    const taches = Array.from({ length: 8 }, (_, i) =>
      tache(`t${i}`, `2026-11-0${i + 1}T00:00:00.000Z`)
    );
    const r = selectionnerTachesEnCours(taches, AUJOURDHUI);
    expect(r.aAfficher).toHaveLength(5);
    expect(ids(r.aAfficher)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(r.nbTachesEnCours).toBe(8);
  });

  it("limite personnalisee", () => {
    const taches = Array.from({ length: 6 }, (_, i) =>
      tache(`t${i}`, `2026-11-0${i + 1}T00:00:00.000Z`)
    );
    const r = selectionnerTachesEnCours(taches, AUJOURDHUI, 2);
    expect(ids(r.aAfficher)).toEqual(["t0", "t1"]);
    expect(r.nbTachesEnCours).toBe(6);
  });

  it("limite superieure au nombre de taches : toutes affichees", () => {
    const taches = [tache("a", "2026-11-02T00:00:00.000Z"), tache("b")];
    const r = selectionnerTachesEnCours(taches, AUJOURDHUI, 10);
    expect(ids(r.aAfficher)).toEqual(["a", "b"]);
    expect(r.nbTachesEnCours).toBe(2);
  });

  it("limite 0 : rien a afficher mais les compteurs restent justes", () => {
    const taches = [tache("a", "2026-10-01T00:00:00.000Z"), tache("b")];
    const r = selectionnerTachesEnCours(taches, AUJOURDHUI, 0);
    expect(r.aAfficher).toEqual([]);
    expect(r.nbTachesEnCours).toBe(2);
    expect(r.nbTachesEnRetard).toBe(1);
  });

  it("exactement 5 taches : les 5 sont affichees", () => {
    const taches = ["a", "b", "c", "d", "e"].map((id) => tache(id));
    expect(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher).toHaveLength(5);
  });

  it("renvoie les memes objets que ceux recus (pas de copie)", () => {
    const a = tache("a", "2026-11-01T00:00:00.000Z");
    const r = selectionnerTachesEnCours([a], AUJOURDHUI);
    expect(r.aAfficher[0]).toBe(a);
  });
});

describe("selectionnerTachesEnCours : tri", () => {
  it("echeance croissante", () => {
    const taches = [
      tache("tard", "2026-12-01T00:00:00.000Z"),
      tache("tot", "2026-10-25T00:00:00.000Z"),
      tache("milieu", "2026-11-10T00:00:00.000Z"),
    ];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual([
      "tot",
      "milieu",
      "tard",
    ]);
  });

  // Mongo mettrait les valeurs absentes en premier en tri croissant : c'est
  // pour cela que le tri se fait ici. Une tache sans echeance ne doit jamais
  // passer devant une tache datee.
  it("les taches sans echeance (undefined ou null) passent en dernier", () => {
    const taches = [
      tache("sans-undefined"),
      tache("datee-tard", "2027-06-01T00:00:00.000Z"),
      tache("sans-null", null),
      tache("datee-tot", "2026-10-22T00:00:00.000Z"),
    ];
    const resultat = ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher);
    expect(resultat.slice(0, 2)).toEqual(["datee-tot", "datee-tard"]);
    expect(resultat.slice(2).sort()).toEqual(["sans-null", "sans-undefined"]);
  });

  it("une tache en retard passe avant une tache a venir", () => {
    const taches = [
      tache("avenir", "2026-11-01T00:00:00.000Z"),
      tache("retard", "2026-09-01T00:00:00.000Z"),
    ];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual([
      "retard",
      "avenir",
    ]);
  });

  it("meme echeance : createdAt croissant en departage", () => {
    const echeance = "2026-11-01T00:00:00.000Z";
    const taches = [
      tache("recente", echeance, "2026-10-10T00:00:00.000Z"),
      tache("ancienne", echeance, "2026-10-01T00:00:00.000Z"),
      tache("moyenne", echeance, "2026-10-05T00:00:00.000Z"),
    ];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual([
      "ancienne",
      "moyenne",
      "recente",
    ]);
  });

  it("sans echeance : createdAt croissant en departage aussi", () => {
    const taches = [
      tache("recente", undefined, "2026-10-10T00:00:00.000Z"),
      tache("ancienne", null, "2026-10-01T00:00:00.000Z"),
    ];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual([
      "ancienne",
      "recente",
    ]);
  });

  it("l'echeance prime sur createdAt", () => {
    const taches = [
      tache("creee-tot-due-tard", "2026-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      tache("creee-tard-due-tot", "2026-11-01T00:00:00.000Z", "2026-10-20T00:00:00.000Z"),
    ];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual([
      "creee-tard-due-tot",
      "creee-tot-due-tard",
    ]);
  });

  it("meme echeance et meme createdAt : _id pour la stabilite", () => {
    const echeance = "2026-11-01T00:00:00.000Z";
    const creation = "2026-10-01T00:00:00.000Z";
    const taches = [
      tache("c", echeance, creation),
      tache("a", echeance, creation),
      tache("b", echeance, creation),
    ];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual(["a", "b", "c"]);
  });

  it("taches sans echeance ni createdAt : departagees par _id sans planter", () => {
    const taches = [tache("z"), tache("m", null, null), tache("a")];
    expect(ids(selectionnerTachesEnCours(taches, AUJOURDHUI).aAfficher)).toEqual(["a", "m", "z"]);
  });

  // L'ordre d'arrivee des taches depuis Mongo n'est pas garanti : le resultat
  // doit etre le meme quelle que soit la permutation de l'entree.
  it("resultat identique quel que soit l'ordre de l'entree", () => {
    const base = [
      tache("a", "2026-11-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      tache("b", "2026-11-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      tache("c", "2026-11-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
      tache("d", "2026-10-30T00:00:00.000Z"),
      tache("e"),
      tache("f", null, "2026-10-03T00:00:00.000Z"),
    ];
    const attendu = ids(selectionnerTachesEnCours(base, AUJOURDHUI, 10).aAfficher);
    expect(attendu).toEqual(["d", "a", "b", "c", "e", "f"]);

    const permutations = [
      [...base].reverse(),
      [base[3], base[5], base[0], base[4], base[2], base[1]],
      [base[1], base[0], base[4], base[2], base[5], base[3]],
    ];
    for (const p of permutations) {
      expect(ids(selectionnerTachesEnCours(p, AUJOURDHUI, 10).aAfficher)).toEqual(attendu);
    }
  });

  it("la limite coupe APRES le tri : les sans-echeance ne volent pas une place", () => {
    const taches = [
      tache("sans1"),
      tache("sans2"),
      tache("d1", "2026-12-01T00:00:00.000Z"),
      tache("d2", "2026-12-02T00:00:00.000Z"),
    ];
    const r = selectionnerTachesEnCours(taches, AUJOURDHUI, 2);
    expect(ids(r.aAfficher)).toEqual(["d1", "d2"]);
  });
});

describe("selectionnerTachesEnCours : taches en retard", () => {
  // Meme regle que le Kanban : retard = strictement avant le DEBUT du jour UTC.
  // Une tache due aujourd'hui a minuit UTC n'est pas en retard.
  it("echeance a minuit UTC du jour meme : pas en retard", () => {
    const r = selectionnerTachesEnCours([tache("a", "2026-10-21T00:00:00.000Z")], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(0);
  });

  it("la veille a 23:00 UTC : en retard", () => {
    const r = selectionnerTachesEnCours([tache("a", "2026-10-20T23:00:00.000Z")], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(1);
  });

  it("la veille a 23:59:59.999 : en retard (a la milliseconde pres)", () => {
    const r = selectionnerTachesEnCours([tache("a", "2026-10-20T23:59:59.999Z")], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(1);
  });

  it("echeance plus tard dans la journee : pas en retard", () => {
    const r = selectionnerTachesEnCours([tache("a", "2026-10-21T23:59:59.999Z")], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(0);
  });

  it("echeance demain : pas en retard", () => {
    const r = selectionnerTachesEnCours([tache("a", "2026-10-22T00:00:00.000Z")], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(0);
  });

  it("echeance dans le passe lointain : en retard", () => {
    const r = selectionnerTachesEnCours([tache("a", "2020-01-01T00:00:00.000Z")], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(1);
  });

  it("sans echeance (undefined ou null) : jamais en retard", () => {
    const r = selectionnerTachesEnCours([tache("a"), tache("b", null)], AUJOURDHUI);
    expect(r.nbTachesEnRetard).toBe(0);
    expect(r.nbTachesEnCours).toBe(2);
  });

  // Le seuil suit `maintenant`, a la milliseconde pres, autour de minuit UTC.
  it("maintenant = minuit UTC pile : le seuil est ce minuit", () => {
    const minuit = d("2026-10-21T00:00:00.000Z");
    const r = selectionnerTachesEnCours(
      [tache("a", "2026-10-21T00:00:00.000Z"), tache("b", "2026-10-20T23:59:59.999Z")],
      minuit
    );
    expect(r.nbTachesEnRetard).toBe(1);
  });

  it("maintenant = 23:59:59.999 UTC : le seuil reste le minuit du meme jour", () => {
    const finDeJour = d("2026-10-21T23:59:59.999Z");
    const r = selectionnerTachesEnCours(
      [tache("a", "2026-10-21T00:00:00.000Z"), tache("b", "2026-10-20T23:59:59.999Z")],
      finDeJour
    );
    expect(r.nbTachesEnRetard).toBe(1);
  });

  it("le seuil avance d'un jour quand `maintenant` passe minuit UTC", () => {
    const echeance = tache("a", "2026-10-21T00:00:00.000Z");
    expect(
      selectionnerTachesEnCours([echeance], d("2026-10-21T23:59:59.999Z")).nbTachesEnRetard
    ).toBe(0);
    expect(
      selectionnerTachesEnCours([echeance], d("2026-10-22T00:00:00.000Z")).nbTachesEnRetard
    ).toBe(1);
  });

  // Les taches en retard sont triees en premier : si le compteur ne portait que
  // sur les taches affichees, il plafonnerait a la limite.
  it("le compteur porte sur TOUTES les taches, pas seulement les affichees", () => {
    const retards = Array.from({ length: 7 }, (_, i) =>
      tache(`r${i}`, `2026-10-0${i + 1}T00:00:00.000Z`)
    );
    const aVenir = [tache("v1", "2026-11-01T00:00:00.000Z"), tache("sans")];
    const r = selectionnerTachesEnCours([...aVenir, ...retards], AUJOURDHUI);
    expect(r.aAfficher).toHaveLength(5);
    expect(r.nbTachesEnRetard).toBe(7);
    expect(r.nbTachesEnCours).toBe(9);
  });

  it("des taches en retard hors de la liste affichee sont quand meme comptees (limite 1)", () => {
    const taches = [
      tache("r1", "2026-09-01T00:00:00.000Z"),
      tache("r2", "2026-09-02T00:00:00.000Z"),
      tache("r3", "2026-09-03T00:00:00.000Z"),
    ];
    const r = selectionnerTachesEnCours(taches, AUJOURDHUI, 1);
    expect(ids(r.aAfficher)).toEqual(["r1"]);
    expect(r.nbTachesEnRetard).toBe(3);
  });
});

describe("selectionnerTachesEnCours : entree non modifiee", () => {
  it("le tableau d'entree garde son ordre d'origine", () => {
    const taches = [
      tache("c", "2026-12-01T00:00:00.000Z"),
      tache("a", "2026-10-01T00:00:00.000Z"),
      tache("b"),
    ];
    selectionnerTachesEnCours(taches, AUJOURDHUI);
    expect(ids(taches)).toEqual(["c", "a", "b"]);
    expect(taches).toHaveLength(3);
  });

  it("un tableau gele ne fait pas planter la fonction", () => {
    const gele = Object.freeze([
      tache("b", "2026-12-01T00:00:00.000Z"),
      tache("a", "2026-10-01T00:00:00.000Z"),
    ]) as unknown as TacheTest[];
    expect(() => selectionnerTachesEnCours(gele, AUJOURDHUI)).not.toThrow();
    expect(ids(selectionnerTachesEnCours(gele, AUJOURDHUI).aAfficher)).toEqual(["a", "b"]);
  });

  it("les dates des taches et `maintenant` ne sont pas modifiees", () => {
    const echeance = d("2026-10-20T10:00:00.000Z");
    const maintenant = d("2026-10-21T15:00:00.000Z");
    selectionnerTachesEnCours([{ _id: { toString: () => "a" }, dueDate: echeance }], maintenant);
    expect(echeance.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(maintenant.toISOString()).toBe("2026-10-21T15:00:00.000Z");
  });
});
