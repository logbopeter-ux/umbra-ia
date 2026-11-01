# 📎 Pièces jointes — photos, PDF, documents

Umbra lit ce que vous lui donnez. Pas besoin de convertir, d'extraire ou de
copier-coller : on joint, on écrit une consigne, on envoie.

---

## Comment joindre un fichier

Trois chemins, tous équivalents.

| Méthode | Sur ordinateur | Sur téléphone |
|---|---|---|
| **Le trombone 📎** | cliquer sur le trombone, à gauche du champ | toucher le trombone → « Fichiers » ou « Photos » |
| **Glisser-déposer** | faire glisser le fichier n'importe où sur la fenêtre | — |
| **Copier-coller** | `Ctrl+V` après une capture d'écran | `Partager → Umbra` depuis la galerie |

On peut joindre **plusieurs fichiers** au même message, et écrire en même temps.
Chaque fichier apparaît en vignette au-dessus du champ, avec son nom, son type et
son poids. La croix ✕ le retire avant l'envoi.

---

## Ce qu'Umbra sait lire

### Les images — elle regarde vraiment

| Formats | `.jpg` `.png` `.webp` `.gif` `.bmp` `.heic` `.avif` `.tiff` |
|---|---|
| **Ce qu'elle en fait** | elle décrit la scène, lit le texte visible, répond à la question posée |

Une photo de facture, un tableau blanc, une capture d'écran, un document
photographié au téléphone : elle lit. Si une image contient du texte, elle le
transcrit.

> Les photos de téléphone (4 à 8 Mo) sont réduites à 1600 px avant l'envoi —
> aucun modèle n'y gagne en détail, et l'envoi passe de plusieurs secondes à
> un instant.

### Les documents — elle les lit vraiment

| Type | Formats | Rendu |
|---|---|---|
| **PDF** | `.pdf` | texte page par page |
| **Word** | `.docx` `.docm` | paragraphes reconstitués |
| **Excel** | `.xlsx` `.xlsm` | tableaux cellule par cellule |
| **PowerPoint** | `.pptx` | diapositive par diapositive |
| **OpenDocument** | `.odt` `.ods` `.odp` | contenu complet |
| **Livre** | `.epub` | texte des sections |
| **Texte brut** | `.txt` `.md` `.csv` `.log` `.srt` | intégral |
| **Données** | `.json` `.yaml` `.xml` `.toml` `.ini` | intégral |
| **Code** | `.py` `.js` `.ts` `.java` `.c` `.go` `.rs` `.sql` `.sh`… | intégral |
| **Anciens Office** | `.doc` `.xls` `.ppt` | lecture approximative (voir plus bas) |

Un fichier sans extension qui contient du texte est reconnu quand même : Umbra
renifle les octets avant de décider.

### Ce qu'elle ne sait pas (encore) faire

| Cas | Ce qui se passe |
|---|---|
| **Audio et vidéo** (`.mp3`, `.mp4`…) | Umbra le dit franchement et propose une alternative |
| **PDF scanné** (une photo de page) | Elle prévient : « envoie-moi plutôt une photo de la page » — et là, elle lit |
| **Archives** `.zip` `.rar` | Elle demande de décompresser d'abord |
| **Exécutables, bases de données** | Refusés avec explication |
| **Anciens `.doc`/`.xls`/`.ppt`** | Lecture partielle : réenregistrer en `.docx`/`.xlsx` donne un résultat propre |
| **Fichiers > 25 Mo** | Refusés avant l'envoi |

---

## Les limites, en clair

| Limite | Valeur | Pourquoi |
|---|---|---|
| Poids par fichier | **25 Mo** | au-delà, l'envoi devient pénible sur mobile |
| Images par message | **6** | au-delà, le modèle perd le fil |
| Texte extrait par document | 60 000 caractères | ~30 pages ; le reste est signalé |
| Texte total par message | 150 000 caractères | la fenêtre de contexte des modèles |
| Conservation | 300 pièces jointes | rotation automatique, les plus anciennes partent |

Quand un document est tronqué, Umbra le dit : « je n'ai lu que les 60 000
premiers caractères ». Pas de faux résumé sur un texte qu'elle n'a pas vu.

---

## Ce qui se passe côté serveur

1. **Le fichier arrive** en base64 (une seule requête, pas de multipart).
2. **Il est identifié** par son extension *et* par sa signature binaire — un
   `.pdf` renommé en `.txt` reste un PDF.
3. **Son texte est extrait** : décompression des flux PDF, lecture des archives
   ZIP internes de Word/Excel/PowerPoint, reconstitution des paragraphes et des
   cellules.
4. **Il est stocké** dans `data/fichiers/` : le texte dans un `.json`, les images
   en `.bin`. Rien ne part ailleurs.
5. **Au moment de l'envoi au cerveau**, le texte est inséré dans la conversation,
   balisé `--- Fichier joint : nom --- … --- fin ---`. Le modèle sait exactement
   ce qui vient du document et ce qui vient de vous.

Les images, elles, partent en base64 vers un cerveau qui **voit**. Les cerveaux
aveugles (Groq `gpt-oss`, Ollama `llama3.1`) reçoivent une note à la place —
jamais un 400.

---

## Quels cerveaux voient les images

| Cerveau | Vision | Remarque |
|---|---|---|
| **Gemini** | ✅ | le plus rapide pour lire du texte dans une image |
| **Claude** | ✅ | excellent sur les schémas et les documents dense |
| **OpenAI** | ✅ | selon le modèle (`gpt-4o` et suivants) |
| **OpenRouter** | ✅ | selon le modèle choisi |
| **Groq** (`gpt-oss-120b`) | ❌ | modèle texte : la question est reformulée sans l'image |
| **Ollama** (`llama3.1`) | ❌ | sauf `llava`, `qwen2.5vl`, `gemma3` |
| **Ollama vision** | ✅ | `ollama pull llava` ou `ollama pull qwen2.5vl` |

Quand une image est jointe, Umbra **réordonne la chaîne** : les cerveaux qui
voient passent devant. Si aucun ne voit, elle explique au lieu d'échouer.

---

## Exemples qui marchent

```
« Voici ma facture, vérifie le total »           + facture.jpg
« Résume ce contrat en 5 points »                + bail.pdf
« Compare ces deux tableaux »                    + prix-2025.xlsx + prix-2026.xlsx
« Corrige ce code »                              + script.py
« Qu'est-ce qui ne va pas sur cette capture ? »  + capture.png
« Transcris cette page »                         + page.docx
```

---

## Sur le téléphone

Le trombone ouvre le sélecteur Android : **Photos**, **Fichiers**, **Appareil
photo**. Tout ce que le téléphone sait produire passe — y compris les photos
`HEIC` d'iPhone (converties à l'envoi) et les PDF téléchargés.

Après envoi, une vignette reste dans la bulle. On la touche pour l'agrandir en
plein écran, on touche à côté ou on appuie sur `Échap` pour fermer.
