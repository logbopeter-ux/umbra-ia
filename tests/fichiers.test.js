/**
 * Umbra IA — tests des pièces jointes
 * On fabrique de vrais fichiers (PDF, DOCX, XLSX, textes) et on vérifie que
 * le serveur en extrait correctement le contenu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extraire, natureFichier, lireZip, xmlVersTexte, pdfVersTexte, creerStockage, LIMITE_FICHIER } from '../server/fichiers.js';

/* ─────────────── fabriques de fichiers ─────────────── */

/** Un PDF minimal mais valide, avec un flux compressé. */
function fabriquerPdf(phrase) {
  const flux = zlib.deflateSync(Buffer.from(`BT /F1 12 Tf 50 700 Td (${phrase}) Tj ET`, 'latin1'));
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
  ];
  const morceaux = [Buffer.from('%PDF-1.4\n', 'latin1')];
  objets.forEach((o, i) => morceaux.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')));
  morceaux.push(Buffer.concat([Buffer.from(`4 0 obj\n<< /Length ${flux.length} /Filter /FlateDecode >>\nstream\n`), flux, Buffer.from('\nendstream\nendobj\n')]));
  morceaux.push(Buffer.from('trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF'));
  return Buffer.concat(morceaux);
}

/** Une archive ZIP valide (méthode deflate). */
function fabriquerZip(fichiers) {
  const locaux = [];
  const centraux = [];
  let decalage = 0;

  for (const [nom, contenu] of Object.entries(fichiers)) {
    const data = Buffer.from(contenu, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nomBuf = Buffer.from(nom, 'utf8');
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nomBuf.length, 26);
    locaux.push(local, nomBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nomBuf.length, 28);
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, nomBuf);

    decalage += local.length + nomBuf.length + comp.length;
  }

  const dossier = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(fichiers).length, 8);
  fin.writeUInt16LE(Object.keys(fichiers).length, 10);
  fin.writeUInt32LE(dossier.length, 12);
  fin.writeUInt32LE(decalage, 16);

  return Buffer.concat([...locaux, dossier, fin]);
}

const docx = (texte) =>
  fabriquerZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${texte
      .split('\n')
      .map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
  });

const xlsx = (lignes, partagees) =>
  fabriquerZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${partagees.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${lignes
      .map(
        (ligne, i) =>
          `<row r="${i + 1}">${ligne
            .map((cellule, j) =>
              typeof cellule === 'number'
                ? `<c r="${'AB'[j]}${i + 1}"><v>${cellule}</v></c>`
                : `<c r="${'AB'[j]}${i + 1}" t="s"><v>${partagees.indexOf(cellule)}</v></c>`,
            )
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`,
  });

/* ─────────────── reconnaissance ─────────────── */

test('natureFichier : reconnaît images, documents et binaires', () => {
  assert.equal(natureFichier('photo.jpg', 'image/jpeg'), 'image');
  assert.equal(natureFichier('PHOTO.PNG', ''), 'image');
  assert.equal(natureFichier('facture.pdf', 'application/pdf'), 'document');
  assert.equal(natureFichier('notes.md', ''), 'document');
  assert.equal(natureFichier('script.py', ''), 'document');
  assert.equal(natureFichier('musique.mp3', ''), 'media');
  assert.equal(natureFichier('programme.exe', '', Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x00])), 'inconnu');
  // signature binaire > extension trompeuse
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(natureFichier('fichier.bin', '', png), 'image');
});

/* ─────────────── extraction ─────────────── */

test('PDF : le texte est extrait malgré la compression', async () => {
  const r = await extraire({ nom: 'lettre.pdf', mime: 'application/pdf', buffer: fabriquerPdf('Le loyer est de 45000 francs.') });
  assert.equal(r.categorie, 'document');
  assert.match(r.texte, /45000 francs/);
  assert.equal(r.pages, 1);
  assert.equal(r.avertissement, null);
});

test('PDF : un document sans texte le dit clairement', async () => {
  const r = await extraire({ nom: 'scan.pdf', mime: 'application/pdf', buffer: fabriquerPdf('') });
  assert.equal(r.categorie, 'document');
  assert.match(r.avertissement, /scannée|texte/i);
});

test('DOCX : les paragraphes sont reconstitués', async () => {
  const r = await extraire({ nom: 'bail.docx', buffer: docx('Contrat de bail\nLoyer : 45000 FCFA\nDurée : 12 mois') });
  assert.equal(r.info, 'Document Word');
  assert.match(r.texte, /Contrat de bail/);
  assert.match(r.texte, /45000 FCFA/);
  assert.match(r.texte, /12 mois/);
  assert.ok(r.texte.indexOf('Contrat') < r.texte.indexOf('Durée'), 'l’ordre des paragraphes est conservé');
});

test('XLSX : les cellules forment un tableau lisible', async () => {
  const r = await extraire({
    nom: 'prix.xlsx',
    buffer: xlsx(
      [
        ['Produit', 'Prix'],
        ['Riz', 12000],
        ['Tomate', 800],
      ],
      ['Produit', 'Prix', 'Riz', 'Tomate'],
    ),
  });
  assert.match(r.info, /Classeur Excel/);
  assert.match(r.texte, /Produit\tPrix/);
  assert.match(r.texte, /Riz\t12000/);
});

test('texte et code : lus tels quels', async () => {
  const r = await extraire({ nom: 'notes.md', buffer: Buffer.from('# Notes\n\n- Acheter du riz') });
  assert.equal(r.categorie, 'document');
  assert.match(r.texte, /Acheter du riz/);
});

test('image : conservée en tant qu’image, sans texte', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const r = await extraire({ nom: 'photo.png', buffer: png });
  assert.equal(r.categorie, 'image');
  assert.equal(r.texte, '');
});

test('média : refusé avec une explication, pas une erreur', async () => {
  const r = await extraire({ nom: 'chanson.mp3', buffer: Buffer.from('ID3fake') });
  assert.equal(r.categorie, 'media');
  assert.match(r.avertissement, /audio|vidéo/i);
});

test('archive ZIP inconnue : oriente vers la décompression', async () => {
  const r = await extraire({ nom: 'dossier.zip', buffer: fabriquerZip({ 'a.txt': 'x' }) });
  assert.equal(r.categorie, 'document');
  assert.match(r.avertissement, /archive/i);
});

test('fichier trop lourd : refusé avant lecture', async () => {
  const gros = Buffer.alloc(LIMITE_FICHIER + 10);
  await assert.rejects(() => extraire({ nom: 'enorme.pdf', buffer: gros }), /trop lourd/);
});

test('fichier vide : refusé', async () => {
  await assert.rejects(() => extraire({ nom: 'vide.txt', buffer: Buffer.alloc(0) }), /vide/);
});

test('texte très long : tronqué proprement', async () => {
  const long = Buffer.from('a'.repeat(90_000));
  const r = await extraire({ nom: 'roman.txt', buffer: long });
  assert.equal(r.texte.length, 60_000);
  assert.equal(r.tronque, true);
  assert.match(r.avertissement, /60 000/);
});

/* ─────────────── outils bas niveau ─────────────── */

test('xmlVersTexte : entités et balises correctement traitées', () => {
  assert.equal(xmlVersTexte('<w:p><w:r><w:t>a &amp; b &lt;c&gt;</w:t></w:r></w:p>'), 'a & b <c>');
});

test('lireZip : refuse une archive illisible', () => {
  assert.throws(() => lireZip(Buffer.from('pas un zip')), /archive/i);
});

test('pdfVersTexte : texte échappé et hexadécimal', () => {
  const pdf = Buffer.from('%PDF-1.4\nstream\nBT (\\(parenth\\) et \\\\ fin) Tj ET\nendstream');
  assert.match(pdfVersTexte(pdf).texte, /\(parenth\) et \\ fin/);
});

/* ─────────────── stockage ─────────────── */

test('stockage : enregistre, relit et supprime une pièce jointe', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-pj-'));
  const s = creerStockage(dir);

  const meta = await s.enregistrer({ nom: 'lettre.pdf', mime: 'application/pdf', buffer: fabriquerPdf('Bonjour Monsieur.') });
  assert.match(meta.id, /^[a-f0-9]{24}$/);
  assert.match(meta.texte, /Bonjour Monsieur/);
  assert.ok(meta.apercu.length > 0, 'un aperçu est conservé');

  const relu = await s.lire(meta.id);
  assert.equal(relu.nom, 'lettre.pdf');
  assert.equal(await s.donnees(meta.id), null, 'un document ne stocke pas ses octets bruts');

  await s.supprimer(meta.id);
  assert.equal(await s.lire(meta.id), null);

  await fs.rm(dir, { recursive: true, force: true });
});

test('stockage : les images gardent leurs octets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-pj-'));
  const s = creerStockage(dir);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 7)]);

  const meta = await s.enregistrer({ nom: 'photo.png', mime: 'image/png', buffer: png });
  const octets = await s.donnees(meta.id);
  assert.equal(octets.length, png.length);
  assert.deepEqual(octets, png);

  await fs.rm(dir, { recursive: true, force: true });
});

test('stockage : un identifiant douteux ne sort pas du dossier', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'umbra-pj-'));
  const s = creerStockage(dir);
  assert.equal(await s.lire('../../.env'), null);
  assert.equal(await s.donnees('..%2F..%2Fetc%2Fpasswd'), null);
  await fs.rm(dir, { recursive: true, force: true });
});
