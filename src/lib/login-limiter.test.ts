import { describe, expect, it } from "vitest";
import {
  FENETRE_MINUTES,
  LONGUEUR_MAX_EMAIL,
  MAX_TENTATIVES_EMAIL,
  MAX_TENTATIVES_IP,
  cleEmail,
  cleIp,
  emailUtilisableCommeCle,
  extraireIp,
  fenetreTerminee,
  normaliserIp,
  tentativeAutorisee,
} from "@/lib/login-limiter";

// Seules les fonctions pures sont testees ici. Importer login-limiter.ts charge
// aussi le client Mongo et le modele LoginAttempt, mais sans aucune connexion :
// connectDB() n'est appelee que par reserverTentative et reinitialiserCompteur,
// que ce fichier n'appelle jamais.

// Dates ecrites en ISO avec "Z" : le test ne depend jamais du fuseau de la
// machine, ni de l'horloge reelle.
const d = (iso: string) => new Date(iso);
const DEBUT = d("2026-10-21T12:00:00.000Z");
const QUINZE_MIN_MS = 15 * 60_000;
const apres = (date: Date, ms: number) => new Date(date.getTime() + ms);

// Faux en-tetes STRICTS : seul le nom exact connu est trouve (comme une Map),
// et chaque nom demande est enregistre. Un vrai objet Headers ignore la casse,
// ce qui masquerait une faute du genre "X-Forwarded-For" dans le code.
function enTetes(valeurs: Record<string, string | null>) {
  const demandes: string[] = [];
  return {
    demandes,
    get(nom: string): string | null {
      demandes.push(nom);
      return Object.hasOwn(valeurs, nom) ? valeurs[nom] : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

describe("constantes du limiteur de connexion", () => {
  it("5 tentatives par email", () => {
    expect(MAX_TENTATIVES_EMAIL).toBe(5);
  });

  it("20 tentatives par IP", () => {
    expect(MAX_TENTATIVES_IP).toBe(20);
  });

  it("fenetre de 15 minutes", () => {
    expect(FENETRE_MINUTES).toBe(15);
  });

  it("la limite par IP est plus large que par email (plusieurs comptes derriere une meme IP)", () => {
    expect(MAX_TENTATIVES_IP).toBeGreaterThan(MAX_TENTATIVES_EMAIL);
  });
});

// ---------------------------------------------------------------------------
// cleEmail
// ---------------------------------------------------------------------------

describe("cleEmail", () => {
  it("prefixe la cle par 'email:'", () => {
    expect(cleEmail("test@x.fr")).toBe("email:test@x.fr");
  });

  it("normalise la casse et les espaces : '  Test@X.fr ' == 'test@x.fr'", () => {
    expect(cleEmail("  Test@X.fr ")).toBe(cleEmail("test@x.fr"));
    expect(cleEmail("  Test@X.fr ")).toBe("email:test@x.fr");
  });

  it("majuscules seules : meme cle (sinon on doublerait la limite en changeant la casse)", () => {
    expect(cleEmail("TEST@X.FR")).toBe(cleEmail("test@x.fr"));
  });

  it("tabulation et retour a la ligne autour : retires aussi", () => {
    expect(cleEmail("\ttest@x.fr\n")).toBe("email:test@x.fr");
  });

  it("deux emails differents : cles differentes", () => {
    expect(cleEmail("a@x.fr")).not.toBe(cleEmail("b@x.fr"));
  });

  it("meme local-part sur deux domaines : cles differentes", () => {
    expect(cleEmail("a@x.fr")).not.toBe(cleEmail("a@y.fr"));
  });

  it("espace a l'interieur conserve : pas de fusion de deux adresses", () => {
    expect(cleEmail("a b@x.fr")).not.toBe(cleEmail("ab@x.fr"));
  });

  it("chaine vide : renvoie juste le prefixe, sans exception", () => {
    expect(cleEmail("")).toBe("email:");
  });

  it("chaine d'espaces : meme cle que la chaine vide", () => {
    expect(cleEmail("   ")).toBe(cleEmail(""));
  });

  it("ne melange pas avec une cle IP, meme pour une valeur identique", () => {
    expect(cleEmail("1.1.1.1")).not.toBe(cleIp("1.1.1.1"));
  });
});

// ---------------------------------------------------------------------------
// cleIp
// ---------------------------------------------------------------------------

describe("cleIp", () => {
  it("prefixe la cle par 'ip:'", () => {
    expect(cleIp("1.1.1.1")).toBe("ip:1.1.1.1");
  });

  it("deux IP differentes : cles differentes", () => {
    expect(cleIp("1.1.1.1")).not.toBe(cleIp("1.1.1.2"));
  });

  it("IPv6 : ramenee a son prefixe /64 (forme canonique de normaliserIp) apres le prefixe", () => {
    expect(cleIp("2001:db8::1")).toBe("ip:2001:db8:0:0::/64");
  });

  it("normalisation de casse : '2001:DB8::1' et '2001:db8::1' donnent la meme cle", () => {
    // Meme adresse, deux ecritures : un seul compteur (voir normaliserIp).
    expect(cleIp("2001:DB8::1")).toBe(cleIp("2001:db8::1"));
  });
});

// ---------------------------------------------------------------------------
// emailUtilisableCommeCle
// ---------------------------------------------------------------------------

// Email bien forme d'une longueur exacte : partie locale en "a", domaine fixe.
const emailDeLongueur = (n: number) => "a".repeat(n - "@x.fr".length) + "@x.fr";

describe("emailUtilisableCommeCle : cas valides", () => {
  it("email normal : vrai", () => {
    expect(emailUtilisableCommeCle("test@x.fr")).toBe(true);
  });

  it("email avec sous-domaine, point, plus et tiret : vrai (volontairement large)", () => {
    expect(emailUtilisableCommeCle("jean.dupont+roomflow@mail.sous-domaine.example.com")).toBe(true);
  });

  it("domaine sans point ('a@b') : vrai (la forme minimale n'exige pas de point)", () => {
    expect(emailUtilisableCommeCle("a@b")).toBe(true);
  });
});

describe("emailUtilisableCommeCle : frontiere de longueur", () => {
  it("LONGUEUR_MAX_EMAIL vaut 254 (RFC 5321)", () => {
    expect(LONGUEUR_MAX_EMAIL).toBe(254);
  });

  it("254 caracteres, bien forme : vrai", () => {
    const email = emailDeLongueur(254);
    expect(email).toHaveLength(254);
    expect(emailUtilisableCommeCle(email)).toBe(true);
  });

  it("255 caracteres, bien forme : faux", () => {
    const email = emailDeLongueur(255);
    expect(email).toHaveLength(255);
    expect(emailUtilisableCommeCle(email)).toBe(false);
  });

  it("tres long (100 000 caracteres) : faux, sans exception", () => {
    expect(emailUtilisableCommeCle(emailDeLongueur(100_000))).toBe(false);
  });
});

describe("emailUtilisableCommeCle : cas refuses", () => {
  it("sans @ : faux", () => {
    expect(emailUtilisableCommeCle("test.x.fr")).toBe(false);
  });

  it("avec un espace au milieu : faux", () => {
    expect(emailUtilisableCommeCle("te st@x.fr")).toBe(false);
    expect(emailUtilisableCommeCle("test@x .fr")).toBe(false);
  });

  it("espace au debut ou a la fin : faux (la valeur doit deja etre trimee)", () => {
    expect(emailUtilisableCommeCle(" test@x.fr")).toBe(false);
    expect(emailUtilisableCommeCle("test@x.fr ")).toBe(false);
  });

  it("tabulation ou retour a la ligne : faux", () => {
    expect(emailUtilisableCommeCle("te\tst@x.fr")).toBe(false);
    expect(emailUtilisableCommeCle("test@x.fr\n")).toBe(false);
  });

  it("chaine vide : faux", () => {
    expect(emailUtilisableCommeCle("")).toBe(false);
  });

  it("'@x' (partie locale vide) : faux", () => {
    expect(emailUtilisableCommeCle("@x")).toBe(false);
  });

  it("'x@' (domaine vide) : faux", () => {
    expect(emailUtilisableCommeCle("x@")).toBe(false);
  });

  it("'@' seul : faux", () => {
    expect(emailUtilisableCommeCle("@")).toBe(false);
  });

  it("deux @ ('a@b@c') : faux", () => {
    expect(emailUtilisableCommeCle("a@b@c")).toBe(false);
  });

  it("valeur qui n'est pas une chaine (null, undefined, nombre) : faux, sans exception", () => {
    expect(emailUtilisableCommeCle(null as unknown as string)).toBe(false);
    expect(emailUtilisableCommeCle(undefined as unknown as string)).toBe(false);
    expect(emailUtilisableCommeCle(42 as unknown as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normaliserIp
// ---------------------------------------------------------------------------

describe("normaliserIp : IPv4", () => {
  it("IPv4 : inchangee", () => {
    expect(normaliserIp("1.2.3.4")).toBe("1.2.3.4");
    expect(normaliserIp("192.168.0.1")).toBe("192.168.0.1");
    expect(normaliserIp("255.255.255.255")).toBe("255.255.255.255");
    expect(normaliserIp("0.0.0.0")).toBe("0.0.0.0");
  });
});

describe("normaliserIp : IPv4 mappee en IPv6", () => {
  it("'::ffff:1.2.3.4' donne '1.2.3.4'", () => {
    expect(normaliserIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("forme hexadecimale '::ffff:102:304' donne '1.2.3.4'", () => {
    expect(normaliserIp("::ffff:102:304")).toBe("1.2.3.4");
  });

  it("les deux ecritures d'une meme machine donnent la meme valeur (un seul compteur)", () => {
    expect(normaliserIp("::ffff:1.2.3.4")).toBe(normaliserIp("::ffff:102:304"));
    expect(normaliserIp("::ffff:1.2.3.4")).toBe(normaliserIp("1.2.3.4"));
  });

  it("majuscules : '::FFFF:1.2.3.4' donne '1.2.3.4'", () => {
    expect(normaliserIp("::FFFF:1.2.3.4")).toBe("1.2.3.4");
  });

  it("forme developpee '0:0:0:0:0:ffff:102:304' donne '1.2.3.4'", () => {
    expect(normaliserIp("0:0:0:0:0:ffff:102:304")).toBe("1.2.3.4");
  });

  it("octets extremes : '::ffff:255.255.255.255' et '::ffff:0.0.0.0'", () => {
    expect(normaliserIp("::ffff:255.255.255.255")).toBe("255.255.255.255");
    expect(normaliserIp("::ffff:0.0.0.0")).toBe("0.0.0.0");
  });

  it("IPv4 finale mais pas le prefixe 'ffff' ('64:ff9b::1.2.3.4') : traitee comme IPv6 ordinaire, pas comme mappee", () => {
    expect(normaliserIp("64:ff9b::1.2.3.4")).toBe("64:ff9b:0:0::/64");
  });
});

describe("normaliserIp : IPv6 ramenee a son prefixe /64", () => {
  it("'2001:DB8::1' donne '2001:db8:0:0::/64' (minuscules, sans zeros de tete)", () => {
    expect(normaliserIp("2001:DB8::1")).toBe("2001:db8:0:0::/64");
  });

  it("forme developpee avec zeros de tete : meme resultat", () => {
    expect(normaliserIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0:0::/64");
  });

  it("exemple du commentaire du code : '2A01:E0A:100B:B220:1:2:3:4'", () => {
    expect(normaliserIp("2A01:E0A:100B:B220:1:2:3:4")).toBe("2a01:e0a:100b:b220::/64");
  });

  it("deux adresses du meme /64 : meme cle", () => {
    expect(normaliserIp("2001:db8:1:2::1")).toBe(normaliserIp("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(normaliserIp("2001:db8:1:2::1")).toBe(normaliserIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
  });

  it("deux /64 differents : cles differentes (4e groupe different)", () => {
    expect(normaliserIp("2001:db8:1:2::1")).not.toBe(normaliserIp("2001:db8:1:3::1"));
  });

  it("deux /64 differents : cles differentes (1er groupe different)", () => {
    expect(normaliserIp("2001:db8:1:2::1")).not.toBe(normaliserIp("2002:db8:1:2::1"));
  });

  it("'::' compris dans les 4 premiers groupes est bien developpe ('2001::1' donne '2001:0:0:0::/64')", () => {
    expect(normaliserIp("2001::1")).toBe("2001:0:0:0::/64");
  });

  it("'::' en tete : '::1' (boucle locale) donne '0:0:0:0::/64'", () => {
    expect(normaliserIp("::1")).toBe("0:0:0:0::/64");
  });

  it("'::' seul : '0:0:0:0::/64'", () => {
    expect(normaliserIp("::")).toBe("0:0:0:0::/64");
  });

  it("'::' a la fin : '2001:db8:1:2::' donne '2001:db8:1:2::/64'", () => {
    expect(normaliserIp("2001:db8:1:2::")).toBe("2001:db8:1:2::/64");
  });

  it("'::' qui ne remplace qu'un seul groupe ('1:2:3:4:5:6:7::') est accepte", () => {
    expect(normaliserIp("1:2:3:4:5:6:7::")).toBe("1:2:3:4::/64");
  });

  it("la valeur rendue se termine par '::/64' pour toute IPv6 valide non mappee", () => {
    for (const ip of ["fe80::1", "2a01:e0a::5", "fd00:1:2:3:4:5:6:7", "ff02::1"]) {
      expect(normaliserIp(ip)).toMatch(/::\/64$/);
    }
  });
});

describe("normaliserIp : entrees invalides renvoyees telles quelles", () => {
  it("'fe80::1%eth0' (identifiant de zone) : renvoyee telle quelle", () => {
    expect(normaliserIp("fe80::1%eth0")).toBe("fe80::1%eth0");
  });

  it("'1::2::3' (deux '::') : renvoyee telle quelle", () => {
    expect(normaliserIp("1::2::3")).toBe("1::2::3");
  });

  it("'pas-une-ip' : renvoyee telle quelle", () => {
    expect(normaliserIp("pas-une-ip")).toBe("pas-une-ip");
  });

  it("chaine vide : renvoyee telle quelle", () => {
    expect(normaliserIp("")).toBe("");
  });

  it("trop de groupes (9) : renvoyee telle quelle", () => {
    expect(normaliserIp("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
  });

  it("pas assez de groupes sans '::' (7) : renvoyee telle quelle", () => {
    expect(normaliserIp("1:2:3:4:5:6:7")).toBe("1:2:3:4:5:6:7");
  });

  it("'::' qui ne remplacerait aucun groupe (8 groupes explicites) : renvoyee telle quelle", () => {
    expect(normaliserIp("1:2:3:4:5:6:7::8")).toBe("1:2:3:4:5:6:7::8");
  });

  it("groupe de plus de 4 chiffres hexa : renvoyee telle quelle", () => {
    expect(normaliserIp("12345::1")).toBe("12345::1");
  });

  it("caractere non hexadecimal ('2001:db8::g'): renvoyee telle quelle", () => {
    expect(normaliserIp("2001:db8::g")).toBe("2001:db8::g");
  });

  it("IPv4 invalide (octet 256) : renvoyee telle quelle", () => {
    expect(normaliserIp("256.1.1.1")).toBe("256.1.1.1");
  });

  it("IPv4 incomplete ('1.2.3') : renvoyee telle quelle", () => {
    expect(normaliserIp("1.2.3")).toBe("1.2.3");
  });

  it("IPv4 mappee avec un octet invalide : renvoyee telle quelle", () => {
    expect(normaliserIp("::ffff:999.1.1.1")).toBe("::ffff:999.1.1.1");
  });

  it("un point mais aucun ':' ('a.b.c.d') : renvoyee telle quelle", () => {
    expect(normaliserIp("a.b.c.d")).toBe("a.b.c.d");
  });

  it("':' seul et ':::' : renvoyes tels quels", () => {
    expect(normaliserIp(":")).toBe(":");
    expect(normaliserIp(":::")).toBe(":::");
  });

  it("chaine invalide tres longue : renvoyee telle quelle, sans exception", () => {
    const longue = "z".repeat(10_000);
    expect(() => normaliserIp(longue)).not.toThrow();
    expect(normaliserIp(longue)).toBe(longue);
  });

  it("entree invalide en majuscules : rendue en minuscules (la mise en minuscules est faite avant tout)", () => {
    expect(normaliserIp("PAS-UNE-IP")).toBe("pas-une-ip");
  });

  it("aucune de ces entrees ne leve d'exception", () => {
    for (const ip of ["fe80::1%eth0", "1::2::3", "pas-une-ip", "", ":::", "1.2.3.4.5", "::ffff:"]) {
      expect(() => normaliserIp(ip)).not.toThrow();
    }
  });
});

describe("normaliserIp : proprietes generales", () => {
  it("idempotente sur une IPv4 et sur un identifiant /64 deja normalise (pas sur la forme '::/64')", () => {
    expect(normaliserIp(normaliserIp("::ffff:1.2.3.4"))).toBe("1.2.3.4");
    expect(normaliserIp(normaliserIp("1.2.3.4"))).toBe("1.2.3.4");
  });

  it("cleIp s'appuie sur la meme normalisation : '::ffff:1.2.3.4' et '1.2.3.4' donnent la meme cle", () => {
    expect(cleIp("::ffff:1.2.3.4")).toBe(cleIp("1.2.3.4"));
    expect(cleIp("2001:db8:1:2::1")).toBe(cleIp("2001:DB8:1:2:0:0:0:ABCD"));
  });
});

// ---------------------------------------------------------------------------
// extraireIp
// ---------------------------------------------------------------------------

describe("extraireIp : x-forwarded-for", () => {
  it("une seule adresse", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "1.1.1.1" }))).toBe("1.1.1.1");
  });

  it("plusieurs adresses : prend la PREMIERE (le client)", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("trois adresses sans espace : prend la premiere", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "1.1.1.1,2.2.2.2,3.3.3.3" }))).toBe("1.1.1.1");
  });

  it("espaces autour de la premiere adresse : retires", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "   1.1.1.1   , 2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("IPv6 : acceptee", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("IPv6 en tete d'une liste : acceptee", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "2001:db8::1, 10.0.0.1" }))).toBe("2001:db8::1");
  });

  it("IPv4 mappee en IPv6 de 45 caracteres exactement : acceptee (frontiere)", () => {
    const longue = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255";
    expect(longue).toHaveLength(45);
    expect(extraireIp(enTetes({ "x-forwarded-for": longue }))).toBe(longue);
  });

  it("46 caracteres : refusee (ce n'est pas une adresse)", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "a".repeat(46) }))).toBeNull();
  });

  it("valeur tres longue : refusee, sans exception", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "a".repeat(10_000) }))).toBeNull();
  });

  it("la limite de 45 s'applique apres le trim, pas avant", () => {
    const longue = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255";
    expect(extraireIp(enTetes({ "x-forwarded-for": `   ${longue}   ` }))).toBe(longue);
  });

  it("premiere adresse trop longue : bascule sur x-real-ip, sans regarder la 2e du forwarded", () => {
    const ip = extraireIp(
      enTetes({ "x-forwarded-for": "a".repeat(46) + ", 2.2.2.2", "x-real-ip": "9.9.9.9" })
    );
    expect(ip).toBe("9.9.9.9");
  });

  it("premiere adresse vide mais suivante valide (', 2.2.2.2') : ne prend pas la 2e, bascule sur x-real-ip", () => {
    // Documente le code actuel : seul le PREMIER element est regarde. Une 2e
    // adresse (probablement un proxy) n'est jamais utilisee comme cle.
    expect(extraireIp(enTetes({ "x-forwarded-for": ", 2.2.2.2" }))).toBeNull();
    expect(extraireIp(enTetes({ "x-forwarded-for": ", 2.2.2.2", "x-real-ip": "9.9.9.9" }))).toBe(
      "9.9.9.9"
    );
  });

  it("valeur arbitraire non validee (pas une IP) : acceptee tant qu'elle fait 45 caracteres ou moins", () => {
    // Documente une limite assumee : extraireIp controle la longueur, pas le
    // format. Un client qui invente son x-forwarded-for choisit sa propre cle
    // IP ; la limite par email, elle, ne depend pas de l'en-tete.
    expect(extraireIp(enTetes({ "x-forwarded-for": "pas-une-ip" }))).toBe("pas-une-ip");
  });
});

describe("extraireIp : bascule sur x-real-ip puis null", () => {
  it("x-forwarded-for vide + x-real-ip valide : x-real-ip", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "", "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("x-forwarded-for fait d'espaces + x-real-ip valide : x-real-ip", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "    ", "x-real-ip": "3.3.3.3" }))).toBe(
      "3.3.3.3"
    );
  });

  it("x-forwarded-for absent + x-real-ip valide : x-real-ip", () => {
    expect(extraireIp(enTetes({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("x-real-ip avec espaces autour : retires", () => {
    expect(extraireIp(enTetes({ "x-real-ip": "  3.3.3.3 " }))).toBe("3.3.3.3");
  });

  it("x-real-ip en IPv6 : accepte", () => {
    expect(extraireIp(enTetes({ "x-real-ip": "::1" }))).toBe("::1");
  });

  it("les deux presents et valides : x-forwarded-for gagne", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "3.3.3.3" }))).toBe(
      "1.1.1.1"
    );
  });

  it("x-forwarded-for vide + x-real-ip vide : null", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "", "x-real-ip": "" }))).toBeNull();
  });

  it("x-forwarded-for en espaces + x-real-ip en espaces : null", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": "  ", "x-real-ip": "   " }))).toBeNull();
  });

  it("x-real-ip de plus de 45 caracteres : null", () => {
    expect(extraireIp(enTetes({ "x-real-ip": "b".repeat(46) }))).toBeNull();
  });

  it("aucun en-tete : null", () => {
    expect(extraireIp(enTetes({}))).toBeNull();
  });

  it("en-tetes explicitement null : null", () => {
    expect(extraireIp(enTetes({ "x-forwarded-for": null, "x-real-ip": null }))).toBeNull();
  });

  it("un get() qui renvoie undefined (objet factice mal forme) : null, sans exception", () => {
    const factice = { get: () => undefined as unknown as string | null };
    expect(extraireIp(factice)).toBeNull();
  });
});

describe("extraireIp : noms d'en-tetes demandes", () => {
  it("demande 'x-forwarded-for' puis 'x-real-ip', en minuscules", () => {
    // Un faux objet strict ne repond qu'au nom exact : si le code demandait
    // "X-Forwarded-For", le test ci-dessus renverrait null. Ici on verifie
    // aussi l'ordre et l'absence d'appel inutile quand le premier suffit.
    const h = enTetes({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "3.3.3.3" });
    extraireIp(h);
    expect(h.demandes).toEqual(["x-forwarded-for"]);

    const h2 = enTetes({ "x-real-ip": "3.3.3.3" });
    extraireIp(h2);
    expect(h2.demandes).toEqual(["x-forwarded-for", "x-real-ip"]);
  });

  it("fonctionne avec un vrai objet Headers (insensible a la casse, sans reseau)", () => {
    const h = new Headers({ "X-Forwarded-For": "1.1.1.1, 2.2.2.2" });
    expect(extraireIp(h)).toBe("1.1.1.1");
    expect(extraireIp(new Headers({ "X-Real-IP": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(extraireIp(new Headers())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fenetreTerminee
// ---------------------------------------------------------------------------

describe("fenetreTerminee : fenetre absente ou illisible", () => {
  it("debut null : terminee (un compteur neuf repart sur une fenetre neuve)", () => {
    expect(fenetreTerminee(null, DEBUT)).toBe(true);
  });

  it("debut undefined : terminee (cas de l'upsert, le document n'a pas encore de debut)", () => {
    expect(fenetreTerminee(undefined, DEBUT)).toBe(true);
  });

  it("debut = Invalid Date : terminee (on ne bloque pas sur une donnee illisible)", () => {
    expect(fenetreTerminee(new Date("pas une date"), DEBUT)).toBe(true);
  });

  it("maintenant = Invalid Date : terminee aussi", () => {
    expect(fenetreTerminee(DEBUT, new Date(NaN))).toBe(true);
  });
});

describe("fenetreTerminee : frontiere des 15 minutes", () => {
  it("meme instant (0 ms ecoulee) : pas terminee", () => {
    expect(fenetreTerminee(DEBUT, DEBUT)).toBe(false);
  });

  it("1 minute apres : pas terminee", () => {
    expect(fenetreTerminee(DEBUT, apres(DEBUT, 60_000))).toBe(false);
  });

  it("15 min - 1 ms : pas terminee", () => {
    expect(fenetreTerminee(DEBUT, apres(DEBUT, QUINZE_MIN_MS - 1))).toBe(false);
  });

  it("15 min pile : terminee (frontiere incluse, comme le pipeline Mongo $lte)", () => {
    expect(fenetreTerminee(DEBUT, apres(DEBUT, QUINZE_MIN_MS))).toBe(true);
  });

  it("15 min + 1 ms : terminee", () => {
    expect(fenetreTerminee(DEBUT, apres(DEBUT, QUINZE_MIN_MS + 1))).toBe(true);
  });

  it("un jour apres : terminee", () => {
    expect(fenetreTerminee(DEBUT, apres(DEBUT, 24 * 3_600_000))).toBe(true);
  });

  it("la duree vient de FENETRE_MINUTES (pas une valeur en dur de 15 dans le test)", () => {
    expect(QUINZE_MIN_MS).toBe(FENETRE_MINUTES * 60_000);
  });
});

describe("fenetreTerminee : horloge decalee", () => {
  it("debut dans le futur (1 s) : pas terminee", () => {
    // Documente le code actuel : un ecart negatif est inferieur a 15 min, donc
    // la fenetre est consideree comme en cours.
    expect(fenetreTerminee(apres(DEBUT, 1000), DEBUT)).toBe(false);
  });

  it("debut dans le futur de plus de 15 minutes : toujours pas terminee", () => {
    // Piste a surveiller : si une ecriture avait pose un debut tres lointain
    // dans le futur (serveur dont l'horloge avance), le compteur resterait
    // bloque jusqu'a ce que l'horloge rattrape ce debut + 15 min. Le code ne
    // borne pas ce cas ; le test fige le comportement actuel.
    expect(fenetreTerminee(apres(DEBUT, 2 * 3_600_000), DEBUT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tentativeAutorisee
// ---------------------------------------------------------------------------

describe("tentativeAutorisee", () => {
  it.each([1, 2, 3, 4, 5])("tentative %i sur max 5 : autorisee", (n) => {
    expect(tentativeAutorisee(n, 5)).toBe(true);
  });

  it("tentative 6 sur max 5 : refusee", () => {
    expect(tentativeAutorisee(6, 5)).toBe(false);
  });

  it("n = max exactement : autorisee (frontiere)", () => {
    expect(tentativeAutorisee(5, 5)).toBe(true);
    expect(tentativeAutorisee(20, 20)).toBe(true);
  });

  it("n = max + 1 : refusee", () => {
    expect(tentativeAutorisee(6, 5)).toBe(false);
    expect(tentativeAutorisee(21, 20)).toBe(false);
  });

  it("n tres grand : refuse", () => {
    expect(tentativeAutorisee(1_000_000, 5)).toBe(false);
    expect(tentativeAutorisee(Infinity, 5)).toBe(false);
  });

  it("n = 0 : autorise", () => {
    expect(tentativeAutorisee(0, 5)).toBe(true);
  });

  it("n negatif : autorise (documente : aucune garde, n ne peut pas etre negatif en base)", () => {
    expect(tentativeAutorisee(-1, 5)).toBe(true);
  });

  it("n = NaN : refuse (NaN <= max est faux, on bloque plutot que de laisser passer)", () => {
    expect(tentativeAutorisee(NaN, 5)).toBe(false);
  });

  it("max = 0 : la premiere tentative est deja refusee", () => {
    expect(tentativeAutorisee(1, 0)).toBe(false);
  });

  it("max = NaN : tout est refuse", () => {
    expect(tentativeAutorisee(1, NaN)).toBe(false);
  });

  it("fonctionne avec les vraies constantes", () => {
    expect(tentativeAutorisee(MAX_TENTATIVES_EMAIL, MAX_TENTATIVES_EMAIL)).toBe(true);
    expect(tentativeAutorisee(MAX_TENTATIVES_EMAIL + 1, MAX_TENTATIVES_EMAIL)).toBe(false);
    expect(tentativeAutorisee(MAX_TENTATIVES_IP, MAX_TENTATIVES_IP)).toBe(true);
    expect(tentativeAutorisee(MAX_TENTATIVES_IP + 1, MAX_TENTATIVES_IP)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Simulation du compteur (sans base)
// ---------------------------------------------------------------------------

// Rejoue en memoire ce que fait reserverTentative dans Mongo : si la fenetre
// est terminee (ou absente), le compteur repart a 1 avec un nouveau debut ;
// sinon il monte de 1. La decision utilise les memes fonctions pures que le
// vrai code. Ce n'est pas un test de Mongo, seulement de la logique de decision.
type Compteur = { n: number; debut: Date } | undefined;

function reserver(etat: Compteur, maintenant: Date, max: number) {
  const neuf = fenetreTerminee(etat?.debut, maintenant);
  const suivant = neuf || !etat ? { n: 1, debut: maintenant } : { n: etat.n + 1, debut: etat.debut };
  return { etat: suivant, autorise: tentativeAutorisee(suivant.n, max) };
}

function rejouer(nombre: number, instants: (i: number) => Date, max: number, depart?: Compteur) {
  let etat = depart;
  const autorisees: boolean[] = [];
  for (let i = 0; i < nombre; i++) {
    const r = reserver(etat, instants(i), max);
    etat = r.etat;
    autorisees.push(r.autorise);
  }
  return { etat, autorisees };
}

describe("simulation du compteur", () => {
  it("50 tentatives dans la meme fenetre (email) : exactement les 5 premieres passent", () => {
    const { autorisees, etat } = rejouer(50, () => DEBUT, MAX_TENTATIVES_EMAIL);
    expect(autorisees.filter(Boolean)).toHaveLength(5);
    expect(autorisees.slice(0, 5)).toEqual([true, true, true, true, true]);
    expect(autorisees.slice(5).every((a) => a === false)).toBe(true);
    expect(etat?.n).toBe(50);
  });

  it("50 tentatives etalees sur 14 minutes : toujours 5 autorisees seulement", () => {
    const { autorisees } = rejouer(
      50,
      (i) => apres(DEBUT, Math.floor((i * (QUINZE_MIN_MS - 60_000)) / 49)),
      MAX_TENTATIVES_EMAIL
    );
    expect(autorisees.filter(Boolean)).toHaveLength(5);
  });

  it("50 tentatives sur la meme fenetre (IP) : exactement les 20 premieres passent", () => {
    const { autorisees } = rejouer(50, () => DEBUT, MAX_TENTATIVES_IP);
    expect(autorisees.filter(Boolean)).toHaveLength(20);
    expect(autorisees.slice(0, 20).every(Boolean)).toBe(true);
    expect(autorisees.slice(20).some(Boolean)).toBe(false);
  });

  it("le debut de fenetre ne bouge pas pendant les refus (pas de fenetre glissante)", () => {
    const { etat } = rejouer(50, (i) => apres(DEBUT, i * 1000), MAX_TENTATIVES_EMAIL);
    expect(etat?.debut.getTime()).toBe(DEBUT.getTime());
  });

  it("a 15 min - 1 ms : toujours bloque", () => {
    const bloque = rejouer(50, () => DEBUT, MAX_TENTATIVES_EMAIL).etat;
    const r = reserver(bloque, apres(DEBUT, QUINZE_MIN_MS - 1), MAX_TENTATIVES_EMAIL);
    expect(r.autorise).toBe(false);
    expect(r.etat.n).toBe(51);
  });

  it("a 15 min pile : la fenetre repart, n revient a 1 et la tentative passe", () => {
    const bloque = rejouer(50, () => DEBUT, MAX_TENTATIVES_EMAIL).etat;
    const maintenant = apres(DEBUT, QUINZE_MIN_MS);
    const r = reserver(bloque, maintenant, MAX_TENTATIVES_EMAIL);
    expect(r.etat.n).toBe(1);
    expect(r.etat.debut.getTime()).toBe(maintenant.getTime());
    expect(r.autorise).toBe(true);
  });

  it("apres 15 minutes, une nouvelle serie de 50 : encore exactement 5 autorisees", () => {
    const bloque = rejouer(50, () => DEBUT, MAX_TENTATIVES_EMAIL).etat;
    const plus_tard = apres(DEBUT, QUINZE_MIN_MS + 5);
    const { autorisees, etat } = rejouer(50, () => plus_tard, MAX_TENTATIVES_EMAIL, bloque);
    expect(autorisees.filter(Boolean)).toHaveLength(5);
    expect(etat?.n).toBe(50);
    expect(etat?.debut.getTime()).toBe(plus_tard.getTime());
  });

  it("premiere tentative sur une cle jamais vue (pas de compteur) : n = 1, autorisee", () => {
    const r = reserver(undefined, DEBUT, MAX_TENTATIVES_EMAIL);
    expect(r.etat).toEqual({ n: 1, debut: DEBUT });
    expect(r.autorise).toBe(true);
  });

  it("deux cles (email et IP) ont des compteurs independants", () => {
    const compteurs = new Map<string, Compteur>();
    const max = new Map([
      [cleEmail("a@x.fr"), MAX_TENTATIVES_EMAIL],
      [cleIp("1.1.1.1"), MAX_TENTATIVES_IP],
    ]);
    const tenter = (cle: string) => {
      const r = reserver(compteurs.get(cle), DEBUT, max.get(cle)!);
      compteurs.set(cle, r.etat);
      return r.autorise;
    };
    for (let i = 0; i < 6; i++) tenter(cleEmail("a@x.fr"));
    // L'email est bloque, l'IP a encore de la marge.
    expect(tenter(cleEmail("A@X.fr "))).toBe(false);
    expect(tenter(cleIp("1.1.1.1"))).toBe(true);
    expect(compteurs.get(cleEmail("a@x.fr"))?.n).toBe(7);
    expect(compteurs.get(cleIp("1.1.1.1"))?.n).toBe(1);
  });
});
