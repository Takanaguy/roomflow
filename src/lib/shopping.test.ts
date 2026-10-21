import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appliquerCoche, normaliserNomArticle, peutSupprimerArticle } from "@/lib/shopping";
import { champsArticle } from "@/lib/shopping-schemas";
import { VALEURS_CATEGORIES } from "@/lib/shopping-constants";

// Dates en ISO avec "Z" : le test ne depend jamais du fuseau de la machine.
const d = (iso: string) => new Date(iso);

describe("peutSupprimerArticle", () => {
  it("l'auteur de l'ajout peut supprimer", () => {
    expect(peutSupprimerArticle("A", "A", false)).toBe(true);
  });

  it("un admin peut supprimer l'article d'un autre", () => {
    expect(peutSupprimerArticle("A", "Z", true)).toBe(true);
  });

  it("ni auteur ni admin : refuse", () => {
    expect(peutSupprimerArticle("A", "Z", false)).toBe(false);
  });

  it("auteur et admin a la fois : vrai", () => {
    expect(peutSupprimerArticle("A", "A", true)).toBe(true);
  });

  // Un id qui ressemble a celui de l'auteur ne doit pas ouvrir le droit.
  it("la comparaison est exacte (casse et prefixe)", () => {
    expect(peutSupprimerArticle("abc", "ABC", false)).toBe(false);
    expect(peutSupprimerArticle("abc", "ab", false)).toBe(false);
    expect(peutSupprimerArticle("ab", "abc", false)).toBe(false);
  });

  it("une chaine vide n'est pas l'auteur", () => {
    expect(peutSupprimerArticle("A", "", false)).toBe(false);
    expect(peutSupprimerArticle("", "A", false)).toBe(false);
  });
});

describe("appliquerCoche", () => {
  const maintenant = d("2026-10-20T10:00:00Z");

  it("cocher : checked, checkedBy = userId, checkedAt = maintenant", () => {
    expect(appliquerCoche(true, "u1", maintenant)).toEqual({
      checked: true,
      checkedBy: "u1",
      checkedAt: maintenant,
    });
  });

  // null (et non undefined) : le resultat dit explicitement "champ a effacer".
  it("decocher : checkedBy et checkedAt valent null", () => {
    const res = appliquerCoche(false, "u1", maintenant);
    expect(res).toEqual({ checked: false, checkedBy: null, checkedAt: null });
    expect(res.checkedBy).toBeNull();
    expect(res.checkedAt).toBeNull();
  });

  it("decocher ignore userId et maintenant", () => {
    expect(appliquerCoche(false, "u1", d("2026-01-01T00:00:00Z"))).toEqual(
      appliquerCoche(false, "autre", d("2030-12-31T23:59:59Z"))
    );
  });

  it("cocher ne modifie pas la date passee", () => {
    const date = d("2026-10-20T10:00:00Z");
    const avant = date.getTime();
    appliquerCoche(true, "u1", date);
    expect(date.getTime()).toBe(avant);
  });

  it("decocher ne modifie pas la date passee", () => {
    const date = d("2026-10-20T10:00:00Z");
    const avant = date.getTime();
    appliquerCoche(false, "u1", date);
    expect(date.getTime()).toBe(avant);
  });

  it("cocher renvoie la date reçue (meme instant)", () => {
    expect(appliquerCoche(true, "u1", maintenant).checkedAt?.getTime()).toBe(maintenant.getTime());
  });

  it("cocher avec un userId vide le recopie tel quel", () => {
    expect(appliquerCoche(true, "", maintenant).checkedBy).toBe("");
  });
});

describe("normaliserNomArticle", () => {
  it("retire les espaces de debut et de fin", () => {
    expect(normaliserNomArticle("  lait  ")).toBe("lait");
  });

  it("reduit les espaces multiples a un seul", () => {
    expect(normaliserNomArticle("lait   demi    ecreme")).toBe("lait demi ecreme");
  });

  it("reduit tabulations et retours a la ligne a un seul espace", () => {
    expect(normaliserNomArticle("pain\t\tcomplet")).toBe("pain complet");
    expect(normaliserNomArticle("pain\ncomplet")).toBe("pain complet");
    expect(normaliserNomArticle("pain \r\n\t complet")).toBe("pain complet");
    expect(normaliserNomArticle("\t\npain\n\t")).toBe("pain");
  });

  it("chaine vide => \"\"", () => {
    expect(normaliserNomArticle("")).toBe("");
  });

  it("que des espaces (ou tabulations) => \"\"", () => {
    expect(normaliserNomArticle("     ")).toBe("");
    expect(normaliserNomArticle(" \t\n ")).toBe("");
  });

  it("conserve les accents et la casse", () => {
    expect(normaliserNomArticle("  Crème   Fraîche ")).toBe("Crème Fraîche");
    expect(normaliserNomArticle("ŒUFS  Bio")).toBe("ŒUFS Bio");
  });

  it("ne touche pas aux espaces uniques entre les mots", () => {
    expect(normaliserNomArticle("pates au beurre")).toBe("pates au beurre");
  });

  it("est idempotente", () => {
    for (const nom of ["  a   b ", "", "  ", "Crème\t\nFraîche", "deja propre"]) {
      const une = normaliserNomArticle(nom);
      expect(normaliserNomArticle(une)).toBe(une);
    }
  });
});

describe("schemas Zod de la liste de courses", () => {
  // Meme assemblage que la route de creation (courses/route.ts) : quantite et
  // categorie facultatives, nom obligatoire.
  const creation = z.object({
    name: champsArticle.name,
    quantity: champsArticle.quantity.optional(),
    category: champsArticle.category.optional(),
  });
  // Meme assemblage que la route de coche.
  const coche = z.object({ checked: champsArticle.checked });

  const messages = (res: { success: boolean; error?: z.ZodError }) =>
    res.error?.issues.map((i) => i.message) ?? [];

  describe("name", () => {
    it("est normalise : \"  a   b \" => \"a b\"", () => {
      const res = creation.parse({ name: "  a   b " });
      expect(res.name).toBe("a b");
    });

    it("nom vide => \"Nom requis\"", () => {
      const res = creation.safeParse({ name: "" });
      expect(res.success).toBe(false);
      expect(messages(res)).toContain("Nom requis");
    });

    it("nom fait d'espaces => \"Nom requis\"", () => {
      const res = creation.safeParse({ name: "     " });
      expect(res.success).toBe(false);
      expect(messages(res)).toContain("Nom requis");
    });

    it("nom absent est refuse", () => {
      expect(creation.safeParse({}).success).toBe(false);
    });

    it("nom null ou non texte est refuse", () => {
      expect(creation.safeParse({ name: null }).success).toBe(false);
      expect(creation.safeParse({ name: 42 }).success).toBe(false);
    });

    it("100 caracteres acceptes", () => {
      const nom = "a".repeat(100);
      const res = creation.safeParse({ name: nom });
      expect(res.success).toBe(true);
      expect(res.data?.name).toBe(nom);
    });

    it("101 caracteres refuses avec le bon message", () => {
      const res = creation.safeParse({ name: "a".repeat(101) });
      expect(res.success).toBe(false);
      expect(messages(res)).toContain("Nom trop long (100 caractères max)");
    });

    // La longueur est verifiee APRES normalisation, comme dit le commentaire du schema.
    it("la longueur s'entend apres normalisation (espaces autour ignores)", () => {
      const nom = `   ${"a".repeat(100)}   `;
      expect(creation.safeParse({ name: nom }).success).toBe(true);
    });

    it("la longueur s'entend apres reduction des espaces multiples", () => {
      // 50 + 10 espaces + 49 = 109 brut, 100 une fois les espaces reduits a un.
      const nom = `${"a".repeat(50)}${" ".repeat(10)}${"b".repeat(49)}`;
      const res = creation.safeParse({ name: nom });
      expect(res.success).toBe(true);
      expect(res.data?.name.length).toBe(100);
    });
  });

  describe("quantity", () => {
    it("30 caracteres acceptes", () => {
      expect(creation.safeParse({ name: "x", quantity: "q".repeat(30) }).success).toBe(true);
    });

    it("31 caracteres refuses avec le bon message", () => {
      const res = creation.safeParse({ name: "x", quantity: "q".repeat(31) });
      expect(res.success).toBe(false);
      expect(messages(res)).toContain("Quantité trop longue (30 caractères max)");
    });

    it("absente est acceptee", () => {
      const res = creation.safeParse({ name: "x" });
      expect(res.success).toBe(true);
      expect(res.data?.quantity).toBeUndefined();
    });

    it("null est refusee (seul \"absent\" passe)", () => {
      expect(creation.safeParse({ name: "x", quantity: null }).success).toBe(false);
    });

    it("un nombre est refuse", () => {
      expect(creation.safeParse({ name: "x", quantity: 2 }).success).toBe(false);
    });

    it("les espaces autour sont retires avant la verification de longueur", () => {
      const res = creation.safeParse({ name: "x", quantity: `  ${"q".repeat(30)}  ` });
      expect(res.success).toBe(true);
      expect(res.data?.quantity).toBe("q".repeat(30));
    });
  });

  describe("category", () => {
    it.each(VALEURS_CATEGORIES)("categorie valide acceptee : %s", (categorie) => {
      const res = creation.safeParse({ name: "x", category: categorie });
      expect(res.success).toBe(true);
      expect(res.data?.category).toBe(categorie);
    });

    it("hors liste refusee avec le bon message", () => {
      const res = creation.safeParse({ name: "x", category: "surgeles" });
      expect(res.success).toBe(false);
      expect(messages(res)).toContain("Catégorie invalide");
    });

    it("la casse et les espaces comptent : \"Frais\" et \" frais\" refuses", () => {
      expect(creation.safeParse({ name: "x", category: "Frais" }).success).toBe(false);
      expect(creation.safeParse({ name: "x", category: " frais" }).success).toBe(false);
    });

    it("chaine vide refusee", () => {
      expect(creation.safeParse({ name: "x", category: "" }).success).toBe(false);
    });

    it("absente est acceptee", () => {
      const res = creation.safeParse({ name: "x" });
      expect(res.success).toBe(true);
      expect(res.data?.category).toBeUndefined();
    });

    it("null est refusee (seul \"absent\" passe)", () => {
      expect(creation.safeParse({ name: "x", category: null }).success).toBe(false);
    });
  });

  describe("checked", () => {
    it("true et false sont acceptes", () => {
      expect(coche.parse({ checked: true })).toEqual({ checked: true });
      expect(coche.parse({ checked: false })).toEqual({ checked: false });
    });

    it("la chaine \"true\" est refusee", () => {
      expect(coche.safeParse({ checked: "true" }).success).toBe(false);
    });

    it("0, 1, null et absent sont refuses", () => {
      expect(coche.safeParse({ checked: 0 }).success).toBe(false);
      expect(coche.safeParse({ checked: 1 }).success).toBe(false);
      expect(coche.safeParse({ checked: null }).success).toBe(false);
      expect(coche.safeParse({}).success).toBe(false);
    });

    it("renvoie le message en francais sur un mauvais type", () => {
      const res = coche.safeParse({ checked: "true" });
      expect(messages(res)).toContain("Le champ « checked » doit être vrai ou faux");
    });
  });
});
