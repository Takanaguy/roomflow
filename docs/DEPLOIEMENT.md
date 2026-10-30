# Déployer RoomFlow sur Vercel (offre gratuite)

Ce guide suit l'ordre à respecter. Il ne contient aucune vraie valeur : les exemples sont des valeurs factices. Les vraies valeurs ne vont que dans les réglages de Vercel, jamais dans le dépôt.

Remplace `<domaine>` par l'adresse que Vercel donne à ton projet (par exemple `roomflow-xxxx.vercel.app`), ou par ton nom de domaine s'il y en a un.

## 1. Prérequis

- Le dépôt GitHub `Takanaguy/roomflow` (public).
- Un compte [Vercel](https://vercel.com) (offre gratuite « Hobby »), connecté à GitHub.
- Un cluster [MongoDB Atlas](https://cloud.mongodb.com) gratuit (M0).
- Une application OAuth Google et une application OAuth GitHub (voir étape 5), si tu veux ces deux connexions.
- Un compte [Resend](https://resend.com) pour les emails (voir étape 6), facultatif au tout début.
- Un moyen de générer un secret aléatoire : `openssl rand -base64 32`, ou sans openssl : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## 2. Créer le projet Vercel

1. Sur Vercel : **Add New... > Project**, puis **Import** le dépôt `Takanaguy/roomflow`.
2. Vercel détecte **Next.js** tout seul. Ne change aucune commande : `npm install`, `npm run build` et le dossier de sortie par défaut conviennent.
3. Le build n'a besoin d'aucune variable d'environnement (elles ne sont lues qu'à l'exécution). Tu peux donc cliquer sur **Deploy** une première fois pour obtenir l'adresse du site, puis remplir les variables (étape 3) et **redéployer** : une variable ajoutée ou modifiée ne s'applique qu'au déploiement suivant (**Deployments**, menu du dernier déploiement, **Redeploy**).
4. Les 2 Cron Jobs sont lus dans `vercel.json` : rien à configurer. Ils ne tournent que sur le déploiement de production.

## 3. Variables d'environnement

Dans Vercel : **Settings > Environment Variables**. Pour chaque variable, coche l'environnement **Production** (et **Preview** seulement si tu veux tester une branche).

| Variable | Statut | Où la trouver ou comment la générer | Exemple factice |
|---|---|---|---|
| `MONGODB_URI` | obligatoire | Atlas : **Connect > Drivers**, remplacer `<password>`, ajouter `/roomflow` à la fin (étape 4) | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/roomflow` |
| `AUTH_SECRET` | obligatoire | `openssl rand -base64 32` | `<chaîne aléatoire de 44 caractères>` |
| `APP_URL` | obligatoire | L'adresse publique du site, sans `/` final (sert aux liens des emails) | `https://<domaine>` |
| `CRON_SECRET` | obligatoire | `openssl rand -base64 32`. Vercel l'envoie tout seul en `Authorization: Bearer ...` à ses crons | `<chaîne aléatoire>` |
| `AUTH_GOOGLE_ID` | optionnelle | Google Cloud Console (étape 5) | `<id>.apps.googleusercontent.com` |
| `AUTH_GOOGLE_SECRET` | optionnelle | Google Cloud Console (étape 5) | `<secret Google>` |
| `AUTH_GITHUB_ID` | optionnelle | GitHub, OAuth App (étape 5) | `<id GitHub>` |
| `AUTH_GITHUB_SECRET` | optionnelle | GitHub, OAuth App (étape 5) | `<secret GitHub>` |
| `RESEND_API_KEY` | optionnelle | resend.com > **API Keys > Create API Key** (droit d'envoi seulement suffit) | `re_<clé>` |
| `EMAIL_FROM` | optionnelle | Sans domaine : laisser vide ou `RoomFlow <onboarding@resend.dev>`. Avec domaine : étape 6 | `RoomFlow <noreply@<ton-domaine>>` |
| `SITE_ADMIN_EMAILS` | optionnelle | Ton adresse Google ou GitHub, pour accéder à `/admin`. Plusieurs adresses séparées par des virgules | `toi@exemple.com` |
| `DEMO_PASSWORD` | optionnelle | Active le compte démo. Mot de passe **public** d'au moins 8 caractères, à écrire dans le README | `<mot de passe public>` |
| `DEMO_EMAIL` | optionnelle | Laisser vide : défaut `demo@roomflow.invalid` | (vide) |
| `NETTOYAGE_AUTO_ACTIF` | optionnelle | Laisser vide ou absente tant que les emails ne partent pas à tout le monde (voir étape 9). Seule la valeur exacte `true` active la suppression | (vide) |

Ces variables **ne doivent PAS être définies en production** :

| Variable | Pourquoi |
|---|---|
| `EMAIL_REDIRECT_TO` | Redirige tous les emails vers une seule boîte de test. Le code l'ignore en production avec un avertissement, mais ne la définis pas |
| `NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE` | Réservée aux tests du cron. Ignorée en production, ne la définis pas |
| `MONGODB_DNS_SERVERS` | Contournement d'un DNS local. Ignorée en production Vercel, ne la définis pas |
| `SESSION_RECHECK_SECONDS` | Sert à tester la révocation des sessions avec un délai court. En production, le délai normal est de 300 secondes |
| `AUTH_TRUST_HOST` | Utile seulement hors Vercel. Vercel est reconnu tout seul |

## 4. MongoDB Atlas

1. **Database Access > Add New Database User** : crée un utilisateur dédié à RoomFlow avec un **mot de passe fort**. Pour les droits, choisis **Specific Privileges** (ou **Custom Role**) avec `readWrite` sur la base `roomflow` seulement, plutôt que « Atlas admin ». Si le mot de passe contient des caractères spéciaux (`@`, `:`, `/`, `#`...), encode-les dans l'URI (par exemple `@` devient `%40`), ou prends un mot de passe sans caractère spécial.
2. **Network Access > Add IP Address** : Vercel n'a pas d'adresse IP fixe, donc ajoute **`0.0.0.0/0`** (« Allow access from anywhere »).
   - Mise en garde : cela ouvre le cluster à toute adresse IP. Les seules protections restantes sont le mot de passe de l'utilisateur de base de données et la chaîne de connexion secrète. D'où l'utilisateur à droits limités et le mot de passe fort. Ne mets jamais cette chaîne dans le dépôt.
3. **Database > Connect > Drivers** : copie la chaîne `mongodb+srv://...`, remplace `<password>` par le mot de passe de l'utilisateur de la base (pas celui de ton compte Atlas) et ajoute le nom de la base à la fin : `.../roomflow`.
4. Colle le résultat dans `MONGODB_URI` sur Vercel.

Les collections sont créées par Mongoose au premier usage. Deux collections (`loginattempts` et `passwordresettokens`) ont un index à durée de vie qui efface les anciennes lignes : vérifie leur présence à l'étape 7.

## 5. Connexion Google et GitHub

À faire une fois l'adresse du site connue (étape 2).

### Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com) > ton projet > **APIs & Services > Identifiants** (Credentials).
2. Ouvre l'**ID client OAuth** de type **Application web** déjà créé pour RoomFlow.
3. **Origines JavaScript autorisées > Ajouter un URI** : `https://<domaine>`
4. **URI de redirection autorisés > Ajouter un URI** : `https://<domaine>/api/auth/callback/google`
5. **Enregistrer**. La prise en compte peut demander quelques minutes.
6. L'ancienne adresse `http://localhost:3000` peut rester : Google accepte plusieurs adresses, et le développement local continue de fonctionner.
7. Si l'écran de consentement OAuth est en mode « Test », seuls les comptes ajoutés comme utilisateurs de test peuvent se connecter. Pour ouvrir la connexion à tout le monde, il faut passer l'application en production depuis **Écran de consentement OAuth** (vérifie dans la console ce que Google demande à ce moment-là).

### GitHub

1. GitHub > **Settings > Developer settings > OAuth Apps**.
2. Une OAuth App GitHub n'a **qu'un seul** champ « Authorization callback URL ». Le plus simple est de créer une **seconde application** « RoomFlow (production) » :
   - **Homepage URL** : `https://<domaine>`
   - **Authorization callback URL** : `https://<domaine>/api/auth/callback/github`
3. Génère un **Client secret** et copie l'ID et le secret dans `AUTH_GITHUB_ID` et `AUTH_GITHUB_SECRET` sur Vercel. L'application d'origine (celle de localhost) reste intacte pour le développement local.
4. À l'inverse, si tu modifies l'application existante pour qu'elle pointe vers la production, la connexion GitHub en local ne marchera plus.

## 6. Resend (emails)

### Sans domaine (situation de départ)

- Expéditeur : `onboarding@resend.dev` (seule adresse permise sans domaine).
- Resend n'envoie alors **qu'à l'adresse du compte Resend**. Les emails destinés aux autres utilisateurs (bienvenue, dépense, mot de passe oublié, rappels) ne leur arrivent pas. L'application continue de fonctionner, l'échec est seulement écrit dans les logs.
- Conséquence : la suppression automatique des colocations reste désactivée (étape 9).

### Avec un nom de domaine

1. Resend > **Domains > Add Domain** : saisis ton domaine.
2. Resend affiche des enregistrements DNS (SPF, DKIM...). Ajoute-les chez ton registrar (là où tu as acheté le domaine), puis clique sur **Verify** dans Resend. La propagation peut prendre un moment.
3. Une fois le domaine vérifié, mets dans Vercel `EMAIL_FROM` = `RoomFlow <noreply@ton-domaine>` et redéploie.

## 7. Premiers contrôles après le déploiement

À cocher une fois les variables saisies et le site redéployé.

- [ ] `https://<domaine>/api/health` répond `{"ok":true}`. Sinon : voir Dépannage (Atlas, `MONGODB_URI`).
- [ ] Inscription par email, puis connexion par email.
- [ ] Connexion avec Google.
- [ ] Connexion avec GitHub.
- [ ] Dans les outils du navigateur (**Application > Cookies**), le cookie de session porte bien `Secure` et `HttpOnly`.
- [ ] Création d'une colocation, ajout d'une dépense, page « Qui doit quoi ».
- [ ] Dans Atlas (**Database > Browse Collections**, onglet **Indexes**), les collections `loginattempts` et `passwordresettokens` ont un index sur `expiresAt` avec une durée de vie (TTL). Ces collections n'existent qu'après une première connexion et une première demande de mot de passe oublié.
- [ ] Export PDF d'un mois depuis le tableau de bord (le texte du PDF est lisible).
- [ ] `/admin` : avec le compte dont l'adresse est dans `SITE_ADMIN_EMAILS` (connecté avec Google ou GitHub), le panneau s'affiche. Avec un autre compte, ou sans compte, la page « introuvable » (404).
- [ ] Première réinitialisation de la démo : dans `/admin`, bouton de réinitialisation de la démo (ou attendre le premier passage du cron). Puis connexion avec `demo@roomflow.invalid` et le mot de passe choisi.
- [ ] Appel manuel des deux crons, avec la valeur de `CRON_SECRET` :

  ```bash
  curl -H "Authorization: Bearer <CRON_SECRET>" https://<domaine>/api/cron/rappels-taches
  curl -H "Authorization: Bearer <CRON_SECRET>" https://<domaine>/api/cron/nettoyage
  ```

  Ils renvoient du JSON (des compteurs). Sans l'en-tête, ou avec un mauvais secret : 401. Le cron `nettoyage` réinitialise aussi la démo avant de nettoyer.
- [ ] Dans le tableau de bord Vercel (**Settings > Cron Jobs**), les 2 crons sont listés : `/api/cron/rappels-taches` (7 h UTC) et `/api/cron/nettoyage` (3 h UTC).
- [ ] Une fois la démo en place, écrire l'adresse du site dans le bloc « Démo » du `README.md`.

## 8. Quelques réglages à ne pas oublier

- `APP_URL` doit être l'adresse finale du site, sinon les liens des emails pointent vers `localhost` (un avertissement apparaît dans les logs).
- Les journaux de Vercel (**Logs**) montrent les erreurs d'envoi d'emails, de connexion à la base et le résultat des crons.

## 9. Activer plus tard la suppression automatique

Elle est désactivée par défaut, car sans domaine vérifié le préavis par email n'arriverait pas aux vrais utilisateurs. Pour l'activer, dans cet ordre :

1. Brancher un **nom de domaine vérifié chez Resend** et mettre `EMAIL_FROM` sur ce domaine (étape 6).
2. Vérifier que la **colocation de démo est bien marquée comme telle** : elle l'est automatiquement dès que la démo a été réinitialisée au moins une fois (étape 7). Le cron ne supprime jamais une colocation de démo.
3. Laisser tourner le cron en **simulation** quelques jours et lire dans les logs Vercel le compteur `simulees` : il liste ce qui aurait été supprimé.
4. Mettre `NETTOYAGE_AUTO_ACTIF=true` dans Vercel, puis redéployer.

Ne lance jamais ce cron en local contre la base de production.

## 10. Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `querySrv ECONNREFUSED` (logs, ou `/api/health` en 503 en local) | Le DNS du réseau refuse les requêtes SRV nécessaires à `mongodb+srv://` | En local : `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` dans `.env.local`. Sur Vercel, ce problème n'est pas attendu (variable ignorée en production) |
| `/api/health` renvoie 503 `{"ok":false}` | Adresse IP non autorisée dans Atlas, mauvais mot de passe, ou `MONGODB_URI` absente | Vérifier **Network Access** (`0.0.0.0/0`), l'utilisateur de base et la chaîne. Le détail est dans les logs Vercel (nom de l'erreur seulement) |
| `redirect_uri_mismatch` (Google) | L'URI de redirection envoyée n'est pas dans la liste de Google | Ajouter exactement `https://<domaine>/api/auth/callback/google` (schéma, domaine et chemin identiques) |
| Erreur de redirection GitHub | La callback URL de l'OAuth App ne correspond pas | Voir étape 5 : une OAuth App n'a qu'une callback URL |
| `UntrustedHost` ou « problème de configuration du serveur » | Auth.js ne reconnaît pas l'hôte. Arrive avec `npm start` hors Vercel | Définir `AUTH_TRUST_HOST=true` (hors Vercel seulement) |
| 500 sur l'export PDF, `ENOENT` sur un fichier de police dans les logs | Les fichiers de police ne sont pas copiés dans la fonction | Vérifier `outputFileTracingIncludes` dans `next.config.ts` et que `src/assets/fonts/` est dans le dépôt. Le suivi de fichiers n'a été vérifié qu'en local : à reconfirmer au premier déploiement |
| Un cron répond 401 | `CRON_SECRET` absente ou différente de celle envoyée | La définir dans Vercel (Production), redéployer, retester avec `curl -H "Authorization: Bearer ..."` |
| `/admin` répond 404 pour toi | Adresse absente de `SITE_ADMIN_EMAILS`, ou compte créé par email + mot de passe | Se connecter avec Google ou GitHub, avec une adresse listée dans `SITE_ADMIN_EMAILS` |
| Les liens des emails pointent vers `localhost` | `APP_URL` absente ou fausse | La définir sur l'adresse publique et redéployer |
| Aucun email reçu | `RESEND_API_KEY` absente, ou envoi vers une adresse autre que celle du compte Resend sans domaine | Voir étape 6 et les logs |

## 11. Autre hébergement

RoomFlow tourne sur n'importe quel hôte Node.js (20.9 ou plus) :

```bash
npm ci
npm run build
npm start
```

À prévoir :
- les mêmes variables d'environnement qu'à l'étape 3 ;
- `AUTH_TRUST_HOST=true`, sinon Auth.js refuse l'hôte ;
- un **cron externe** qui appelle chaque jour les deux routes `/api/cron/rappels-taches` et `/api/cron/nettoyage` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` (le fichier `vercel.json` n'est lu que par Vercel) ;
- `x-forwarded-for` n'est fiable que derrière un proxy qui le réécrit : la limite de tentatives de connexion par IP en dépend ;
- en production hors Vercel, la détection « production » se fait avec `NODE_ENV=production`.

Docker n'est pas fourni pour l'instant : rien n'a été construit ni testé dans ce sens.
