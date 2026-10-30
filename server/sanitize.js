/**
 * Nettoyage de l'historique de conversation avant envoi au fournisseur d'IA.
 *
 * Pourquoi c'est indispensable : quand un appel échoue (429, 503, coupure),
 * l'interface enregistre un message « assistant » vide pour afficher l'erreur.
 * Cet historique est ensuite renvoyé tel quel au modèle — et l'API Gemini
 * (compatibilité OpenAI) REJETTE toute requête contenant un contenu vide avec
 * un 400 INVALID_ARGUMENT. Résultat : le fil entier devient inutilisable,
 * quelle que soit la question posée. On filtre donc les messages vides ici.
 */
export function sanitizeMessages(list, { maxMessages = 40, maxChars = 12000 } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, maxChars) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-maxMessages);
}
