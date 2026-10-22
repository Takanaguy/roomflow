import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { COUT_BCRYPT, motDePasseSchema } from "@/lib/auth-schemas";

const MESSAGE = "8 caractères minimum";

// Lit un fichier source de l'application, chemin relatif a src/lib.
const lireSource = (cheminRelatif: string) =>
  readFileSync(fileURLToPath(new URL(cheminRelatif, import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// motDePasseSchema
// ---------------------------------------------------------------------------

describe("motDePasseSchema : valeurs acceptees", () => {
  it("'12345678' (8 caracteres, la limite) : accepte", () => {
    expect(motDePasseSchema.safeParse("12345678").success).toBe(true);
  });

  it("9 caracteres : accepte", () => {
    expect(motDePasseSchema.safeParse("123456789").success).toBe(true);
  });

  it("128 caracteres : accepte", () => {
    expect(motDePasseSchema.safeParse("a".repeat(128)).success).toBe(true);
  });

  it("8 espaces : accepte (pas de trim dans le schema)", () => {
    // Documente le code actuel : le schema ne fait pas .trim(), donc huit
    // espaces comptent pour huit caracteres. Un mot de passe fait uniquement
    // d'espaces est donc valide.
    expect(motDePasseSchema.safeParse(" ".repeat(8)).success).toBe(true);
  });

  it("espaces autour conserves tels quels (le mot de passe n'est pas modifie)", () => {
    const r = motDePasseSchema.safeParse("  abcdefgh  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("  abcdefgh  ");
  });
});

describe("motDePasseSchema : valeurs refusees", () => {
  it("'1234567' (7 caracteres) : refuse avec le bon message", () => {
    const r = motDePasseSchema.safeParse("1234567");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0].message).toBe(MESSAGE);
    }
  });

  it("chaine vide : refusee avec le meme message", () => {
    const r = motDePasseSchema.safeParse("");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe(MESSAGE);
  });

  it("7 espaces : refuse", () => {
    expect(motDePasseSchema.safeParse(" ".repeat(7)).success).toBe(false);
  });

  it.each([
    ["un nombre", 12345678],
    ["null", null],
    ["undefined", undefined],
    ["un booleen", true],
    ["un tableau", ["12345678"]],
    ["un objet", { password: "12345678" }],
  ])("non-chaine (%s) : refuse", (_nom, valeur) => {
    expect(motDePasseSchema.safeParse(valeur).success).toBe(false);
  });
});

describe("motDePasseSchema : unicode", () => {
  it("Zod 4 compte en points de code, pas en unites UTF-16 : un emoji vaut 1", () => {
    // Documente le comportement reel (verifie avec Zod 4.5.4) : "😀".length
    // vaut 2 en JavaScript, mais le min(8) de Zod compte 1 par emoji. Il en
    // faut donc 8, pas 4. Ce n'est pas non plus un compte en graphemes :
    // "e" + accent combinant compte pour 2.
    expect("😀".length).toBe(2);
    expect(motDePasseSchema.safeParse("😀".repeat(8)).success).toBe(true);
    expect(motDePasseSchema.safeParse("😀".repeat(7)).success).toBe(false);
  });

  it("4 emojis (8 unites UTF-16 mais 4 points de code) : refuses", () => {
    expect(motDePasseSchema.safeParse("😀".repeat(4)).success).toBe(false);
  });

  it("'e' + accent combinant compte pour 2 : 4 repetitions suffisent", () => {
    expect(motDePasseSchema.safeParse("é".repeat(4)).success).toBe(true);
    expect(motDePasseSchema.safeParse("é".repeat(3)).success).toBe(false);
  });

  it("8 lettres accentuees : acceptees", () => {
    expect(motDePasseSchema.safeParse("éééééééé").success).toBe(true);
  });

  it("7 lettres accentuees : refusees", () => {
    expect(motDePasseSchema.safeParse("ééééééé").success).toBe(false);
  });
});

describe("motDePasseSchema : tres long (limite de 72 octets de bcrypt)", () => {
  it("100 caracteres (au-dela des 72 octets de bcrypt) : accepte, le schema n'a pas de maximum", () => {
    // Documente le comportement actuel, sans le changer : aucun .max() dans le
    // schema, donc un mot de passe de plus de 72 octets passe la validation.
    expect(motDePasseSchema.safeParse("a".repeat(100)).success).toBe(true);
  });

  it("10 000 caracteres : accepte aussi", () => {
    expect(motDePasseSchema.safeParse("a".repeat(10_000)).success).toBe(true);
  });

  it("consequence : bcrypt ne regarde que les 72 premiers octets", () => {
    // Cout 4 (le minimum) pour rester rapide : on teste ici la troncature de
    // bcrypt, pas son cout. Deux mots de passe qui ne different qu'apres le
    // 72e octet sont donc equivalents : limite connue, pas corrigee ici.
    const base = "a".repeat(72);
    const hash = bcrypt.hashSync(base, 4);
    expect(bcrypt.compareSync(base + "DIFFERENT", hash)).toBe(true);
    // Une difference AVANT le 72e octet est bien detectee.
    expect(bcrypt.compareSync("b" + base.slice(1), hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// COUT_BCRYPT
// ---------------------------------------------------------------------------

describe("COUT_BCRYPT", () => {
  it("vaut 12", () => {
    expect(COUT_BCRYPT).toBe(12);
  });

  it("un hash produit avec COUT_BCRYPT est verifiable par bcrypt.compare", async () => {
    // Cout 12 : environ 300 ms, accepte pour un seul test.
    const hash = await bcrypt.hash("MotDePasse-Test-1", COUT_BCRYPT);
    // Le cout est ecrit dans le hash lui-meme : "$2a$12$..." ou "$2b$12$...".
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("MotDePasse-Test-1", hash)).toBe(true);
    expect(await bcrypt.compare("MotDePasse-Test-2", hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coherence avec les routes (lecture du code source)
// ---------------------------------------------------------------------------

// Ces tests lisent le texte des fichiers : ils sont un peu fragiles (un
// renommage ou un changement de mise en forme les casse sans que le
// comportement change). Ils existent pour verifier que l'inscription et la
// reinitialisation partagent bien la meme regle, ce qu'aucun test de fonction
// pure ne peut voir.
describe("coherence : l'inscription utilise les memes regles", () => {
  const source = lireSource("../app/api/register/route.ts");

  it("importe COUT_BCRYPT et motDePasseSchema depuis auth-schemas", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bCOUT_BCRYPT\b[^}]*\bmotDePasseSchema\b[^}]*\}\s*from\s*["']@\/lib\/auth-schemas["']|import\s*\{[^}]*\bmotDePasseSchema\b[^}]*\bCOUT_BCRYPT\b[^}]*\}\s*from\s*["']@\/lib\/auth-schemas["']/
    );
  });

  it("valide le champ password avec motDePasseSchema", () => {
    expect(source).toMatch(/password:\s*motDePasseSchema/);
  });

  it("hache avec COUT_BCRYPT, sans cout ecrit en dur", () => {
    expect(source).toMatch(/bcrypt\.hash\([^)]*,\s*COUT_BCRYPT\s*\)/);
    expect(source).not.toMatch(/bcrypt\.hash\([^)]*,\s*\d+\s*\)/);
  });

  it("ne redefinit pas sa propre regle de longueur de mot de passe", () => {
    expect(source).not.toMatch(/password:\s*z\.string\(\)/);
  });
});

describe("coherence : la reinitialisation utilise le meme cout", () => {
  const source = lireSource("./password-reset.ts");

  it("importe COUT_BCRYPT depuis auth-schemas et hache avec", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bCOUT_BCRYPT\b[^}]*\}\s*from\s*["']@\/lib\/auth-schemas["']/);
    expect(source).toMatch(/bcrypt\.hash\([^)]*,\s*COUT_BCRYPT\s*\)/);
    expect(source).not.toMatch(/bcrypt\.hash\([^)]*,\s*\d+\s*\)/);
  });
});
