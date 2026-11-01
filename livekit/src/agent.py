"""
Umbra IA — Agent vocal temps réel (LiveKit + Gemini Live)

Reprend l'architecture du guide « Ton propre Jarvis » :
  • Oreilles et bouche  → LiveKit Agents + Gemini Live (audio natif)
  • Cerveau             → Gemini Live (modèle temps réel)
  • Yeux                → vidéo (caméra) + partage d'écran
  • Mains               → les outils d'Umbra (serveur local HTTP : recherche, Python, navigateur, notes…)
  • Visage              → l'interface Umbra IA (web installable) ou le playground LiveKit

Lancement :
    lk agent dev            # avec la CLI LiveKit (recommandé)
    python src/agent.py dev # équivalent
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, room_io
from livekit.plugins import noise_cancellation

from prompt import SYSTEM_PROMPT
from tools import ALL_TOOLS

# .env.local à la racine du dossier livekit/
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env.local")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("umbra")

# Modèle temps réel. « gemini-live-2.5-flash-preview » n'est plus proposé aux
# nouvelles clés API ; l'alias « -latest » ci-dessous pointe sur la version
# native-audio courante. Alternatives disponibles (vérifiées sur l'API) :
#   gemini-2.5-flash-native-audio-preview-12-2025
#   gemini-3.1-flash-live-preview   (plus récent, parfois saturé)
MODEL = os.getenv("UMBRA_LIVE_MODEL", "gemini-2.5-flash-native-audio-latest")
VOICE = os.getenv("UMBRA_LIVE_VOICE", "Charon")
TEMPERATURE = float(os.getenv("UMBRA_LIVE_TEMPERATURE", "0.8"))


class Assistant(Agent):
    """La personnalité d'Umbra et ses mains."""

    def __init__(self) -> None:
        super().__init__(
            instructions=SYSTEM_PROMPT,
            tools=ALL_TOOLS,
        )


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    logger.info("Connexion établie — room %s", ctx.room.name)

    # Gemini Live : écoute et parle lui-même (pas de STT/TTS séparés)
    try:
        from livekit.plugins import google

        llm = google.realtime.RealtimeModel(
            model=MODEL,
            voice=VOICE,
            temperature=TEMPERATURE,
        )
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "Module Google manquant. Lance : uv add \"livekit-agents[google,images]~=1.8\""
        ) from exc

    session = AgentSession(llm=llm)

    await session.start(
        agent=Assistant(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                # Annulation d'écho + bruit : indispensable pour un usage au micro
                noise_cancellation=noise_cancellation.BVC(),
            ),
            video_input=True,  # « les yeux » : caméra + partage d'écran
        ),
    )

    # Première prise de parole
    await session.generate_reply(
        instructions=(
            "Salue brièvement l'utilisateur en français, d'une phrase, sur ton ton de majordome. "
            "Présente-toi comme Umbra et propose ton aide."
        )
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=os.getenv("LIVEKIT_AGENT_NAME", "umbra"),
        )
    )
