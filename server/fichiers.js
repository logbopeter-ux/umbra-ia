/**
 * Umbra IA — lecture des pièces jointes
 * ─────────────────────────────────────────────────────────────────────────
 * Node pur, zéro dépendance. Umbra doit pouvoir lire ce qu'on lui donne :
 * photos, PDF, Word, Excel, PowerPoint, CSV, code source, texte…
 *
 *  • images      → conservées telles quelles, envoyées au cerveau qui « voit »
 *  • documents   → texte extrait ici, injecté dans la conversation
 *  • inconnus    → refusés poliment, avec la raison
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/* ─────────────────────────── limites ─────────────────────────── */

export const LIMITE_FICHIER = 25 * 1024 * 1024; // 25 Mo par fichier
export const LIMITE_IMAGES = 6; // images par message
export const LIMITE_TEXTE = 60_000; // caractères extraits par fichier
export const LIMITE_TOTAL = 150_000; // caractères joints par message

/* ─────────────────────────── types ─────────────────────────── */

const EXT_TEXTE = new Set([
  'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'xml',
  'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue',
  'svelte', 'py', 'rb', 'php', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs',
  'swift', 'kt', 'kts', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'ini', 'conf', 'cfg',
  'toml', 'env', 'log', 'srt', 'vtt', 'tex', 'r', 'm', 'lua', 'pl', 'dart', 'scala',
  'gradle', 'properties', 'gitignore', 'dockerfile', 'makefile', 'bat', 'asm', 'sol',
]);

const EXT_IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff']);

const EXT_BUREAU = new Set([
  'pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'ott', 'rtf', 'epub', 'pages', 'numbers', 'key',
]);

const EXT_MEDIA = new Set(['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'mp4', 'webm', 'mov', 'mkv', 'avi', '3gp']);

const extension = (nom = '') => {
  const base = String(nom).toLowerCase().split(/[\\/]/).pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : base;
};

/** Devine la nature du fichier : 'image' | 'document' | 'media' | 'inconnu'. */
export function natureFichier(nom, mime = '', buf) {
  const ext = extension(nom);
  const m = String(mime).toLowerCase();

  if (m.startsWith('image/') || EXT_IMAGE.has(ext)) return 'image';
  if (m.startsWith('audio/') || m.startsWith('video/') || EXT_MEDIA.has(ext)) return 'media';

  if (buf && buf.length >= 4) {
    const sig = buf.subarray(0, 12).toString('latin1');
    if (sig.startsWith('%PDF')) return 'document';
    if (buf[0] === 0x89 && sig.startsWith('\x89PNG')) return 'image';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image';
    if (sig.startsWith('GIF8')) return 'image';
    if (sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP') return 'image';
    if (sig.startsWith('BM')) return 'image';
    if (sig.startsWith('II*\0') || sig.startsWith('MM\0*')) return 'image';
    if (sig.slice(4, 8) === 'ftyp') return 'image'; // heic, avif (nos resize côté client gèrent le reste)
    if (buf[0] === 0x50 && buf[1] === 0x4b) return 'document'; // zip / docx / xlsx / pptx
    if (sig.startsWith('ID3') || sig.startsWith('OggS') || sig.startsWith('fLaC')) return 'media';
  }

  if (EXT_BUREAU.has(ext)) return 'document';
  if (m === 'application/pdf' || m.includes('word') || m.includes('sheet') || m.includes('excel') || m.includes('presentation') || m.includes('opendocument')) {
    return 'document';
  }
  if (EXT_TEXTE.has(ext) || m.startsWith('text/') || m === 'application/json' || m === 'application/xml') {
    return 'document';
  }
  // Beaucoup de fichiers « sans extension » sont du texte : on teste.
  if (buf && buf.length) {
    const echantillon = buf.subarray(0, 1024);
    let suspects = 0;
    for (const o of echantillon) if (o === 0 || (o < 9 && o !== 0) || (o > 13 && o < 32)) suspects++;
    if (suspects / echantillon.length < 0.02) return 'document';
  }
  return 'inconnu';
}

/* ─────────────────────────── ZIP (docx, xlsx, pptx, odt…) ─────────────────────────── */

/** Lit une archive ZIP en mémoire → Map<chemin, Buffer décompressé>. */
export function lireZip(buf) {
  let eocd = -1;
  const bas = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= bas; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas une archive lisible.");

  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const fichiers = new Map();

  for (let i = 0; i < total; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(off + 10);
    const tailleComp = buf.readUInt32LE(off + 20);
    const nomLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const comLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const nom = buf.toString('utf8', off + 46, off + 46 + nomLen);

    if (localOff + 30 <= buf.length) {
      const lNomLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const debut = localOff + 30 + lNomLen + lExtraLen;
      const brut = buf.subarray(debut, debut + tailleComp);
      let data = brut;
      if (methode === 8) {
        try {
          data = zlib.inflateRawSync(brut, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
        } catch {
          data = Buffer.alloc(0);
        }
      } else if (methode !== 0) {
        data = Buffer.alloc(0); // compression exotique : ignorée
      }
      fichiers.set(nom, data);
    }
    off += 46 + nomLen + extraLen + comLen;
  }
  return fichiers;
}

/** XML → texte lisible (paragraphes préservés). */
export function xmlVersTexte(xml) {
  return String(xml)
    .replace(/<\/(w:p|a:p|text:p|text:h|si|row)>/g, '\n')
    .replace(/<w:tab\/>|<w:ptab[^>]*\/>/g, '\t')
    .replace(/<w:br\/>|<a:br\/>/g, '\n')
    .replace(/<\/w:tc>|<\/a:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function docxVersTexte(buf) {
  const zip = lireZip(buf);
  const parties = [];
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('Document Word illisible.');
  parties.push(xmlVersTexte(doc.toString('utf8')));
  const notes = [...zip.keys()].filter((n) => /^word\/footnotes\.xml$/.test(n));
  for (const n of notes) {
    const t = xmlVersTexte(zip.get(n).toString('utf8'));
    if (t) parties.push(`Notes de bas de page :\n${t}`);
  }
  return { texte: parties.join('\n\n'), info: 'Document Word' };
}

function xlsxVersTexte(buf) {
  const zip = lireZip(buf);
  const partagees = [];
  const sst = zip.get('xl/sharedStrings.xml');
  if (sst) {
    const xml = sst.toString('utf8');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      partagees.push(xmlVersTexte(m[1]).replace(/\n/g, ' '));
    }
  }

  const feuilles = [...zip.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  const blocs = [];
  feuilles.forEach((nomFeuille, index) => {
    const xml = zip.get(nomFeuille).toString('utf8');
    const lignes = [];
    for (const ligne of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cellules = [];
      for (const c of ligne[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[1];
        const t = (attrs.match(/t="([^"]+)"/) || [])[1];
        const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
        const inline = (c[2].match(/<is>([\s\S]*?)<\/is>/) || [])[1];
        if (t === 's') cellules.push(partagees[Number(v)] ?? '');
        else if (inline) cellules.push(xmlVersTexte(inline).replace(/\n/g, ' '));
        else cellules.push(v);
      }
      if (cellules.some((x) => x !== '')) lignes.push(cellules.join('\t'));
    }
    if (lignes.length) blocs.push(`Feuille ${index + 1} :\n${lignes.slice(0, 600).join('\n')}`);
  });

  return { texte: blocs.join('\n\n'), info: `Classeur Excel (${feuilles.length} feuille(s))` };
}

function pptxVersTexte(buf) {
  const zip = lireZip(buf);
  const diapos = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const blocs = diapos.map((n, i) => {
    const t = xmlVersTexte(zip.get(n).toString('utf8'));
    return t ? `Diapositive ${i + 1} :\n${t}` : '';
  });
  return { texte: blocs.filter(Boolean).join('\n\n'), info: `Présentation (${diapos.length} diapositives)` };
}

function odfVersTexte(buf, nom) {
  const zip = lireZip(buf);
  const content = zip.get('content.xml');
  if (!content) throw new Error('Document OpenDocument illisible.');
  return { texte: xmlVersTexte(content.toString('utf8')), info: extension(nom).toUpperCase() };
}

function epubVersTexte(buf) {
  const zip = lireZip(buf);
  const pages = [...zip.keys()].filter((n) => /\.x?html?$/i.test(n)).sort();
  const blocs = pages.slice(0, 40).map((n) => xmlVersTexte(zip.get(n).toString('utf8')));
  return { texte: blocs.join('\n\n'), info: `Livre (${pages.length} sections)` };
}

/* ─────────────────────────── PDF ─────────────────────────── */

const ECHAPPEMENTS = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

function literalPdf(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === undefined) break;
    if (ECHAPPEMENTS[n] !== undefined) out += ECHAPPEMENTS[n];
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n === '\n') {
      /* continuation de ligne : rien */
    } else out += n;
  }
  return out;
}

/** Extrait le texte des flux de contenu d'un PDF (non chiffré, texte sélectionnable). */
export function pdfVersTexte(buf) {
  const brut = buf.toString('latin1');
  const flux = [];
  let i = 0;
  while (true) {
    const a = brut.indexOf('stream', i);
    if (a < 0) break;
    let d = a + 6;
    if (brut[d] === '\r') d++;
    if (brut[d] === '\n') d++;
    const b = brut.indexOf('endstream', d);
    if (b < 0) break;
    const donnees = buf.subarray(d, b);
    let decode = null;
    for (const fn of [
      () => zlib.inflateSync(donnees, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
      () => zlib.inflateRawSync(donnees, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
    ]) {
      try {
        decode = fn();
        break;
      } catch {
        /* ce flux n'est pas compressé, ou pas du texte */
      }
    }
    const texte = (decode || donnees).toString('latin1');
    if (/\bT[Jj]\b/.test(texte) || /\bTJ\b/.test(texte)) flux.push(texte);
    i = b + 9;
  }

  const morceaux = [];
  const jeton = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]{2,4000})>\s*(?:Tj|TJ|'|")|\bT[dD]\b|\bT\*|\bET\b|\bTJ\b|\bTj\b/g;
  for (const fluxTexte of flux) {
    let m;
    while ((m = jeton.exec(fluxTexte))) {
      const v = m[0];
      if (v.startsWith('(')) {
        morceaux.push(literalPdf(v.slice(1, v.lastIndexOf(')'))));
      } else if (v.startsWith('<')) {
        const hex = v.slice(1, v.indexOf('>')).replace(/\s+/g, '');
        let s = '';
        // UTF-16BE (fréquent dans les PDF récents)
        for (let k = 0; k + 3 < hex.length; k += 4) {
          const code = parseInt(hex.slice(k, k + 4), 16);
          if (code) s += String.fromCharCode(code);
        }
        if (!s && hex.length >= 2) {
          for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
        }
        morceaux.push(s);
      } else if (v === 'Td' || v === 'TD' || v === 'T*' || v === 'ET') {
        morceaux.push('\n');
      } else {
        morceaux.push(' ');
      }
    }
    morceaux.push('\n');
  }

  const texte = morceaux
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const pages = Math.max(1, (brut.match(/\/Type\s*\/Page[^s]/g) || []).length);
  // Un PDF dont on n'extrait presque rien est presque toujours une page
  // scannée (une image) : il faut le dire, pas inventer un résumé.
  const avertissement =
    texte.replace(/\s/g, '').length < 5
      ? "Ce PDF ne contient pas de texte sélectionnable (probablement une page scannée). Envoie-moi une photo de la page : je saurai la lire."
      : null;

  return { texte, pages, info: `PDF (${pages} page(s))`, avertissement };
}

/* ─────────────────────────── extraction ─────────────────────────── */

/**
 * Analyse un fichier et renvoie tout ce qu'Umbra doit savoir.
 * @returns {{categorie, texte, info, pages, avertissement, tronque}}
 */
export async function extraire({ nom = 'fichier', mime = '', buffer }) {
  if (!buffer?.length) throw new Error('Fichier vide.');
  if (buffer.length > LIMITE_FICHIER) {
    throw new Error(`Fichier trop lourd (${(buffer.length / 1048576).toFixed(1)} Mo). La limite est de 25 Mo.`);
  }

  const categorie = natureFichier(nom, mime, buffer);
  if (categorie === 'image') return { categorie, texte: '', info: 'Image', pages: 1, avertissement: null, tronque: false };
  if (categorie === 'media') {
    return {
      categorie,
      texte: '',
      info: 'Média (audio/vidéo)',
      pages: 0,
      avertissement: "Umbra ne sait pas encore écouter les fichiers audio ni regarder les vidéos — décris-lui ou envoie une image.",
      tronque: false,
    };
  }
  if (categorie === 'inconnu') {
    return {
      categorie,
      texte: '',
      info: 'Format binaire',
      pages: 0,
      avertissement: "Je ne connais pas ce format. Essaie un PDF, un document Word/Excel, une image ou un fichier texte.",
      tronque: false,
    };
  }

  const ext = extension(nom);
  const sig = buffer.subarray(0, 8).toString('latin1');
  let r;

  try {
    if (sig.startsWith('%PDF') || ext === 'pdf') r = pdfVersTexte(buffer);
    else if (sig.startsWith('PK')) {
      if (ext === 'docx' || ext === 'docm') r = docxVersTexte(buffer);
      else if (ext === 'xlsx' || ext === 'xlsm') r = xlsxVersTexte(buffer);
      else if (ext === 'pptx') r = pptxVersTexte(buffer);
      else if (ext === 'epub') r = epubVersTexte(buffer);
      else if (['odt', 'ods', 'odp', 'ott'].includes(ext)) r = odfVersTexte(buffer, nom);
      else r = { texte: '', info: 'Archive ZIP', avertissement: "C'est une archive : décompresse-la et envoie ce qu'elle contient." };
    } else if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
      r = {
        texte: ancienOffice(buffer),
        info: 'Ancien format Office',
        avertissement: 'Ancien format (.doc/.xls/.ppt) : la lecture est approximative. Un enregistrement en .docx/.xlsx donne un bien meilleur résultat.',
      };
    } else {
      r = { texte: buffer.toString('utf8'), info: 'Fichier texte' };
    }
  } catch (e) {
    throw new Error(`Lecture impossible : ${e.message}`);
  }

  let texte = String(r.texte || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

  let tronque = false;
  if (texte.length > LIMITE_TEXTE) {
    texte = texte.slice(0, LIMITE_TEXTE);
    tronque = true;
  }

  const avertissement =
    r.avertissement || (tronque ? `Fichier long : je n'ai lu que les ${Math.round(LIMITE_TEXTE / 1000)} 000 premiers caractères.` : null);

  return {
    categorie,
    texte,
    info: r.info || 'Fichier',
    pages: r.pages || 0,
    avertissement,
    tronque,
  };
}

/** Récupère les chaînes lisibles d'un vieux .doc / .xls (texte entre octets imprimables). */
function ancienOffice(buffer) {
  const mots = [];
  const texte = buffer.toString('latin1');
  let courant = '';
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (c === 9 || c === 10 || (c >= 32 && c < 127) || c >= 160) {
      courant += texte[i];
    } else {
      if (courant.length >= 4) mots.push(courant);
      courant = '';
    }
  }
  if (courant.length >= 4) mots.push(courant);
  return mots.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/* ─────────────────────────── stockage ─────────────────────────── */

/**
 * Garde les pièces jointes sur disque pour que l'historique reste lisible
 * après un redémarrage. Une rotation automatique empêche le disque de gonfler.
 */
export function creerStockage(dir, { conserver = 300 } = {}) {
  fsSync.mkdirSync(dir, { recursive: true });

  const chemin = (id) => path.join(dir, `${id}.json`);
  const cheminDonnees = (id) => path.join(dir, `${id}.bin`);
  const propre = (id) => /^[a-z0-9]{6,40}$/i.test(String(id || ''));

  async function enregistrer({ nom = 'fichier', mime = '', buffer }) {
    const analyse = await extraire({ nom, mime, buffer });
    const id = crypto.randomBytes(12).toString('hex');
    const meta = {
      id,
      nom: String(nom).slice(0, 200),
      mime: String(mime || '').slice(0, 120),
      taille: buffer.length,
      categorie: analyse.categorie,
      info: analyse.info,
      pages: analyse.pages,
      avertissement: analyse.avertissement,
      tronque: analyse.tronque,
      apercu: analyse.texte.slice(0, 300).replace(/\s+/g, ' '),
      texte: analyse.texte,
      cree: new Date().toISOString(),
    };
    await fs.writeFile(chemin(id), JSON.stringify(meta), 'utf8');
    if (analyse.categorie === 'image') await fs.writeFile(cheminDonnees(id), buffer);
    rotation().catch(() => {});
    return meta;
  }

  async function lire(id) {
    if (!propre(id)) return null;
    try {
      return JSON.parse(await fs.readFile(chemin(id), 'utf8'));
    } catch {
      return null;
    }
  }

  async function donnees(id) {
    if (!propre(id)) return null;
    try {
      return await fs.readFile(cheminDonnees(id));
    } catch {
      return null;
    }
  }

  async function supprimer(id) {
    if (!propre(id)) return false;
    await fs.rm(chemin(id), { force: true });
    await fs.rm(cheminDonnees(id), { force: true });
    return true;
  }

  async function rotation() {
    const noms = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json'));
    if (noms.length <= conserver) return;
    const infos = await Promise.all(
      noms.map(async (n) => ({ n, s: await fs.stat(path.join(dir, n)).catch(() => ({ mtimeMs: 0 })) })),
    );
    infos.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
    for (const { n } of infos.slice(0, infos.length - conserver)) {
      const id = n.replace(/\.json$/, '');
      await supprimer(id).catch(() => {});
    }
  }

  return { enregistrer, lire, donnees, supprimer, rotation };
}
