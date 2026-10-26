import { describe, expect, it } from "vitest";
import {
  FENETRE_MINUTES,
  MAX_TENTATIVES_EMAIL,
  MAX_TENTATIVES_IP,
  cleEmail,
  cleIp,
  extraireIp,
  fenetreTerminee,
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

  it("IPv6 : conservee telle quelle apres le prefixe", () => {
    expect(cleIp("2001:db8::1")).toBe("ip:2001:db8::1");
  });

  it("pas de normalisation de casse (c'est le travail d'extraireIp, pas de cleIp)", () => {
    // Documente le code actuel : "2001:DB8::1" et "2001:db8::1" sont la meme
    // adresse mais donnent deux cles. Sans consequence tant que l'hebergeur
    // renvoie toujours la meme ecriture.
    expect(cleIp("2001:DB8::1")).not.toBe(cleIp("2001:db8::1"));
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
