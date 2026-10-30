"""
Umbra IA — les « mains » de l'agent vocal.

Chaque outil est une simple enveloppe HTTP vers le serveur Umbra local
(http://localhost:4173). Ainsi, la voix et le texte partagent EXACTEMENT
les mêmes capacités : recherche web, lecture de page, calcul, notes,
Python, pilotage du navigateur, mémoire.

Un outil = un nom clair + une description claire + une règle dans le prompt.
"""

import logging
import os

import httpx
from livekit.agents import RunContext, function_tool

SERVER = os.getenv("UMBRA_SERVER", "http://localhost:4173")
TIMEOUT = float(os.getenv("UMBRA_TOOL_TIMEOUT", "45"))
# En mode vocal, les actions risquées sont confirmées oralement par l'utilisateur.
AUTO_CONFIRM = os.getenv("UMBRA_VOICE_AUTOCONFIRM", "1") == "1"

logger = logging.getLogger("umbra.tools")


async def _call(name: str, args: dict, confirm: bool = True) -> str:
    """Appelle un outil du serveur Umbra et renvoie un texte lisible à voix haute."""
    payload = {"name": name, "args": args, "confirm": confirm}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(f"{SERVER}/api/tool", json=payload)
            if res.status_code == 404:
                return (
                    "Le serveur Umbra ne répond pas. Demande à l'utilisateur de lancer "
                    "« npm start » dans le dossier umbra-ia."
                )
            data = res.json()
    except Exception as exc:  # noqa: BLE001
        logger.error("Outil %s injoignable : %s", name, exc)
        return f"Je n'ai pas pu joindre le serveur Umbra ({exc})."

    if data.get("requires_approval"):
        return "Cette action doit être confirmée par l'utilisateur."

    text = str(data.get("summary") or data.get("error") or "").strip()
    if not data.get("ok", True):
        return f"L'action a échoué : {text}"
    return text or "C'est fait."


@function_tool()
async def search_web(context: RunContext, query: str) -> str:
    """Cherche sur internet une information actuelle (météo, actualité, prix, horaires…).
    Utilise cet outil dès que la question porte sur quelque chose de récent ou que tu ignores."""
    return await _call("web_search", {"query": query, "max": 4})


@function_tool()
async def read_page(context: RunContext, url: str) -> str:
    """Ouvre une adresse web et lit son contenu texte. Utile pour résumer un article ou une page."""
    return await _call("fetch_page", {"url": url})


@function_tool()
async def calculate(context: RunContext, expression: str) -> str:
    """Calcule une expression mathématique exacte, par exemple « 1250*0.18+75 »."""
    return await _call("calculator", {"expression": expression})


@function_tool()
async def current_datetime(context: RunContext) -> str:
    """Donne la date, l'heure et le jour actuels. Utilise-le dès qu'on parle de « maintenant »."""
    return await _call("get_current_datetime", {})


@function_tool()
async def remember(context: RunContext, content: str) -> str:
    """Retient durablement une information utile sur l'utilisateur (préférence, projet, prénom
    d'un proche). N'enregistre jamais de mot de passe, de clé ou de donnée bancaire."""
    return await _call("remember", {"content": content})


@function_tool()
async def take_note(context: RunContext, name: str, content: str, append: bool = True) -> str:
    """Écrit ou complète une note dans le carnet local (ex. « agenda », « courses »)."""
    return await _call(
        "notes",
        {"action": "append" if append else "write", "name": name, "content": content},
        confirm=AUTO_CONFIRM,
    )


@function_tool()
async def list_notes(context: RunContext) -> str:
    """Liste les notes enregistrées dans le carnet."""
    return await _call("notes", {"action": "list"})


@function_tool()
async def run_python(context: RunContext, code: str) -> str:
    """Exécute un court script Python sur l'ordinateur et renvoie sa sortie.
    À utiliser pour un calcul complexe ou un traitement de données."""
    return await _call("run_python", {"code": code}, confirm=AUTO_CONFIRM)


@function_tool()
async def control_browser(context: RunContext, action: str, url: str = "", selector: str = "", text: str = "") -> str:
    """Pilote le navigateur Chrome de l'ordinateur. Actions possibles :
    goto (ouvrir une adresse), read (lire la page), click (cliquer via un sélecteur CSS),
    type (remplir un champ), press (appuyer sur une touche), back (retour), screenshot, close."""
    args = {"action": action}
    if url:
        args["url"] = url
    if selector:
        args["selector"] = selector
    if text:
        args["text"] = text
    return await _call("browser_control", args, confirm=AUTO_CONFIRM)


@function_tool()
async def open_url(context: RunContext, url: str) -> str:
    """Ouvre une adresse dans le navigateur de l'utilisateur, pour la lui montrer."""
    return await _call("open_url", {"url": url}, confirm=AUTO_CONFIRM)


ALL_TOOLS = [
    search_web,
    read_page,
    calculate,
    current_datetime,
    remember,
    take_note,
    list_notes,
    run_python,
    control_browser,
    open_url,
]
