import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { COUT_BCRYPT, HASH_BCRYPT_BIDON, motDePasseSchema } from "@/lib/auth-schemas";

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
    // Delai explicite : en parallele avec les 20 autres fichiers, trois calculs de
    // cout 12 depassent les 5 s par defaut (echec intermittent constate).
  }, 30_000);
});

// ---------------------------------------------------------------------------
// HASH_BCRYPT_BIDON
// ---------------------------------------------------------------------------

// Chronometre une comparaison bcrypt, en ms.
async function dureeCompare(motDePasse: string, hash: string): Promise<number> {
  const debut = performance.now();
  await bcrypt.compare(motDePasse, hash);
  return performance.now() - debut;
}

describe("HASH_BCRYPT_BIDON : forme", () => {
  // Format bcrypt : "$" + version + "$" + cout sur 2 chiffres + "$" + 53
  // caracteres (22 de sel + 31 de hash). On decoupe le texte au lieu d'ecrire
  // le cout 12 en dur : le test suit COUT_BCRYPT si on le change un jour.
  const [vide, version, cout, reste] = HASH_BCRYPT_BIDON.split("$");

  it("commence par '$' (le premier morceau avant le '$' est vide)", () => {
    expect(vide).toBe("");
  });

  it("version bcrypt reconnue ('2a', '2b' ou '2y')", () => {
    expect(["2a", "2b", "2y"]).toContain(version);
  });

  it("le cout ecrit apres le 2e '$' vaut COUT_BCRYPT (lu par parsing, pas par regex figee)", () => {
    expect(cout).toMatch(/^\d{2}$/);
    expect(Number(cout)).toBe(COUT_BCRYPT);
  });

  it("le cout lu par bcryptjs lui-meme est COUT_BCRYPT", () => {
    expect(bcrypt.getRounds(HASH_BCRYPT_BIDON)).toBe(COUT_BCRYPT);
  });

  it("longueur 60 caracteres", () => {
    expect(HASH_BCRYPT_BIDON).toHaveLength(60);
  });

  it("apres le cout : 53 caracteres de l'alphabet bcrypt (sel + hash)", () => {
    expect(reste).toHaveLength(53);
    expect(reste).toMatch(/^[./A-Za-z0-9]{53}$/);
  });

  it("exactement 4 morceaux separes par '$' (pas de '$' parasite)", () => {
    expect(HASH_BCRYPT_BIDON.split("$")).toHaveLength(4);
  });

  it("meme version et meme cout qu'un vrai hash produit par bcrypt.hash", async () => {
    const vrai = await bcrypt.hash("MotDePasse-Test-1", COUT_BCRYPT);
    const [, versionVraie, coutVrai] = vrai.split("$");
    expect(coutVrai).toBe(cout);
    // La version peut differer d'une lettre selon la bibliotheque ("2a"/"2b") ;
    // ce qui compte pour le temps de calcul est le cout. On verifie seulement
    // que les deux sont dans la meme famille 2x.
    expect(versionVraie).toMatch(/^2[aby]$/);
    expect(version).toMatch(/^2[aby]$/);
  }, 30_000);
});

describe("HASH_BCRYPT_BIDON : comparaison", () => {
  it("bcrypt.compare('n-importe-quoi', hash bidon) : false, sans exception", async () => {
    await expect(bcrypt.compare("n-importe-quoi", HASH_BCRYPT_BIDON)).resolves.toBe(false);
  });

  it("un mot de passe plausible : false aussi", async () => {
    await expect(bcrypt.compare("MotDePasse-Plausible-123!", HASH_BCRYPT_BIDON)).resolves.toBe(
      false
    );
  });

  it("mot de passe vide : false, sans exception", async () => {
    await expect(bcrypt.compare("", HASH_BCRYPT_BIDON)).resolves.toBe(false);
  });

  it("mots de passe courants ('password', '12345678') : false", async () => {
    await expect(bcrypt.compare("password", HASH_BCRYPT_BIDON)).resolves.toBe(false);
    await expect(bcrypt.compare("12345678", HASH_BCRYPT_BIDON)).resolves.toBe(false);
  });

  it("le hash est un vrai hash bcrypt : bcrypt.compare ne le rejette pas comme 'illisible'", async () => {
    // bcryptjs renvoie false (sans calcul) pour un hash de mauvaise longueur
    // ou de mauvais format. Si le hash bidon etait abime, la comparaison serait
    // instantanee et on perdrait l'egalisation du temps de reponse : c'est ce
    // que le test de duree ci-dessous attrape.
    expect(HASH_BCRYPT_BIDON).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
  });
});

describe("HASH_BCRYPT_BIDON : temps de calcul", () => {
  // Les durees dependent de la machine : on ne fixe aucune borne haute en
  // millisecondes absolues. On compare au temps d'un vrai hash du MEME cout
  // calcule sur la meme machine au meme moment, ce qui annule la vitesse de la
  // machine. Le minimum de deux mesures limite l'effet d'un pic de charge.
  it("la comparaison prend un vrai temps de calcul de cout 12 (borne basse seulement)", async () => {
    const t = Math.min(
      await dureeCompare("n-importe-quoi", HASH_BCRYPT_BIDON),
      await dureeCompare("n-importe-quoi", HASH_BCRYPT_BIDON)
    );
    // Un cout 4 ou un hash rejete sans calcul prendrait 1 a 5 ms. Le cout 12
    // demande 4096 fois plus de travail que le cout 4 : meme sur une machine
    // tres rapide, on depasse largement 20 ms.
    expect(t).toBeGreaterThan(20);
  }, 30_000);

  it("meme ordre de grandeur que la comparaison avec un vrai hash de meme cout", async () => {
    const vrai = await bcrypt.hash("MotDePasse-Test-1", COUT_BCRYPT);
    const tBidon = Math.min(
      await dureeCompare("MotDePasse-Test-2", HASH_BCRYPT_BIDON),
      await dureeCompare("MotDePasse-Test-2", HASH_BCRYPT_BIDON)
    );
    const tVrai = Math.min(
      await dureeCompare("MotDePasse-Test-2", vrai),
      await dureeCompare("MotDePasse-Test-2", vrai)
    );
    // Facteur 3 dans les deux sens : large pour ne pas casser sur une machine
    // chargee, mais un hash de cout 10 (4 fois moins de travail) ou de cout 14
    // (4 fois plus) depasserait ce facteur.
    const ratio = tBidon / tVrai;
    expect(ratio).toBeGreaterThan(1 / 3);
    expect(ratio).toBeLessThan(3);
  }, 60_000);
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
