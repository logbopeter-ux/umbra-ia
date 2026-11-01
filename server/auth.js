/**
 * Umbra IA — protection par mot de passe (hébergement en ligne)
 *
 * Activée dès que UMBRA_PASSWORD est défini. Sans mot de passe, aucune
 * protection : c'est le mode « sur ma machine ».
 *
 * • Cookie de session signé (HMAC-SHA256), httpOnly, SameSite=Lax
 * • Expiration 30 jours, révocable en changeant UMBRA_SESSION_SECRET
 * • Limitation des tentatives : 6 échecs / 10 min / IP
 */
import crypto from 'node:crypto';

const COOKIE = 'umbra_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 10 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth(env = process.env) {
  const password = env.UMBRA_PASSWORD || '';
  const enabled = password.length > 0;

  const secret =
    env.UMBRA_SESSION_SECRET ||
    crypto.createHash('sha256').update(`umbra-session:${password}:${env.UMBRA_INSTANCE_ID || 'local'}`).digest('hex');

  /** ip → { count, until } */
  const attempts = new Map();

  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  function issueToken() {
    const payload = b64url(JSON.stringify({ exp: Date.now() + TTL_MS, n: crypto.randomBytes(8).toString('hex') }));
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (!enabled) return true;
    if (!token || typeof token !== 'string') return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    if (!timingSafeEqual(sign(payload), sig)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof data.exp === 'number' && data.exp > Date.now();
    } catch {
      return false;
    }
  }

  /** Jeton envoyé dans l'en-tête Authorization (app mobile / cross-origin). */
  function tokenFromHeader(req) {
    const raw = String(req.headers.authorization || '');
    const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
    if (m) return m[1].trim();
    // Une balise <img> ne peut pas porter d'en-tête : le jeton peut venir de
    // l'adresse (?t=…), uniquement pour les images de l'historique.
    try {
      const jeton = new URL(req.url, 'http://localhost').searchParams.get('t');
      return jeton ? String(jeton) : '';
    } catch {
      return '';
    }
  }

  function isAuthenticated(req) {
    if (!enabled) return true;
    // 1) jeton explicite — nécessaire quand le cookie ne peut pas circuler
    //    (APK Capacitor : origine https://localhost → serveur distant,
    //    SameSite=Lax bloque le cookie cross-site).
    if (verifyToken(tokenFromHeader(req))) return true;
    // 2) cookie de session classique (navigateur sur le même domaine)
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE]);
  }

  function checkPassword(candidate) {
    if (!enabled) return true;
    if (typeof candidate !== 'string') return false;
    // comparaison à temps constant sur les empreintes
    const h = (s) => crypto.createHash('sha256').update(s).digest();
    return timingSafeEqual(h(candidate), h(password));
  }

  function noteAttempt(ip) {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.until < now) {
      attempts.set(ip, { count: 1, until: now + WINDOW_MS });
      return { blocked: false, remaining: MAX_ATTEMPTS - 1 };
    }
    entry.count += 1;
    return { blocked: entry.count >= MAX_ATTEMPTS, remaining: Math.max(0, MAX_ATTEMPTS - entry.count) };
  }

  function resetAttempts(ip) {
    attempts.delete(ip);
  }

  function isBlocked(ip) {
    const entry = attempts.get(ip);
    return Boolean(entry && entry.until > Date.now() && entry.count >= MAX_ATTEMPTS);
  }

  function cookieHeader(token, secure) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(TTL_MS / 1000)}`];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  function clearCookie(secure) {
    const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  const clientIp = (req) =>
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'inconnu';

  const isSecure = (req) =>
    (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || Boolean(req.socket?.encrypted);

  return {
    enabled,
    COOKIE,
    isAuthenticated,
    checkPassword,
    issueToken,
    verifyToken,
    noteAttempt,
    resetAttempts,
    isBlocked,
    cookieHeader,
    clearCookie,
    clientIp,
    isSecure,
  };
}
