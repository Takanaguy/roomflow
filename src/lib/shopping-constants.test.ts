import { describe, expect, it } from "vitest";
import {
  CATEGORIES_COURSES,
  grouperParCategorie,
  LIBELLE_SANS_CATEGORIE,
  libelleCategorie,
  VALEURS_CATEGORIES,
} from "@/lib/shopping-constants";

// Article minimal : grouperParCategorie ne lit que `category`, le reste sert a
// reconnaitre chaque article dans les assertions.
const art = (id: string, category: string | null) => ({ id, category });

describe("VALEURS_CATEGORIES et CATEGORIES_COURSES", () => {
  it("contiennent 7 categories", () => {
    expect(VALEURS_CATEGORIES).toHaveLength(7);
    expect(CATEGORIES_COURSES).toHaveLength(7);
  });

  it("sans doublon", () => {
    expect(new Set(VALEURS_CATEGORIES).size).toBe(VALEURS_CATEGORIES.length);
    expect(new Set(CATEGORIES_COURSES.map((c) => c.label)).size).toBe(CATEGORIES_COURSES.length);
  });

  // Les deux listes servent a des endroits differents (base/Zod d'un cote,
  // menu de l'UI de l'autre) : si elles divergeaient, l'UI proposerait une
  // valeur que l'API refuse.
  it("sont alignees : memes valeurs dans le meme ordre", () => {
    expect(CATEGORIES_COURSES.map((c) => c.value)).toEqual([...VALEURS_CATEGORIES]);
  });

  it("l'ordre est celui de l'affichage", () => {
    expect([...VALEURS_CATEGORIES]).toEqual([
      "fruits-legumes",
      "frais",
      "epicerie",
      "boissons",
      "hygiene",
      "entretien",
      "autre",
    ]);
  });

  it("aucun libelle n'est vide", () => {
    for (const { label } of CATEGORIES_COURSES) {
      expect(label.trim()).not.toBe("");
    }
  });
});

describe("libelleCategorie", () => {
  it.each([
    ["fruits-legumes", "Fruits et légumes"],
    ["frais", "Frais"],
    ["epicerie", "Épicerie"],
    ["boissons", "Boissons"],
    ["hygiene", "Hygiène"],
    ["entretien", "Entretien"],
    ["autre", "Autre"],
  ])("%s => %s", (valeur, libelle) => {
    expect(libelleCategorie(valeur)).toBe(libelle);
  });

  it("la constante LIBELLE_SANS_CATEGORIE vaut \"Sans catégorie\"", () => {
    expect(LIBELLE_SANS_CATEGORIE).toBe("Sans catégorie");
  });

  it("null, undefined et chaine vide => Sans catégorie", () => {
    expect(libelleCategorie(null)).toBe("Sans catégorie");
    expect(libelleCategorie(undefined)).toBe("Sans catégorie");
    expect(libelleCategorie("")).toBe("Sans catégorie");
  });

  it("valeur inconnue => Sans catégorie", () => {
    expect(libelleCategorie("surgeles")).toBe("Sans catégorie");
  });

  // Meme exigence d'exactitude que pour les ids : pas de tolerance sur la
  // casse ni sur les espaces autour.
  it("la comparaison est exacte (casse, espaces)", () => {
    expect(libelleCategorie("FRAIS")).toBe("Sans catégorie");
    expect(libelleCategorie("Frais")).toBe("Sans catégorie");
    expect(libelleCategorie(" frais")).toBe("Sans catégorie");
  });

  // Les cles de l'objet interne ne doivent pas se laisser atteindre par le
  // prototype ("constructor", "toString"...) : sinon un libelle absurde sortirait.
  it("les noms de proprietes heritees d'Object ne sont pas des categories", () => {
    expect(libelleCategorie("constructor")).toBe("Sans catégorie");
    expect(libelleCategorie("toString")).toBe("Sans catégorie");
    expect(libelleCategorie("__proto__")).toBe("Sans catégorie");
  });
});

describe("grouperParCategorie", () => {
  it("liste vide => []", () => {
    expect(grouperParCategorie([])).toEqual([]);
  });

  it("un seul article => un seul groupe avec le bon libelle", () => {
    const a = art("1", "boissons");
    expect(grouperParCategorie([a])).toEqual([
      { category: "boissons", label: "Boissons", articles: [a] },
    ]);
  });

  // Cas cle : les articles arrivent dans le desordre, les groupes sortent dans
  // l'ordre fixe des categories.
  it("les groupes suivent l'ordre fixe des categories, pas l'ordre d'apparition", () => {
    const groupes = grouperParCategorie([
      art("1", "autre"),
      art("2", "boissons"),
      art("3", "fruits-legumes"),
      art("4", "entretien"),
      art("5", "frais"),
    ]);
    expect(groupes.map((g) => g.category)).toEqual([
      "fruits-legumes",
      "frais",
      "boissons",
      "entretien",
      "autre",
    ]);
  });

  it("\"Sans catégorie\" (category null) est toujours en dernier", () => {
    const groupes = grouperParCategorie([
      art("1", null),
      art("2", "autre"),
      art("3", "fruits-legumes"),
    ]);
    expect(groupes.map((g) => g.category)).toEqual(["fruits-legumes", "autre", null]);
    expect(groupes[2].label).toBe("Sans catégorie");
  });

  it("les groupes vides sont omis", () => {
    const groupes = grouperParCategorie([art("1", "hygiene"), art("2", "hygiene")]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].category).toBe("hygiene");
  });

  it("pas de groupe \"Sans catégorie\" s'il n'y a aucun article sans categorie", () => {
    const groupes = grouperParCategorie([art("1", "frais")]);
    expect(groupes.some((g) => g.category === null)).toBe(false);
  });

  it("l'ordre d'entree est conserve a l'interieur d'un groupe", () => {
    const groupes = grouperParCategorie([
      art("c", "frais"),
      art("x", "boissons"),
      art("a", "frais"),
      art("b", "frais"),
    ]);
    const frais = groupes.find((g) => g.category === "frais");
    expect(frais?.articles.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("une categorie inconnue est rangee dans \"Sans catégorie\"", () => {
    const groupes = grouperParCategorie([
      art("1", "surgeles"),
      art("2", null),
      art("3", ""),
      art("4", "FRAIS"),
    ]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].category).toBeNull();
    expect(groupes[0].label).toBe("Sans catégorie");
    // Ordre d'entree conserve aussi entre inconnu, null et vide.
    expect(groupes[0].articles.map((a) => a.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("une propriete heritee d'Object comme categorie ne casse rien", () => {
    const groupes = grouperParCategorie([art("1", "constructor"), art("2", "__proto__")]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].category).toBeNull();
    expect(groupes[0].articles).toHaveLength(2);
  });

  it("chaque categorie connue donne un groupe avec son libelle", () => {
    const groupes = grouperParCategorie(VALEURS_CATEGORIES.map((c) => art(c, c)));
    expect(groupes).toHaveLength(7);
    groupes.forEach((g, i) => {
      expect(g.category).toBe(CATEGORIES_COURSES[i].value);
      expect(g.label).toBe(CATEGORIES_COURSES[i].label);
    });
  });

  it("ne modifie pas le tableau d'entree", () => {
    const entree = [art("1", "autre"), art("2", null), art("3", "frais")];
    const copie = entree.map((a) => ({ ...a }));
    grouperParCategorie(entree);
    expect(entree).toEqual(copie);
    expect(entree).toHaveLength(3);
  });

  it("accepte un tableau readonly", () => {
    const entree: readonly { id: string; category: string | null }[] = Object.freeze([
      art("1", "frais"),
      art("2", null),
    ]);
    expect(grouperParCategorie(entree)).toHaveLength(2);
  });

  it("garde les objets d'origine (meme reference) et leurs autres champs", () => {
    const a = { id: "1", category: "frais", name: "Lait", checked: false, quantite: 2 };
    const groupes = grouperParCategorie([a]);
    expect(groupes[0].articles[0]).toBe(a);
    expect(groupes[0].articles[0].name).toBe("Lait");
  });

  // Rien ne doit disparaitre de l'ecran, quelle que soit la categorie.
  describe("aucun article perdu", () => {
    const total = (groupes: ReturnType<typeof grouperParCategorie>) =>
      groupes.reduce((somme, g) => somme + g.articles.length, 0);

    it("jeu fixe melangeant categories connues, null et inconnues", () => {
      const entree = [
        art("1", "frais"),
        art("2", null),
        art("3", "inconnue"),
        art("4", "autre"),
        art("5", "frais"),
        art("6", ""),
        art("7", "boissons"),
      ];
      expect(total(grouperParCategorie(entree))).toBe(entree.length);
    });

    it("200 jeux pseudo-aleatoires (graine fixe) : total conserve, ordre et tri respectes", () => {
      // Generateur congruentiel a graine fixe : reproductible, contrairement a
      // Math.random, qui rendrait un echec impossible a rejouer.
      let graine = 424242;
      const suivant = () => {
        graine = (graine * 1103515245 + 12345) % 2147483648;
        return graine;
      };
      const choix: (string | null)[] = [...VALEURS_CATEGORIES, null, "inconnue", ""];

      for (let essai = 0; essai < 200; essai++) {
        const n = suivant() % 40;
        const entree = Array.from({ length: n }, (_, i) =>
          art(`a${i}`, choix[suivant() % choix.length])
        );

        const groupes = grouperParCategorie(entree);

        // Aucun article perdu ni duplique.
        expect(total(groupes)).toBe(n);
        const ids = groupes.flatMap((g) => g.articles.map((a) => a.id));
        expect(new Set(ids).size).toBe(n);

        // Pas de groupe vide.
        expect(groupes.every((g) => g.articles.length > 0)).toBe(true);

        // Ordre des groupes : celui des categories, null en dernier.
        const positions = groupes.map((g) =>
          g.category === null
            ? VALEURS_CATEGORIES.length
            : VALEURS_CATEGORIES.indexOf(g.category)
        );
        expect([...positions].sort((x, y) => x - y)).toEqual(positions);
        expect(new Set(positions).size).toBe(positions.length);

        // Ordre d'entree conserve dans chaque groupe (les ids a<i> croissent).
        for (const g of groupes) {
          const indices = g.articles.map((a) => Number(a.id.slice(1)));
          expect([...indices].sort((x, y) => x - y)).toEqual(indices);
        }
      }
    });
  });
});
