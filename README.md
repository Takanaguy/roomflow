# RoomFlow

[![CI](https://github.com/Takanaguy/roomflow/actions/workflows/ci.yml/badge.svg)](https://github.com/Takanaguy/roomflow/actions/workflows/ci.yml)

Gestionnaire de colocation : les dépenses partagées sont centralisées, les remboursements sont simplifiés en un petit nombre de virements, et les tâches et les courses se partagent au même endroit.

Projet personnel de portfolio, développé avec Next.js, TypeScript et MongoDB, avec l'aide de Claude Code (assistant de programmation) pour l'écriture et la relecture du code. Les choix de conception et de sécurité décrits plus bas sont ceux que je sais expliquer.

## Démo

> **Adresse de la démo : https://À-COMPLÉTER-APRÈS-LE-DÉPLOIEMENT**
>
> | | |
> |---|---|
> | Email | `demo@roomflow.invalid` |
> | Mot de passe | `RoomFlowDemo2026` |
>
> Ce mot de passe est **PUBLIC** : c'est un compte partagé, ne jamais y mettre de vraie donnée ni réutiliser ce mot de passe ailleurs.
> La démo est remise à zéro chaque nuit (colocation d'exemple et fausses données), et certaines actions y sont désactivées : supprimer le compte, changer le mot de passe, créer ou rejoindre une autre colocation, quitter ou détruire la colocation d'exemple.

## Captures d'écran

*Captures à venir.*

<!--
Pour les afficher : déposer les 6 fichiers dans docs/screenshots/, puis supprimer
la ligne « Captures à venir » ci-dessus et les marqueurs de ce commentaire.

| | | |
|---|---|---|
| ![Liste des colocations](docs/screenshots/colocations.png) | ![Tableau de bord d'une colocation](docs/screenshots/dashboard.png) | ![Ajout d'une dépense avec répartition](docs/screenshots/depense.png) |
| ![Qui doit quoi](docs/screenshots/dettes.png) | ![Kanban des tâches](docs/screenshots/kanban.png) | ![Export PDF du mois](docs/screenshots/export-pdf.png) |
-->

Captures prévues :

1. Liste des colocations (`colocations.png`)
2. Tableau de bord d'une colocation, avec le graphique par catégorie (`dashboard.png`)
3. Ajout d'une dépense avec sa répartition (`depense.png`)
4. « Qui doit quoi » (`dettes.png`)
5. Kanban des tâches (`kanban.png`)
6. Export PDF du récapitulatif mensuel (`export-pdf.png`)

## Fonctionnalités

**Comptes et sécurité**
- Inscription et connexion par email et mot de passe, ou avec Google ou GitHub.
- Mot de passe oublié par email, changement du nom affiché, case « Recevoir les notifications par email ».
- Suppression de compte avec garde-fous : refusée s'il reste une dette, accord explicite requis pour abandonner ses créances.
- Un email déjà utilisé avec un autre mode de connexion n'est jamais fusionné en silence.

**Colocations**
- Création, code d'invitation, rejoindre, quitter (avertissement s'il reste une dette), retrait d'un membre par l'admin.
- Un seul admin à la fois : si l'admin part, le membre le plus ancien est promu. Un admin peut aussi nommer son successeur à tout moment.
- Modification du nom et de la description, destruction définitive (admin, confirmée en deux clics).

**Dépenses et répartitions**
- Catégories : courses, factures, loyer, sorties, autre.
- Un ou plusieurs payeurs (par exemple 40 € et 60 € sur un repas de 100 €).
- Répartition égale, ou personnalisée en montants ou en pourcentages. La somme tombe toujours au centime près.
- Liste filtrable (catégorie, période, membre), détail avec « Qui rembourse qui » pour cette dépense, modification et suppression par l'auteur ou l'admin.

**Dettes et remboursements**
- Soldes de chaque membre, et vue « Qui doit quoi » simplifiée (« Tu dois 23,50 € à Marie »).
- Seul le créditeur confirme avoir reçu l'argent. Le montant est toujours recalculé côté serveur, tout ou rien (pas de remboursement partiel).

**Tâches (Kanban)**
- Trois colonnes (à faire, en cours, fait) avec glisser-déposer (`@dnd-kit`) et un menu « Statut » pour le clavier et le mobile.
- Récurrence hebdomadaire ou mensuelle, rotation optionnelle des assignés, historique paginé.

**Liste de courses**
- Articles partagés avec catégorie de rayon, qui l'a ajouté, coche, suppression, historique des articles cochés.
- Mise à jour automatique toutes les 15 secondes.

**Tableau de bord**
- Soldes, dernières dépenses, tâches en cours, graphique des dépenses par catégorie (Recharts) avec navigation de mois.
- Page `/tableau-de-bord` : toutes ses colocations avec son solde dans chacune.

**Emails** (Resend)
- Bienvenue dans une colocation, dépense qui vous concerne, rappel de tâche la veille de l'échéance, mot de passe oublié, avertissements de suppression (colocation vidée ou inactive).

**Export PDF mensuel**
- Total et totaux par catégorie, liste des dépenses, soldes au jour de la génération, virements simplifiés.

**Panneau d'administration et nettoyage automatique**
- `/admin` (réservé aux emails de `SITE_ADMIN_EMAILS` connectés avec Google ou GitHub) : liste des colocations avec compteurs et dernière activité, destruction manuelle.
- Cron quotidien : colocation vide supprimée 30 jours après le départ du dernier membre, colocation inactive (plus de 90 jours) avertie puis supprimée 30 jours plus tard. Désactivé par défaut (voir Limites connues).

**Compte démo**
- Colocation d'exemple remplie de fausses données, remise à zéro chaque nuit (voir le bloc Démo).

## Stack technique

| Domaine | Choix |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Langage | TypeScript 5, mode strict |
| Style | Tailwind CSS 4 |
| Base de données | MongoDB Atlas (offre gratuite) via Mongoose 9 |
| Authentification | Auth.js v5 (`next-auth` 5.0.0-beta.32) : email + mot de passe (bcrypt), Google, GitHub, sessions JWT |
| Validation | Zod 4 |
| Glisser-déposer | `@dnd-kit/core` |
| Graphiques | Recharts 3 |
| PDF | `@react-pdf/renderer` 4.9 |
| Emails | Resend |
| Tests | Vitest 4 |
| Qualité | ESLint 9, `tsc --noEmit`, GitHub Actions |
| Hébergement | Vercel (offre gratuite, 2 Cron Jobs quotidiens) |

## Architecture

Pas de classes `Controller` à la Laravel ou CodeIgniter : le routage par fichiers et les Server Components de Next.js font déjà ce travail. Le code est découpé en quatre couches.

```
 Navigateur
     |
     |  page demandée                    fetch (clics, formulaires)
     v                                          |
 Server Components (src/app/**/page.tsx)        v
 lisent la base pour le premier rendu   Route Handlers (src/app/api/**)
     |                                  validation Zod, réponse HTTP fine
     |                                          |
     +------------------+-----------------------+
                        v
              src/lib  (logique métier, fonctions pures testées)
                        |
                        v
              src/models  (schémas Mongoose)  ->  MongoDB Atlas

 src/components : interface réutilisable, Client Components là où il faut de l'interactivité
```

Arborescence de `src/` :

```
src/
  app/              pages (20) et routes API (23)
    api/            couche HTTP fine : validation Zod, appel à src/lib
    admin/          panneau d'administration (404 pour tout non-admin)
    colocations/    pages d'une colocation : tableau de bord, dépenses, dettes, tâches, courses
    connexion/ inscription/ profil/ tableau-de-bord/   comptes et vue d'ensemble
    error.tsx global-error.tsx not-found.tsx            pages d'erreur
  assets/fonts/     Noto Sans (PDF) et sa licence OFL
  components/       en-tête, fournisseur de session
  lib/              logique métier (dettes, dépenses, tâches, emails, nettoyage, démo, PDF...)
                    et ses fichiers de tests *.test.ts à côté du code
  models/           8 schémas Mongoose (User, Household, Expense, Settlement, Task...)
  types/            extension des types Auth.js
  auth.ts           configuration Auth.js : fournisseurs, callbacks JWT
  proxy.ts          protection des pages (le « middleware » s'appelle proxy en Next.js 16)
```

## Choix techniques

### Simplification des dettes (minimum cash flow)

Fichier : `src/lib/settlements.ts`, fonction `simplifier`. Le solde net de chaque membre vaut ce qu'il a payé moins ce qu'il doit, plus les remboursements déjà confirmés. À chaque tour, le plus gros créditeur éponge le plus gros débiteur, jusqu'à ce que tout le monde soit à zéro.

Exemple à 3 personnes : Alice paie 60 € de courses et Bob 30 € de factures, partagés à parts égales entre Alice, Bob et Chloé. Soldes : Alice +30 €, Bob 0 €, Chloé -30 €. Au lieu de 4 dettes croisées (Bob et Chloé doivent chacun 20 € à Alice, Alice et Chloé doivent chacun 10 € à Bob), il reste un seul virement : Chloé doit 30 € à Alice.

Chaque tour solde au moins une personne, donc il y a au plus n-1 virements pour n personnes. Chaque tour parcourt la liste deux fois, soit O(n²) au total, sans importance pour une colocation. Attention : trouver le minimum absolu de virements est un problème difficile (NP-difficile), et cette méthode gloutonne ne garantit pas l'optimum dans tous les cas, elle garantit un résultat petit et un solde à zéro.

La fonction est pure (une table de soldes en entrée, des virements en sortie), donc testable sans serveur. Elle est testée sur des jeux pseudo-aléatoires à graine fixe (200 jeux de 2 à 8 personnes) : le hasard trouve des cas que je n'aurais pas pensé à écrire, et la graine fixe rend un échec reproductible.

### L'argent en centimes entiers

Tous les calculs passent par des centimes entiers, jamais par des flottants (`10.01 / 2` ne tombe pas juste). Pour une répartition égale, le reste de la division va aux premiers de la liste (10,01 € entre 2 personnes : 5,01 € et 5,00 €). Pour des pourcentages, le reste va au dernier. La somme des parts est donc toujours exactement le montant, sinon les soldes dériveraient dépense après dépense.

### Sessions JWT révocables

Un JWT vit dans le navigateur : le serveur ne peut pas l'effacer. Pour pouvoir couper une session après un changement de mot de passe ou une suppression de compte, le callback `jwt` (`src/auth.ts`) relit le compte en base au plus tard toutes les 300 secondes. Le `iat` natif est réécrit à chaque lecture, donc deux revendications propres sont ajoutées : `connecteLe` (posée à la connexion seulement) et `verifieLe`. Le délai maximal de révocation est donc de 5 minutes. Si la base ne répond pas, la session est conservée : une panne ne doit pas déconnecter tout le monde.

### Limiteur de tentatives de connexion atomique

Fichier : `src/lib/login-limiter.ts`. 5 tentatives par email et 20 par adresse IP sur 15 minutes. Le compteur est incrémenté AVANT de regarder le mot de passe, par une seule écriture MongoDB conditionnelle (`findOneAndUpdate` avec un pipeline, `upsert`). Un « lire puis écrire » est une faille de concurrence : 50 requêtes envoyées ensemble liraient toutes un compteur à 0 et passeraient toutes. Avec l'écriture atomique, chacune reçoit un numéro différent et seules les 5 premières sont évaluées. Un email inconnu reçoit la même réponse, et un hash bcrypt bidon égalise le temps de réponse (682 ms contre 655 ms mesurés), pour ne pas révéler quels comptes existent.

### Le motif « écriture conditionnelle atomique »

La même idée sert partout où deux requêtes peuvent arriver en même temps : la coche d'un article de courses (le filtre cible l'état opposé), le verrou anti-doublon d'une tâche récurrente, l'envoi unique d'un rappel, le jeton de réinitialisation à usage unique (`findOneAndDelete`), le verrou de suppression de compte et le verrou de destruction d'une colocation. On décide dans la base, au moment de l'écriture, et non dans le code après une lecture.

### Nettoyage automatique avec préavis

Fichiers : `src/lib/nettoyage.ts` et `nettoyage-cron.ts`. Une colocation vide est supprimée 30 jours après le départ du dernier membre. Une colocation de plus de 90 jours sans activité (strictement) est d'abord signalée par email à tous ses membres, puis supprimée 30 jours plus tard si rien n'a bougé. Garde-fous :
- Interrupteur `NETTOYAGE_AUTO_ACTIF` : seule la valeur exacte `true` active la suppression. Sinon le cron fonctionne en simulation (il journalise « aurait supprimé »).
- Garde d'envoi : sans domaine d'expédition vérifié, un préavis n'arriverait pas aux vrais membres, donc rien n'est planifié.
- Verrou de destruction : avant de supprimer, une écriture atomique pose un marqueur, et rejoindre ou quitter la colocation est refusé pendant ce temps.
- La règle de décision (`evaluerNettoyage`) est pure et ne rend « supprimer » que si l'échéance est cohérente, atteinte et que la raison est encore vraie.

### Export PDF

`@react-pdf/renderer` décrit le PDF avec des composants React, généré côté serveur. Plafond de 300 dépenses par export : le temps de rendu est quadratique (mesuré en local : 126 dépenses 3 s, 300 dépenses 6 s, 500 dépenses 12 s). La police Noto Sans est embarquée (Helvetica sort des lettres fausses pour le cyrillique ou le polonais) et copiée dans la fonction Vercel via `outputFileTracingIncludes`. Piège : la table `ToUnicode` du PDF, qui sert au copier-coller, était fausse (voir Difficultés rencontrées).

### Compte démo protégé

Les protections sont lues sur `demo === true` en base, jamais dans la session : suppression de compte, mot de passe oublié, inscription avec l'adresse démo, créer ou rejoindre une colocation, et actions destructrices sur la colocation d'exemple sont refusés. Le mot de passe étant public, le compte démo n'a pas de compteur d'essais par email (n'importe qui pourrait sinon le verrouiller pour tout le monde), seulement le compteur par IP. Les adresses en `.invalid` ne sont jamais livrables, et l'envoi d'emails refuse explicitement les adresses démo.

## Sécurité

- Session Auth.js dans un cookie HttpOnly et SameSite=Lax, `Secure` en HTTPS. Sessions révocables (voir ci-dessus).
- Limiteur de tentatives de connexion par email et par IP (atomique).
- Mots de passe hachés avec bcrypt (coût 12). Jeton de réinitialisation de 256 bits : seul son hash SHA-256 est stocké, valable 60 minutes, à usage unique.
- En-têtes HTTP : `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, et une CSP **partielle** (`frame-ancestors 'none'; base-uri 'self'; object-src 'none'`). Pas de `script-src` : Next.js injecte des scripts en ligne, une CSP stricte demande des nonces par requête (piste d'amélioration).
- Accès à `/admin` : adresse et fournisseur relus en base à chaque requête, 404 pour tout autre visiteur. Un compte email + mot de passe n'est jamais administrateur, car son adresse n'est pas vérifiée.
- Cloisonnement : un membre d'une colocation ne peut ni lire ni modifier une autre (l'API répond le même 404 pour une colocation inconnue, mal formée ou dont on n'est pas membre).
- Les logs évitent les données personnelles : adresses masquées, nom de l'erreur seulement. `/api/health` ne renvoie que `{"ok":true}` ou `{"ok":false}`.
- Les routes de cron sont fermées par défaut : sans `CRON_SECRET`, 401 pour tout le monde.
- `npm audit` : 0 vulnérabilité au 30/10/2026.

## Qualité

- **Tests : 2982 tests Vitest** dans 22 fichiers (`npm test`). Ils couvrent la **logique pure** de `src/lib/` : répartition des dépenses, simplification des dettes, règles du nettoyage, limiteur, dates des tâches, mise en forme des emails et du PDF, données de démo.
- **Ce qui n'est pas couvert par des tests automatiques** : tout ce qui touche la base (routes API, verrous atomiques, limiteur côté MongoDB, crons). Ces parties ont été vérifiées par des scripts multi-comptes joués à la main contre un vrai MongoDB Atlas. **Ces scripts ne sont pas dans le dépôt.**
- **CI** (GitHub Actions, `.github/workflows/ci.yml`) à chaque push et pull request vers `main` : `npm ci`, génération des types, lint, `tsc --noEmit`, tests, build de production. Aucun secret : les tests et le build n'utilisent ni base ni clé d'API.
- ESLint 9 (`eslint-config-next`), TypeScript en mode strict.

## Difficultés rencontrées

- **Course sur la coche des courses.** Ma première version lisait l'article puis écrivait : deux colocataires qui cochaient en même temps s'écrasaient l'heure et l'auteur de l'achat. Remplacé par une écriture conditionnelle, vérifiée avec deux coches simultanées.
- **La limite de 60 s du mot de passe oublié se contournait en concurrence.** « Lire, supprimer, créer » n'est pas atomique : 20 demandes simultanées envoyaient 20 mails. Une seule écriture conditionnelle, posée avant de regarder le type de compte, donne maintenant 1 mail pour 20 demandes.
- **`VersionError` de Mongoose.** Avec un `save()` sous un filtre `$where`, un tableau modifié ne lève pas `DocumentNotFoundError` mais `VersionError` quand le filtre ne correspond plus. Les deux sont attrapées.
- **Le texte du PDF était faux alors que le rendu était juste.** Dans le texte copié, le point « . » devenait « ! ». Cause : le cache de glyphes de fontkit garde le premier glyphe créé ; un glyphe créé par substitution n'a pas de point de code et pdfkit écrit une entrée vide dans la table `ToUnicode`. Selon l'ordre des documents dans le processus, donc aléatoire. Corrigé en créant chaque glyphe depuis son point de code une fois par processus. Ce correctif repose sur un détail interne de fontkit et peut devenir inutile après une mise à jour.
- **Un mot long élargissait toute la page sur mobile.** Trois causes distinctes, trouvées en mesurant `scrollWidth` à 375 px sur 20 pages : un `overflow-wrap: anywhere` manquant (`break-word` ne réduit pas la largeur minimale du texte), un `<main>` dans un conteneur flex qui se calait sur son contenu, et un `<select>` qui prend la largeur de son option la plus longue.
- **Le signe Kelvin dans la comparaison d'emails.** `"K".toLowerCase()` (U+212A) donne un « k » ordinaire : une adresse écrite avec ce signe pouvait passer pour une adresse de la liste des administrateurs. Trouvé par les tests ; la comparaison se fait maintenant en minuscules ASCII seulement.
- **Le titre de l'onglet trahissait `/admin`.** L'`export const metadata` d'une page est résolu même quand la page appelle `notFound()` : un visiteur non admin voyait « Administration » dans son onglet. Le titre est maintenant dans le JSX, rendu seulement après la vérification d'accès.

## Limites connues

- **Pas de vérification d'email à l'inscription** (prévue avec un nom de domaine).
- **Emails limités à une adresse.** Sans domaine vérifié chez Resend, les mails ne partent qu'à l'adresse du compte Resend : les autres utilisateurs ne reçoivent donc pas leurs emails. Pour cette raison, **la suppression automatique est désactivée par défaut** : un préavis par email serait fictif.
- Pas de limitation de débit sur l'export PDF (génération coûteuse, réservée aux membres connectés), ni limite par IP sur la demande de mot de passe oublié.
- Le jeton de réinitialisation passe dans l'URL ; pas de longueur maximale de mot de passe (bcrypt ignore ce qui dépasse 72 octets) ; `/api/register` répond 409 pour un email existant, ce qui révèle qu'un compte existe.
- Le blocage de 15 minutes peut servir à bloquer un compte visé (compromis assumé, la limite par IP freine l'ampleur). `x-forwarded-for` n'est fiable que derrière Vercel.
- Une session révoquée peut rester valide jusqu'à 5 minutes.
- Deux appels simultanés à « rejoindre » pourraient ajouter deux fois le même membre.
- Cas bloquant non résolu : une dette dans une colocation quittée, envers un créditeur parti lui aussi, ne peut plus être confirmée (seul le créditeur confirme), donc ce compte ne peut pas être supprimé.
- Modifier une dépense ou une tâche ne compte pas comme une activité pour le nettoyage.
- **Démo partagée** : avec un mot de passe public, n'importe qui peut scripter l'API du compte démo et créer beaucoup de dépenses avant la remise à zéro (pas de plafond par colocation).
- Pas de remboursement partiel, une seule devise, pas de paiement réel : c'est volontaire (hors périmètre).
- Interface volontairement sobre : pas de travail de design poussé.
- CSP partielle (voir Sécurité).

## Installation locale

Prérequis : Node.js 20.9 ou plus (la CI utilise Node 22), npm, et un cluster MongoDB Atlas gratuit (avec ton adresse IP autorisée dans Network Access).

```bash
git clone https://github.com/Takanaguy/roomflow.git
cd roomflow
npm install
cp .env.example .env.local   # puis remplir au minimum MONGODB_URI et AUTH_SECRET
npm run dev                  # http://localhost:3000
```

`.env.local` n'est jamais commité. Pour générer `AUTH_SECRET` : `openssl rand -base64 32`. Pour vérifier la connexion à la base : ouvrir `http://localhost:3000/api/health`.

### Variables d'environnement

| Variable | Statut | Rôle |
|---|---|---|
| `MONGODB_URI` | obligatoire | Chaîne de connexion MongoDB Atlas (avec le nom de la base à la fin) |
| `AUTH_SECRET` | obligatoire | Secret de signature des sessions |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | optionnelles | Connexion avec Google |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | optionnelles | Connexion avec GitHub |
| `RESEND_API_KEY` | optionnelle | Envoi des emails (sans elle, aucun email n'est envoyé) |
| `EMAIL_FROM` | optionnelle | Expéditeur des emails (défaut : `onboarding@resend.dev`) |
| `APP_URL` | obligatoire en production | Adresse publique, pour les liens des emails |
| `CRON_SECRET` | obligatoire pour les crons | Secret des deux Cron Jobs (sans lui, ils répondent 401) |
| `SITE_ADMIN_EMAILS` | optionnelle | Emails des administrateurs de `/admin` (séparés par des virgules) |
| `DEMO_PASSWORD`, `DEMO_EMAIL` | optionnelles | Active le compte démo (sans mot de passe d'au moins 8 caractères, il est désactivé) |
| `NETTOYAGE_AUTO_ACTIF` | optionnelle | Valeur exacte `true` pour activer la suppression automatique |
| `EMAIL_REDIRECT_TO`, `NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE` | tests uniquement | Redirection des emails de test. Ignorées en production par le code |
| `MONGODB_DNS_SERVERS` | tests uniquement | Contournement d'un DNS qui refuse les requêtes SRV. Ignorée en production Vercel |
| `SESSION_RECHECK_SECONDS` | tests uniquement | Délai de relecture du compte, pour tester la révocation |
| `AUTH_TRUST_HOST` | hors Vercel | `true` pour lancer `npm start` ailleurs que sur Vercel |

Les valeurs ne sont jamais écrites dans le dépôt. Le détail de chaque variable est commenté dans `.env.example`.

### Scripts npm

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production (sous Windows, serveur de développement arrêté) |
| `npm start` | Lance le build de production |
| `npm run lint` | ESLint |
| `npm test` | Tests Vitest (une exécution) |
| `npm run test:watch` | Tests Vitest en continu |

La vérification des types se lance avec `npx tsc --noEmit` (après `npx next typegen` sur un clone neuf).

## Déploiement

Guide pas à pas pour Vercel : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Pistes pour la suite

Ce sont des pistes, **pas des fonctionnalités existantes** :
- Nom de domaine, avec vérification de l'email à l'inscription et activation des emails vers tous les utilisateurs (donc de la suppression automatique).
- Dockerfile (pas fourni pour l'instant, rien n'a été testé dans ce sens).
- Plafond de dépenses par colocation.
- Notifications supplémentaires.
- CSP complète avec nonces.

## Licence

Projet personnel de portfolio. Licence à définir.

Les polices Noto Sans embarquées pour le PDF sont sous licence SIL OFL 1.1 (voir `src/assets/fonts/OFL.txt`).
