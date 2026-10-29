import { describe, expect, it } from "vitest";
import { CATEGORIES_DEPENSE, parserMois, totauxParCategorie, type SoldeMembre } from "@/lib/dashboard";
import {
  construireRecapMensuel,
  deMois,
  formaterDate,
  libelleCategorie,
  libelleMois,
  libellePayeurs,
  libellePourcentage,
  libelleSolde,
  MAX_DEPENSES_EXPORT,
  nomFichierRecap,
  nomVirement,
  textePourPdf,
  trierDepenses,
  type DepenseBrute,
  type EntreeRecap,
} from "@/lib/recap-mensuel";
import type { DetteSimplifiee } from "@/lib/settlements";

// Dates en ISO avec "Z" : le test ne depend jamais du fuseau de la machine.
const d = (iso: string) => new Date(iso);

// "Maintenant" fige : on ne lit jamais l'horloge reelle.
const MAINTENANT = d("2026-10-21T12:00:00.000Z");

// Le mois du recap est fabrique par parserMois (la vraie fonction du dashboard),
// pour que les tests utilisent le meme type MoisDashboard que l'application.
const OCTOBRE = parserMois("2026-10", MAINTENANT);

// Fabrique une depense brute ; chaque test ne precise que ce qui l'interesse.
function depense(surcharge: Partial<DepenseBrute> = {}): DepenseBrute {
  return {
    _id: "aaa1",
    date: d("2026-10-05T00:00:00.000Z"),
    description: "Courses",
    category: "courses",
    amount: 10,
    payers: [{ userId: "u1", amount: 10 }],
    ...surcharge,
  };
}

const NOMS = new Map<string, string>([
  ["u1", "Alice"],
  ["u2", "Bob"],
]);

const MEMBRES: SoldeMembre[] = [
  { userId: "u1", name: "Alice", amount: 0 },
  { userId: "u2", name: "Bob", amount: 0 },
  { userId: "u3", name: "Chloé", amount: 0 },
];

// Fabrique une entree complete ; la plupart des tests ne changent qu'un champ.
function entree(surcharge: Partial<EntreeRecap> = {}): EntreeRecap {
  return {
    colocationNom: "Coloc des Lilas",
    mois: OCTOBRE,
    maintenant: MAINTENANT,
    depenses: [],
    nomsParId: NOMS,
    soldes: [],
    dettes: [],
    ...surcharge,
  };
}

// ---------------------------------------------------------------------------
// libelleMois
// ---------------------------------------------------------------------------

describe("libelleMois", () => {
  it("octobre 2026 : 'octobre 2026'", () => {
    expect(libelleMois({ annee: 2026, mois: 10 })).toBe("octobre 2026");
  });

  it("janvier : 'janvier 2027'", () => {
    expect(libelleMois({ annee: 2027, mois: 1 })).toBe("janvier 2027");
  });

  // Les mois a accent sont ceux qui risquent de sortir mal si l'ICU du serveur
  // n'a pas les donnees francaises.
  it("mois a accent : fevrier, aout, decembre", () => {
    expect(libelleMois({ annee: 2026, mois: 2 })).toBe("février 2026");
    expect(libelleMois({ annee: 2026, mois: 8 })).toBe("août 2026");
    expect(libelleMois({ annee: 2026, mois: 12 })).toBe("décembre 2026");
  });

  it("les 12 mois donnent 12 libelles distincts, tous en minuscules", () => {
    const libelles = Array.from({ length: 12 }, (_, i) => libelleMois({ annee: 2026, mois: i + 1 }));
    expect(new Set(libelles).size).toBe(12);
    for (const l of libelles) expect(l).toBe(l.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// libelleCategorie
// ---------------------------------------------------------------------------

describe("libelleCategorie", () => {
  // On boucle sur la liste reelle : si une categorie est ajoutee dans
  // dashboard.ts, elle est testee d'office.
  it.each(CATEGORIES_DEPENSE.map((c) => [c.category, c.label] as const))(
    "categorie connue '%s' : libelle '%s'",
    (code, libelle) => {
      expect(libelleCategorie(code)).toBe(libelle);
    }
  );

  it("valeurs explicites : courses, factures, loyer, sorties, autre", () => {
    expect(libelleCategorie("courses")).toBe("Courses");
    expect(libelleCategorie("factures")).toBe("Factures");
    expect(libelleCategorie("loyer")).toBe("Loyer");
    expect(libelleCategorie("sorties")).toBe("Sorties");
    expect(libelleCategorie("autre")).toBe("Autre");
  });

  it("categorie inconnue : 'Autre'", () => {
    expect(libelleCategorie("vacances")).toBe("Autre");
  });

  it("chaine vide : 'Autre'", () => {
    expect(libelleCategorie("")).toBe("Autre");
  });

  // La recherche est exacte : on ne devine pas une categorie mal casee.
  it("casse differente : 'Autre' (pas de correspondance approximative)", () => {
    expect(libelleCategorie("COURSES")).toBe("Autre");
  });
});

// ---------------------------------------------------------------------------
// trierDepenses
// ---------------------------------------------------------------------------

describe("trierDepenses", () => {
  it("tri par date croissante", () => {
    const a = depense({ _id: "a", date: d("2026-10-20T00:00:00.000Z") });
    const b = depense({ _id: "b", date: d("2026-10-02T00:00:00.000Z") });
    const c = depense({ _id: "c", date: d("2026-10-11T00:00:00.000Z") });
    expect(trierDepenses([a, b, c]).map((x) => x._id)).toEqual(["b", "c", "a"]);
  });

  it("meme date : tri par _id croissant", () => {
    const date = d("2026-10-05T00:00:00.000Z");
    const x = depense({ _id: "ccc", date });
    const y = depense({ _id: "aaa", date });
    const z = depense({ _id: "bbb", date });
    expect(trierDepenses([x, y, z]).map((e) => e._id)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("la date prime sur l'_id", () => {
    const tot = depense({ _id: "zzz", date: d("2026-10-01T00:00:00.000Z") });
    const tard = depense({ _id: "aaa", date: d("2026-10-02T00:00:00.000Z") });
    expect(trierDepenses([tard, tot]).map((e) => e._id)).toEqual(["zzz", "aaa"]);
  });

  // Le vrai _id Mongo est un objet avec toString(), pas une chaine.
  it("_id sous forme d'objet avec toString (comme un ObjectId)", () => {
    const date = d("2026-10-05T00:00:00.000Z");
    const id = (s: string) => ({ toString: () => s });
    const x = depense({ _id: id("65b"), date });
    const y = depense({ _id: id("65a"), date });
    expect(trierDepenses([x, y]).map((e) => e._id.toString())).toEqual(["65a", "65b"]);
  });

  it("le resultat ne depend pas de l'ordre d'entree (PDF reproductible)", () => {
    const date = d("2026-10-05T00:00:00.000Z");
    const liste = [
      depense({ _id: "b", date }),
      depense({ _id: "a", date }),
      depense({ _id: "c", date: d("2026-10-01T00:00:00.000Z") }),
    ];
    const ids = (l: DepenseBrute[]) => l.map((e) => e._id);
    expect(ids(trierDepenses(liste))).toEqual(ids(trierDepenses([...liste].reverse())));
  });

  it("ne modifie pas le tableau d'entree et renvoie un nouveau tableau", () => {
    const a = depense({ _id: "a", date: d("2026-10-20T00:00:00.000Z") });
    const b = depense({ _id: "b", date: d("2026-10-02T00:00:00.000Z") });
    const entreeTab = [a, b];
    const resultat = trierDepenses(entreeTab);
    expect(entreeTab).toEqual([a, b]);
    expect(entreeTab[0]).toBe(a);
    expect(resultat).not.toBe(entreeTab);
  });

  it("tableau vide : tableau vide", () => {
    expect(trierDepenses([])).toEqual([]);
  });

  it("une seule depense : inchangee", () => {
    const a = depense();
    expect(trierDepenses([a])).toEqual([a]);
  });
});

// ---------------------------------------------------------------------------
// construireRecapMensuel
// ---------------------------------------------------------------------------

describe("construireRecapMensuel : mois sans depense", () => {
  it("listes vides, total 0, mais soldes et virements toujours presents", () => {
    const soldes: SoldeMembre[] = [
      { userId: "u1", name: "Alice", amount: 0 },
      { userId: "u2", name: "Bob", amount: 0 },
    ];
    const recap = construireRecapMensuel(entree({ soldes }));
    expect(recap.depenses).toEqual([]);
    expect(recap.categories).toEqual([]);
    expect(recap.totalMois).toBe(0);
    // Un mois vide ne fait pas disparaitre les soldes : ils sont ceux du jour.
    expect(recap.soldes).toEqual(soldes);
    expect(recap.virements).toEqual([]);
  });

  it("le libelle et la colocation sont quand meme remplis", () => {
    const recap = construireRecapMensuel(entree());
    expect(recap.moisLibelle).toBe("octobre 2026");
    expect(recap.colocation.nom).toBe("Coloc des Lilas");
    expect(recap.mois).toBe(OCTOBRE);
  });
});

describe("construireRecapMensuel : plusieurs depenses", () => {
  const depenses: DepenseBrute[] = [
    depense({
      _id: "c",
      date: d("2026-10-20T00:00:00.000Z"),
      description: "Cinema",
      category: "sorties",
      amount: 15.5,
      payers: [{ userId: "u2", amount: 15.5 }],
    }),
    depense({
      _id: "a",
      date: d("2026-10-02T00:00:00.000Z"),
      description: "Loyer octobre",
      category: "loyer",
      amount: 600,
      payers: [{ userId: "u1", amount: 600 }],
    }),
    depense({
      _id: "b",
      date: d("2026-10-11T00:00:00.000Z"),
      description: "Supermarche",
      category: "courses",
      amount: 42.3,
      payers: [{ userId: "u1", amount: 42.3 }],
    }),
  ];

  it("depenses triees par date, avec description et montant repris", () => {
    const recap = construireRecapMensuel(entree({ depenses }));
    expect(recap.depenses.map((x) => x.description)).toEqual([
      "Loyer octobre",
      "Supermarche",
      "Cinema",
    ]);
    expect(recap.depenses.map((x) => x.montant)).toEqual([600, 42.3, 15.5]);
    expect(recap.depenses[0].date.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("la categorie est le libelle francais, pas le code stocke", () => {
    const recap = construireRecapMensuel(entree({ depenses }));
    expect(recap.depenses.map((x) => x.categorie)).toEqual(["Loyer", "Courses", "Sorties"]);
  });

  it("une categorie inconnue en base ressort 'Autre'", () => {
    const recap = construireRecapMensuel(
      entree({ depenses: [depense({ category: "vacances" })] })
    );
    expect(recap.depenses[0].categorie).toBe("Autre");
  });

  it("total et categories identiques a totauxParCategorie (meme calcul que le dashboard)", () => {
    const recap = construireRecapMensuel(entree({ depenses }));
    const attendu = totauxParCategorie(depenses);
    expect(recap.categories).toEqual(attendu.categories);
    expect(recap.totalMois).toBe(attendu.total);
    expect(recap.totalMois).toBe(657.8);
  });

  // Le pourcentage est un entier dont la somme fait exactement 100.
  it("la somme des pourcentages des categories vaut 100", () => {
    const recap = construireRecapMensuel(entree({ depenses }));
    const somme = recap.categories.reduce((s, c) => s + c.pourcentage, 0);
    expect(somme).toBe(100);
  });

  it("le total des categories egale le total du mois", () => {
    const recap = construireRecapMensuel(entree({ depenses }));
    const somme = recap.categories.reduce((s, c) => s + c.total, 0);
    expect(Math.round(somme * 100)).toBe(Math.round(recap.totalMois * 100));
  });

  it("une categorie inconnue est comptee dans 'autre' dans les totaux", () => {
    const recap = construireRecapMensuel(
      entree({ depenses: [depense({ category: "vacances", amount: 20 })] })
    );
    expect(recap.categories).toHaveLength(1);
    expect(recap.categories[0].category).toBe("autre");
    expect(recap.categories[0].total).toBe(20);
    expect(recap.totalMois).toBe(20);
  });
});

describe("construireRecapMensuel : payeurs", () => {
  it("un seul payeur : son nom et son montant", () => {
    const recap = construireRecapMensuel(entree({ depenses: [depense()] }));
    expect(recap.depenses[0].payeurs).toEqual([{ nom: "Alice", montant: 10 }]);
  });

  it("payeurs multiples : nom et montant de chacun, dans l'ordre d'origine", () => {
    const multi = depense({
      amount: 90,
      payers: [
        { userId: "u2", amount: 30 },
        { userId: "u1", amount: 60 },
      ],
    });
    const recap = construireRecapMensuel(entree({ depenses: [multi] }));
    expect(recap.depenses[0].payeurs).toEqual([
      { nom: "Bob", montant: 30 },
      { nom: "Alice", montant: 60 },
    ]);
    expect(recap.depenses[0].montant).toBe(90);
  });

  it("payeur inconnu : 'Utilisateur supprimé'", () => {
    const recap = construireRecapMensuel(
      entree({ depenses: [depense({ payers: [{ userId: "fantome", amount: 10 }] })] })
    );
    expect(recap.depenses[0].payeurs).toEqual([
      { nom: "Utilisateur supprimé", montant: 10 },
    ]);
  });

  it("payeur connu et payeur inconnu dans la meme depense", () => {
    const recap = construireRecapMensuel(
      entree({
        depenses: [
          depense({
            amount: 20,
            payers: [
              { userId: "u1", amount: 12 },
              { userId: "fantome", amount: 8 },
            ],
          }),
        ],
      })
    );
    expect(recap.depenses[0].payeurs).toEqual([
      { nom: "Alice", montant: 12 },
      { nom: "Utilisateur supprimé", montant: 8 },
    ]);
  });

  it("table de noms vide : tous les payeurs sont 'Utilisateur supprimé'", () => {
    const recap = construireRecapMensuel(
      entree({ depenses: [depense()], nomsParId: new Map() })
    );
    expect(recap.depenses[0].payeurs[0].nom).toBe("Utilisateur supprimé");
  });

  // Les ObjectId reels ne sont pas des chaines : la recherche passe par toString().
  it("userId sous forme d'objet avec toString (comme un ObjectId)", () => {
    const recap = construireRecapMensuel(
      entree({
        depenses: [depense({ payers: [{ userId: { toString: () => "u2" }, amount: 10 }] })],
      })
    );
    expect(recap.depenses[0].payeurs[0].nom).toBe("Bob");
  });
});

describe("construireRecapMensuel : dates, colocation, soldes, virements", () => {
  it("genereLe et soldesAu valent la date passee", () => {
    const recap = construireRecapMensuel(entree());
    expect(recap.genereLe).toBe(MAINTENANT);
    expect(recap.soldesAu).toBe(MAINTENANT);
  });

  // Un recap d'un mois passe est genere aujourd'hui : les soldes sont ceux du
  // jour de generation, pas de la fin du mois demande.
  it("recap d'un mois passe : genereLe et soldesAu restent la date de generation", () => {
    const septembre = parserMois("2026-09", MAINTENANT);
    const recap = construireRecapMensuel(entree({ mois: septembre }));
    expect(recap.moisLibelle).toBe("septembre 2026");
    expect(recap.genereLe.toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(recap.soldesAu.toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });

  it("le nom de la colocation est repris", () => {
    const recap = construireRecapMensuel(entree({ colocationNom: "Les Quatre Vents" }));
    expect(recap.colocation).toEqual({ nom: "Les Quatre Vents" });
  });

  it("les soldes sont repris tels quels, dans le meme ordre", () => {
    const soldes: SoldeMembre[] = [
      { userId: "u1", name: "Alice", amount: 25.5 },
      { userId: "u2", name: "Bob", amount: -25.5 },
    ];
    const recap = construireRecapMensuel(entree({ soldes }));
    expect(recap.soldes).toEqual(soldes);
  });

  it("virements : de, a et montant en euros repris des dettes", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 25.5 },
      { fromUserId: "u3", toUserId: "u1", fromName: "Chloé", toName: "Alice", amount: 8 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(recap.virements).toEqual([
      { de: "Bob", a: "Alice", montant: 25.5, deAncienMembre: false, aAncienMembre: false },
      { de: "Chloé", a: "Alice", montant: 8, deAncienMembre: false, aAncienMembre: false },
    ]);
  });

  it("les virements n'exposent pas les identifiants internes", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 5 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(Object.keys(recap.virements[0]).sort()).toEqual([
      "a",
      "aAncienMembre",
      "de",
      "deAncienMembre",
      "montant",
    ]);
  });
});

// Les soldes ne listent que les membres ACTUELS : c'est eux qui decident si un
// nom du virement est un ancien membre.
describe("construireRecapMensuel : anciens membres dans les virements", () => {
  it("debiteur parti de la colocation : deAncienMembre vrai, aAncienMembre faux", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "parti", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 12 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(recap.virements[0].deAncienMembre).toBe(true);
    expect(recap.virements[0].aAncienMembre).toBe(false);
  });

  it("crediteur parti de la colocation : aAncienMembre vrai, deAncienMembre faux", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "parti", fromName: "Bob", toName: "Alice", amount: 12 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(recap.virements[0].deAncienMembre).toBe(false);
    expect(recap.virements[0].aAncienMembre).toBe(true);
  });

  it("deux membres actuels : aucun des deux booleens", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 12 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(recap.virements[0].deAncienMembre).toBe(false);
    expect(recap.virements[0].aAncienMembre).toBe(false);
  });

  // Le piege que les ids evitent : un ancien membre qui porte le meme nom
  // qu'un membre actuel ne doit pas etre pris pour lui.
  it("meme nom qu'un membre actuel mais id different : reste un ancien membre", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "autre-bob", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 3 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(recap.virements[0].deAncienMembre).toBe(true);
  });
});

describe("construireRecapMensuel : accents et caracteres speciaux", () => {
  it("description et noms ressortent inchanges (é, ç, apostrophe, &, <)", () => {
    const description = "Fête d'été & <Barbecue> à la plage, ça régale";
    const noms = new Map<string, string>([["u1", "Zoé & Françoise <3"]]);
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u1", toUserId: "u2", fromName: "Zoé & Françoise <3", toName: "Léo d'Arc", amount: 3 },
    ];
    const recap = construireRecapMensuel(
      entree({
        colocationNom: "Chez l'Évêque & Cie <test>",
        depenses: [depense({ description })],
        nomsParId: noms,
        soldes: MEMBRES,
        dettes,
      })
    );
    expect(recap.depenses[0].description).toBe(description);
    expect(recap.depenses[0].payeurs[0].nom).toBe("Zoé & Françoise <3");
    expect(recap.colocation.nom).toBe("Chez l'Évêque & Cie <test>");
    expect(recap.virements[0]).toEqual({
      de: "Zoé & Françoise <3",
      a: "Léo d'Arc",
      montant: 3,
      deAncienMembre: false,
      aAncienMembre: false,
    });
  });
});

describe("construireRecapMensuel : immutabilite et filtrage", () => {
  it("l'entree n'est pas modifiee (depenses, noms, soldes, dettes)", () => {
    const depenses = [
      depense({ _id: "b", date: d("2026-10-20T00:00:00.000Z") }),
      depense({ _id: "a", date: d("2026-10-02T00:00:00.000Z") }),
    ];
    const soldes: SoldeMembre[] = [{ userId: "u1", name: "Alice", amount: 1 }];
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 1 },
    ];
    const e = entree({ depenses, soldes, dettes });
    const copie = structuredClone(e);
    construireRecapMensuel(e);
    expect(e).toEqual(copie);
    // L'ordre du tableau d'origine reste "b" puis "a" : le tri travaille sur une copie.
    expect(e.depenses.map((x) => x._id)).toEqual(["b", "a"]);
  });

  it("deux appels avec la meme entree donnent le meme resultat", () => {
    const e = entree({
      depenses: [
        depense({ _id: "b", date: d("2026-10-05T00:00:00.000Z") }),
        depense({ _id: "a", date: d("2026-10-05T00:00:00.000Z") }),
      ],
    });
    expect(construireRecapMensuel(e)).toEqual(construireRecapMensuel(e));
  });

  // Le filtre du mois (>= debut, < fin) est fait par la requete Mongo dans
  // donneesRecapMensuel, pas dans la partie pure. Il n'est donc pas teste ici :
  // la partie pure reprend toutes les depenses qu'on lui donne.
  it("la partie pure ne filtre pas par date : toutes les depenses recues sont reprises", () => {
    const recap = construireRecapMensuel(
      entree({
        depenses: [
          depense({ _id: "a", date: d("2026-10-01T00:00:00.000Z") }),
          depense({ _id: "b", date: d("2026-11-01T00:00:00.000Z") }),
        ],
      })
    );
    expect(recap.depenses).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// nomFichierRecap
// ---------------------------------------------------------------------------

describe("nomFichierRecap", () => {
  const MOIS_MARS = { annee: 2026, mois: 3 };

  // Extrait le slug : ce qui se trouve entre "roomflow-" et "-2026-03.pdf".
  const slugDe = (nom: string) =>
    nomFichierRecap(nom, MOIS_MARS).slice("roomflow-".length, -"-2026-03.pdf".length);

  // Cas nominaux : accents retires, minuscules, separateurs fusionnes.
  it("nom avec accents : accents retires, espace remplace par un tiret", () => {
    expect(nomFichierRecap("Les Étoiles", MOIS_MARS)).toBe("roomflow-les-etoiles-2026-03.pdf");
  });

  it("tirets et espaces multiples fusionnes, bords retires, ponctuation remplacee", () => {
    expect(nomFichierRecap("  Été--chez  Zoé!! ", MOIS_MARS)).toBe(
      "roomflow-ete-chez-zoe-2026-03.pdf"
    );
  });

  it("majuscules passees en minuscules", () => {
    expect(nomFichierRecap("ROOM MATES", MOIS_MARS)).toBe("roomflow-room-mates-2026-03.pdf");
  });

  // Aucun caractere latin dans le nom : le slug est vide, on retombe sur "colocation".
  it.each([
    ["cyrillique", "Привет"],
    ["emoji", "😀"],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
  ])("sans caractere latin (%s) : 'colocation'", (_, nom) => {
    expect(nomFichierRecap(nom, MOIS_MARS)).toBe("roomflow-colocation-2026-03.pdf");
  });

  // Le nom finit dans un en-tete Content-Disposition : ces caracteres ne doivent jamais passer.
  it("guillemet, point-virgule, barre oblique et retour ligne : absents du resultat", () => {
    const resultat = nomFichierRecap('a"b;c/d\r\ne', MOIS_MARS);
    for (const interdit of ['"', ";", "/", "\r", "\n"]) {
      expect(resultat).not.toContain(interdit);
    }
    expect(resultat).toBe("roomflow-a-b-c-d-e-2026-03.pdf");
  });

  // Un nom de colocation ne doit pas permettre de sortir du dossier (chemin relatif).
  it("chemin relatif '../../etc' : pas de '..' ni de '/' dans le nom", () => {
    const resultat = nomFichierRecap("../../etc", MOIS_MARS);
    expect(resultat).not.toContain("..");
    expect(resultat).not.toContain("/");
    expect(resultat).toBe("roomflow-etc-2026-03.pdf");
  });

  describe("troncature a 40 caracteres", () => {
    it("nom de 100 caracteres : slug de 40 caracteres exactement", () => {
      const nom = "ab".repeat(50);
      expect(nomFichierRecap(nom, MOIS_MARS)).toBe(`roomflow-${"ab".repeat(20)}-2026-03.pdf`);
    });

    // 39 lettres puis un espace : le 40e caractere du slug est le tiret. Il doit disparaitre.
    it("coupure qui tombe sur un tiret : pas de tiret final", () => {
      const nom = "a".repeat(39) + " " + "b".repeat(60);
      expect(nomFichierRecap(nom, MOIS_MARS)).toBe(`roomflow-${"a".repeat(39)}-2026-03.pdf`);
    });

    // On fait varier la longueur autour de la limite pour que la coupure tombe a chaque position.
    it("quelle que soit la coupure : slug de 1 a 40 caracteres, sans tiret au bord", () => {
      for (let n = 30; n <= 50; n++) {
        const slug = slugDe("ab cd ".repeat(20).slice(0, n));
        expect(slug.length).toBeGreaterThan(0);
        expect(slug.length).toBeLessThanOrEqual(40);
        expect(slug).not.toMatch(/^-|-$/);
      }
    });
  });

  // Le mois est toujours sur 2 chiffres dans le nom de fichier.
  it.each([
    [1, "01"],
    [3, "03"],
    [12, "12"],
  ])("mois %i : ecrit '%s' dans le nom", (mois, attendu) => {
    expect(nomFichierRecap("Test", { annee: 2026, mois })).toBe(
      `roomflow-test-2026-${attendu}.pdf`
    );
  });

  // Le resultat part dans un en-tete HTTP : seul l'ASCII imprimable est accepte.
  it.each([
    ["cyrillique", "Привет"],
    ["emoji avec texte", "😀 café"],
    ["caracteres de controle NUL, BEL, US, DEL", "a\u0000b\u0007c\u001Fd\u007Fe"],
    ["retour chariot et tabulation", "Ça\r\n\tx"],
    ["accents combinants isoles", "é̀ ̸"],
    ["controles C1", "\u0085\u009Bnom"],
    ["controle de direction", "‮abc‬"],
    ["chaine vide", ""],
  ])("%s : resultat en ASCII imprimable", (_, nom) => {
    expect(nomFichierRecap(nom, MOIS_MARS)).toMatch(/^[\x20-\x7E]+$/);
  });

  // Les separateurs sont fusionnes : jamais deux tirets de suite dans le slug.
  it.each([
    ["espaces et tirets melanges", "a - - b"],
    ["underscores", "a___b"],
    ["points", "a..b"],
    ["tirets et espaces en bordure", "  -- --  "],
    ["accents et tirets", "é -- ü"],
    ["retours ligne", "x\r\n\r\ny"],
    ["emojis entre lettres", "a😀😀b"],
  ])("%s : pas de double tiret dans le slug", (_, nom) => {
    expect(slugDe(nom)).not.toContain("--");
  });
});

// ---------------------------------------------------------------------------
// MAX_DEPENSES_EXPORT
// ---------------------------------------------------------------------------

describe("MAX_DEPENSES_EXPORT", () => {
  it("vaut 300", () => {
    expect(MAX_DEPENSES_EXPORT).toBe(300);
  });

  it("est un entier positif", () => {
    expect(Number.isInteger(MAX_DEPENSES_EXPORT)).toBe(true);
    expect(MAX_DEPENSES_EXPORT).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// deMois
// ---------------------------------------------------------------------------

describe("deMois", () => {
  // Voyelle ou h muet : apostrophe. Sinon "de " suivi d'une espace.
  it.each([
    [1, "janvier", "de"],
    [2, "février", "de"],
    [3, "mars", "de"],
    [4, "avril", "d'"],
    [5, "mai", "de"],
    [6, "juin", "de"],
    [7, "juillet", "de"],
    [8, "août", "d'"],
    [9, "septembre", "de"],
    [10, "octobre", "d'"],
    [11, "novembre", "de"],
    [12, "décembre", "de"],
  ])("mois %i (%s) : préfixe '%s'", (mois, nomDuMois, prefixe) => {
    // On passe par libelleMois : le test suit le vrai libellé produit par l'application.
    const libelle = libelleMois({ annee: 2026, mois });
    expect(libelle.startsWith(nomDuMois)).toBe(true);
    expect(deMois(libelle)).toBe(prefixe === "d'" ? `d'${libelle}` : `de ${libelle}`);
  });

  it("valeurs explicites : avril, août, octobre, mars", () => {
    expect(deMois("avril 2026")).toBe("d'avril 2026");
    expect(deMois("août 2026")).toBe("d'août 2026");
    expect(deMois("octobre 2026")).toBe("d'octobre 2026");
    expect(deMois("mars 2026")).toBe("de mars 2026");
  });

  it("le libellé est repris tel quel, sans année supprimée ni changement de casse", () => {
    expect(deMois("octobre 2026")).toContain("octobre 2026");
    expect(deMois("Décembre 2026")).toBe("de Décembre 2026");
  });

  it("majuscule initiale : la voyelle est reconnue aussi (flag i)", () => {
    expect(deMois("Octobre 2026")).toBe("d'Octobre 2026");
  });

  it("chaîne vide : 'de ' (pas d'exception)", () => {
    expect(deMois("")).toBe("de ");
  });
});

// ---------------------------------------------------------------------------
// formaterDate
// ---------------------------------------------------------------------------

describe("formaterDate", () => {
  it("date ordinaire : JJ/MM/AAAA", () => {
    expect(formaterDate(d("2026-10-21T12:00:00.000Z"))).toBe("21/10/2026");
  });

  it("zéros de tête : jour 5, mois 3", () => {
    expect(formaterDate(d("2026-03-05T00:00:00.000Z"))).toBe("05/03/2026");
  });

  it("31 décembre à 23:30 UTC : reste le 31/12 (pas de bascule sur l'année suivante)", () => {
    expect(formaterDate(d("2026-12-31T23:30:00.000Z"))).toBe("31/12/2026");
  });

  it("1er janvier à 00:00 UTC : 01/01 (pas de bascule sur l'année précédente)", () => {
    expect(formaterDate(d("2027-01-01T00:00:00.000Z"))).toBe("01/01/2027");
  });

  it("dernière milliseconde du jour : le jour ne change pas", () => {
    expect(formaterDate(d("2026-02-28T23:59:59.999Z"))).toBe("28/02/2026");
  });

  // Une date donnée avec un décalage horaire est lue en UTC : 23:30 à -05:00 = 04:30 UTC le lendemain.
  it("date saisie avec un décalage : le résultat est celui du jour UTC", () => {
    expect(formaterDate(d("2026-12-31T23:30:00-05:00"))).toBe("01/01/2027");
  });

  it("29 février d'une année bissextile", () => {
    expect(formaterDate(d("2028-02-29T00:00:00.000Z"))).toBe("29/02/2028");
  });

  it("le résultat a toujours la forme JJ/MM/AAAA", () => {
    for (let mois = 1; mois <= 12; mois++) {
      const date = new Date(Date.UTC(2026, mois - 1, 9));
      expect(formaterDate(date)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// libelleSolde
// ---------------------------------------------------------------------------

// formaterEuros peut utiliser une espace insécable : on la ramène à une espace
// normale pour comparer à des chaînes lisibles.
const normaliser = (s: string) => s.replace(/[  ]/g, " ");

describe("libelleSolde", () => {
  it("solde positif : 'on lui doit X'", () => {
    expect(normaliser(libelleSolde(25.5))).toBe("on lui doit 25,50 €");
  });

  it("solde négatif : 'doit X' (montant sans signe moins)", () => {
    expect(normaliser(libelleSolde(-25.5))).toBe("doit 25,50 €");
  });

  it("zéro : 'à jour'", () => {
    expect(libelleSolde(0)).toBe("à jour");
  });

  it("-0 : 'à jour' (pas 'doit -0,00 €')", () => {
    expect(libelleSolde(-0)).toBe("à jour");
  });

  it("grands montants : séparateur de milliers", () => {
    expect(normaliser(libelleSolde(1234.56))).toBe("on lui doit 1 234,56 €");
    expect(normaliser(libelleSolde(-1234.56))).toBe("doit 1 234,56 €");
    expect(normaliser(libelleSolde(1234567.89))).toBe("on lui doit 1 234 567,89 €");
  });

  it("centimes : toujours deux décimales (0,10 et non 0,1)", () => {
    expect(normaliser(libelleSolde(0.1))).toBe("on lui doit 0,10 €");
    expect(normaliser(libelleSolde(-0.1))).toBe("doit 0,10 €");
    expect(normaliser(libelleSolde(0.01))).toBe("on lui doit 0,01 €");
  });

  it("montant entier : ',00' ajouté", () => {
    expect(normaliser(libelleSolde(12))).toBe("on lui doit 12,00 €");
  });

  // Comportement ACTUEL, pas forcément souhaité : le signe est testé sur le
  // montant brut, l'arrondi au centime est fait après par formaterEuros. Un
  // montant de moins d'un demi-centime affiche donc "0,00 €" au lieu de "à jour".
  // Le cas ne se produit pas en pratique : calculerSoldesMembres ramène déjà
  // tout montant de moins d'un centime à 0. Voir le rapport.
  it("0.004 (sous le demi-centime) : comportement actuel 'on lui doit 0,00 €'", () => {
    expect(normaliser(libelleSolde(0.004))).toBe("on lui doit 0,00 €");
  });

  it("-0.004 (sous le demi-centime) : comportement actuel 'doit 0,00 €'", () => {
    expect(normaliser(libelleSolde(-0.004))).toBe("doit 0,00 €");
  });

  it("0.005 et -0.005 : arrondis au centime supérieur (0,01 €)", () => {
    expect(normaliser(libelleSolde(0.005))).toBe("on lui doit 0,01 €");
    expect(normaliser(libelleSolde(-0.005))).toBe("doit 0,01 €");
  });
});

// ---------------------------------------------------------------------------
// libellePayeurs
// ---------------------------------------------------------------------------

describe("libellePayeurs", () => {
  it("un seul payeur : juste le nom, sans montant", () => {
    expect(libellePayeurs([{ nom: "Alice", montant: 42.3 }])).toBe("Alice");
  });

  it("plusieurs payeurs : nom et montant de chacun, séparés par une virgule", () => {
    expect(
      normaliser(
        libellePayeurs([
          { nom: "Alice", montant: 60 },
          { nom: "Bob", montant: 40 },
        ])
      )
    ).toBe("Alice 60,00 €, Bob 40,00 €");
  });

  it("trois payeurs : l'ordre d'origine est conservé", () => {
    expect(
      normaliser(
        libellePayeurs([
          { nom: "Chloé", montant: 10 },
          { nom: "Alice", montant: 20.5 },
          { nom: "Bob", montant: 0.1 },
        ])
      )
    ).toBe("Chloé 10,00 €, Alice 20,50 €, Bob 0,10 €");
  });

  it("liste vide : '(aucun payeur)'", () => {
    expect(libellePayeurs([])).toBe("(aucun payeur)");
  });

  it("noms avec accents, apostrophe et cédille : inchangés", () => {
    expect(libellePayeurs([{ nom: "Zoé", montant: 5 }])).toBe("Zoé");
    expect(
      normaliser(
        libellePayeurs([
          { nom: "Françoise", montant: 7.5 },
          { nom: "Léo d'Arc", montant: 12.5 },
        ])
      )
    ).toBe("Françoise 7,50 €, Léo d'Arc 12,50 €");
  });

  it("grand montant d'un des payeurs : séparateur de milliers", () => {
    expect(
      normaliser(
        libellePayeurs([
          { nom: "Alice", montant: 1234.56 },
          { nom: "Bob", montant: 1 },
        ])
      )
    ).toBe("Alice 1 234,56 €, Bob 1,00 €");
  });
});

// ---------------------------------------------------------------------------
// libellePourcentage
// ---------------------------------------------------------------------------

describe("libellePourcentage", () => {
  it.each([
    [1, "1 %"],
    [7, "7 %"],
    [33, "33 %"],
    [50, "50 %"],
    [67, "67 %"],
    [99, "99 %"],
    [100, "100 %"],
  ])("entier %i : '%s'", (valeur, attendu) => {
    expect(libellePourcentage(valeur)).toBe(attendu);
  });

  it("zéro : '< 1 %' (une petite catégorie ne s'affiche pas '0 %')", () => {
    expect(libellePourcentage(0)).toBe("< 1 %");
  });

  // Les pourcentages viennent de totauxParCategorie (entiers, somme 100) : on
  // vérifie la chaîne complète avec de vraies données plutôt qu'avec 33,3.
  it("trois catégories égales : '34 %', '33 %', '33 %' (somme 100)", () => {
    const { categories } = totauxParCategorie([
      { category: "courses", amount: 10 },
      { category: "loyer", amount: 10 },
      { category: "sorties", amount: 10 },
    ]);
    const libelles = categories.map((c) => libellePourcentage(c.pourcentage));
    expect(libelles.slice().sort()).toEqual(["33 %", "33 %", "34 %"]);
  });

  it("une toute petite catégorie à côté d'une grosse : '< 1 %' et '100 %'", () => {
    const { categories } = totauxParCategorie([
      { category: "loyer", amount: 1000 },
      { category: "autre", amount: 0.01 },
    ]);
    expect(categories.map((c) => libellePourcentage(c.pourcentage))).toEqual(["100 %", "< 1 %"]);
  });

  it("une seule catégorie : '100 %'", () => {
    const { categories } = totauxParCategorie([{ category: "courses", amount: 12.34 }]);
    expect(libellePourcentage(categories[0].pourcentage)).toBe("100 %");
  });
});

// ---------------------------------------------------------------------------
// nomVirement
// ---------------------------------------------------------------------------

describe("nomVirement", () => {
  it("ancien membre : nom suivi de '(ancien membre)'", () => {
    expect(nomVirement("Bob", true)).toBe("Bob (ancien membre)");
  });

  it("membre actuel : nom sans suffixe", () => {
    expect(nomVirement("Bob", false)).toBe("Bob");
  });

  it("nom avec accents : repris tel quel dans les deux cas", () => {
    expect(nomVirement("Chloé", true)).toBe("Chloé (ancien membre)");
    expect(nomVirement("Chloé", false)).toBe("Chloé");
  });

  // Cas réel : les deux booleens d'un virement de construireRecapMensuel.
  it("sur un virement entre deux anciens membres : les deux noms sont suffixés", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "parti1", toUserId: "parti2", fromName: "Bob", toName: "Alice", amount: 9 },
    ];
    const v = construireRecapMensuel(entree({ dettes, soldes: MEMBRES })).virements[0];
    expect(nomVirement(v.de, v.deAncienMembre)).toBe("Bob (ancien membre)");
    expect(nomVirement(v.a, v.aAncienMembre)).toBe("Alice (ancien membre)");
  });

  it("sur un virement entre deux membres actuels : aucun suffixe", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "u1", fromName: "Bob", toName: "Alice", amount: 9 },
    ];
    const v = construireRecapMensuel(entree({ dettes, soldes: MEMBRES })).virements[0];
    expect(nomVirement(v.de, v.deAncienMembre)).toBe("Bob");
    expect(nomVirement(v.a, v.aAncienMembre)).toBe("Alice");
  });
});

// ---------------------------------------------------------------------------
// textePourPdf
// ---------------------------------------------------------------------------

describe("textePourPdf : texte couvert par la police (inchangé)", () => {
  it("texte français courant", () => {
    const texte = "Fête d'été : très bien, ça marche. Œuvre & <test> 50 % (ok) !";
    expect(textePourPdf(texte)).toBe(texte);
  });

  it("é è ê ç œ € « » ’ \u2013 … sont conservés", () => {
    const texte = "é è ê ç œ Œ € « » ’ \u2013 … à ù ô î ï ü";
    expect(textePourPdf(texte)).toBe(texte);
  });

  it("espace insécable et tiret long conservés", () => {
    const texte = "a b \u2014 c";
    expect(textePourPdf(texte)).toBe(texte);
  });

  it("cyrillique", () => {
    expect(textePourPdf("Привет, мир")).toBe("Привет, мир");
  });

  it("grec", () => {
    expect(textePourPdf("Γειά σου κόσμε αβγ ΑΒΓ")).toBe("Γειά σου κόσμε αβγ ΑΒΓ");
  });

  it("latin étendu : ł ő ğ ş ż", () => {
    expect(textePourPdf("ł ő ğ ş ż Ł Ő Ğ Ş Ż")).toBe("ł ő ğ ş ż Ł Ő Ğ Ş Ż");
  });

  it("latin étendu additionnel (vietnamien) conservé", () => {
    expect(textePourPdf("Việt Nam ạ ỹ")).toBe("Việt Nam ạ ỹ");
  });

  it("symboles monétaires (£ ¥ ₹ ₽ ₿) conservés", () => {
    expect(textePourPdf("£ ¥ ₹ ₽ ₿")).toBe("£ ¥ ₹ ₽ ₿");
  });

  it("accents combinants isolés : conservés (bloc U+0300 à U+036F)", () => {
    expect(textePourPdf("́")).toBe("́");
    expect(textePourPdf("é à̂")).toBe("é à̂");
  });

  it("chaîne vide : chaîne vide", () => {
    expect(textePourPdf("")).toBe("");
  });

  it("espaces seules : inchangées", () => {
    expect(textePourPdf("   ")).toBe("   ");
  });
});

describe("textePourPdf : caractères hors police remplacés par '?'", () => {
  it("emoji simple : un seul '?' (le point de code compte pour un, pas deux)", () => {
    expect(textePourPdf("😀")).toBe("?");
    expect(textePourPdf("Pizza 🍕 ce soir")).toBe("Pizza ? ce soir");
  });

  it("deux emojis : deux '?'", () => {
    expect(textePourPdf("😀🍕")).toBe("??");
  });

  // Famille : trois emojis reliés par deux joiners U+200D. Les joiners disparaissent.
  it("emoji composé avec joiner U+200D : un '?' par emoji, joiners supprimés", () => {
    const famille = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    expect(textePourPdf(famille)).toBe("???");
  });

  it("sélecteur d'emoji U+FE0F : supprimé, le symbole devient '?'", () => {
    expect(textePourPdf("❤️")).toBe("?");
    expect(textePourPdf("Merci ❤️")).toBe("Merci ?");
  });

  it("joiners et espaces de largeur nulle isolés (U+200B, U+200C, U+200D) : supprimés", () => {
    expect(textePourPdf("a​b‌c‍d")).toBe("abcd");
  });

  it("drapeau (deux indicateurs régionaux) : deux '?'", () => {
    expect(textePourPdf("\u{1F1EB}\u{1F1F7}")).toBe("??");
  });

  it("chinois : un '?' par caractère", () => {
    expect(textePourPdf("你好")).toBe("??");
    expect(textePourPdf("Café 北京")).toBe("Café ??");
  });

  it("japonais (hiragana, katakana, kanji) : un '?' par caractère", () => {
    expect(textePourPdf("こんにちは")).toBe("?????");
    expect(textePourPdf("カタカナ")).toBe("????");
    expect(textePourPdf("日本語")).toBe("???");
  });

  it("point de code non attribué U+0378 (dans la plage grecque) : '?'", () => {
    expect(textePourPdf("͸")).toBe("?");
    expect(textePourPdf("a͸b")).toBe("a?b");
  });

  it("autres points de code non attribués de la plage grecque : '?'", () => {
    expect(textePourPdf("͹΀΋")).toBe("???");
  });

  it("texte mélangé : seules les parties hors police changent", () => {
    expect(textePourPdf("Привет 😀 ł 日本 é")).toBe("Привет ? ł ?? é");
  });
});

describe("textePourPdf : caractères de contrôle remplacés par une espace", () => {
  it("retour à la ligne, tabulation et NUL deviennent une espace", () => {
    expect(textePourPdf("a\nb")).toBe("a b");
    expect(textePourPdf("a\tb")).toBe("a b");
    expect(textePourPdf("a\u0000b")).toBe("a b");
  });

  it("\\r\\n donne deux espaces (un par caractère de contrôle)", () => {
    expect(textePourPdf("a\r\nb")).toBe("a  b");
  });

  it("DEL (U+007F) et contrôles C1 (U+0085) : une espace", () => {
    expect(textePourPdf("a\u007Fb\u0085c")).toBe("a b c");
  });

  it("contrôle seul ou en bordure : remplacé, pas supprimé", () => {
    expect(textePourPdf("\n")).toBe(" ");
    expect(textePourPdf("\tabc\n")).toBe(" abc ");
  });

  it("aucun caractère de contrôle ne subsiste dans le résultat", () => {
    let tout = "";
    for (let i = 0; i < 0x20; i++) tout += String.fromCharCode(i);
    expect(textePourPdf(tout)).not.toMatch(/\p{Cc}/u);
    expect(textePourPdf(tout)).toBe(" ".repeat(0x20));
  });
});

describe("textePourPdf : robustesse", () => {
  it("chaîne très longue de 10 000 caractères couverts : inchangée, sans exception", () => {
    const longue = "é".repeat(10_000);
    const resultat = textePourPdf(longue);
    expect(resultat).toBe(longue);
    expect(resultat).toHaveLength(10_000);
  });

  it("10 000 emojis : 10 000 '?'", () => {
    expect(textePourPdf("😀".repeat(10_000))).toBe("?".repeat(10_000));
  });

  it("10 000 caractères de types mélangés : sans exception, longueur attendue", () => {
    const motif = "aé😀\n日";
    const resultat = textePourPdf(motif.repeat(2_000));
    expect(resultat).toBe("aé? ?".repeat(2_000));
    expect(resultat).toHaveLength(10_000);
  });

  // Appliquer deux fois ne doit rien changer de plus : le "?" et l'espace sont eux-mêmes couverts.
  it.each([
    ["français", "Fête d'été à Zoé : 50 € « ok »"],
    ["emoji", "Pizza 🍕 ❤️"],
    ["emoji avec joiner", "\u{1F468}‍\u{1F469}‍\u{1F467}"],
    ["chinois et japonais", "你好 こんにちは"],
    ["contrôles", "a\nb\tc\u0000d"],
    ["non attribué", "a͸b"],
    ["accents combinants", "é ̀"],
    ["vide", ""],
  ])("idempotence (%s) : deux applications = une seule", (_, texte) => {
    const une = textePourPdf(texte);
    expect(textePourPdf(une)).toBe(une);
  });

  it("n'ajoute jamais de caractère hors police : le résultat est stable et ne contient ni emoji ni CJK", () => {
    const resultat = textePourPdf("a😀b日c‍d");
    expect(resultat).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(resultat).not.toMatch(/[぀-鿿]/);
    expect(resultat).toBe("a?b?cd");
  });
});

// ---------------------------------------------------------------------------
// construireRecapMensuel applique textePourPdf
// ---------------------------------------------------------------------------

describe("construireRecapMensuel : textePourPdf appliqué aux champs texte", () => {
  it("nom de colocation : emoji remplacé par '?'", () => {
    const recap = construireRecapMensuel(entree({ colocationNom: "Coloc 🏠 des Lilas" }));
    expect(recap.colocation.nom).toBe("Coloc ? des Lilas");
  });

  it("description d'une dépense : emoji remplacé, retour ligne remplacé par une espace", () => {
    const recap = construireRecapMensuel(
      entree({ depenses: [depense({ description: "Pizza 🍕\nsoirée" })] })
    );
    expect(recap.depenses[0].description).toBe("Pizza ? soirée");
  });

  it("nom d'un payeur : emoji remplacé par '?'", () => {
    const recap = construireRecapMensuel(
      entree({
        depenses: [depense()],
        nomsParId: new Map([["u1", "Alice 😎"]]),
      })
    );
    expect(recap.depenses[0].payeurs[0].nom).toBe("Alice ?");
  });

  it("nom d'un solde : emoji remplacé, autres champs du solde repris", () => {
    const soldes: SoldeMembre[] = [{ userId: "u1", name: "Alice 😎", amount: 12.5 }];
    const recap = construireRecapMensuel(entree({ soldes }));
    expect(recap.soldes).toEqual([{ userId: "u1", name: "Alice ?", amount: 12.5 }]);
  });

  it("noms d'un virement (de et a) : emojis remplacés", () => {
    const dettes: DetteSimplifiee[] = [
      { fromUserId: "u2", toUserId: "u1", fromName: "Bob 🎮", toName: "Alice 🎨", amount: 5 },
    ];
    const recap = construireRecapMensuel(entree({ dettes, soldes: MEMBRES }));
    expect(recap.virements[0].de).toBe("Bob ?");
    expect(recap.virements[0].a).toBe("Alice ?");
  });

  it("l'entrée n'est pas modifiée par le nettoyage", () => {
    const e = entree({
      colocationNom: "Coloc 🏠",
      depenses: [depense({ description: "Pizza 🍕" })],
      soldes: [{ userId: "u1", name: "Alice 😎", amount: 1 }],
    });
    const copie = structuredClone(e);
    construireRecapMensuel(e);
    expect(e).toEqual(copie);
  });

  it("le nom de repli 'Utilisateur supprimé' (avec accent) reste intact", () => {
    const recap = construireRecapMensuel(
      entree({ depenses: [depense({ payers: [{ userId: "fantome", amount: 10 }] })] })
    );
    expect(recap.depenses[0].payeurs[0].nom).toBe("Utilisateur supprimé");
  });

  it("un nom entièrement en emojis devient une suite de '?' (jamais vide)", () => {
    const recap = construireRecapMensuel(entree({ colocationNom: "🏠🏠🏠" }));
    expect(recap.colocation.nom).toBe("???");
  });
});
