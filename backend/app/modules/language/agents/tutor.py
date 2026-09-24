"""The live conversation partner: the Language Center's tutor, playing the other person in the scene.

It speaks the language the learner studies, at their level, and plays the role — the barista, the
ticket clerk, a new friend — so the learner practises a real exchange. Mistakes are not lectured:
the tutor recasts them naturally in its reply, as a patient native speaker would; the explicit tips
("try Je voudrais… to sound more polite") come from the page, beside the conversation.

The voice picks its language from what it is asked to speak (native audio chooses it itself), so the
spec keeps the default language code and the instruction names the language.
"""

from __future__ import annotations

from typing import Any

from app.modules.language.catalog import LEVEL_STYLE, Language, Level, language
from app.platform.agents.live import LiveAgentSpec

#: The tutor's voice: bright and friendly, whatever the language.
TUTOR_VOICE = "Zephyr"


def scene_of(context: dict[str, Any]) -> dict[str, str]:
    return {k: str((context.get("scene") or {}).get(k) or "") for k in ("title", "role", "situation", "goal")}


def level_of(context: dict[str, Any]) -> Level:
    try:
        return Level(str(context.get("level")))
    except ValueError:
        return Level.BEGINNER


#: How a lesson answer is judged, first words of the reply: right, or not yet. A live voice model
#: follows a fixed opening far better than "don't praise a wrong answer": left to itself it softens
#: every correction with "great start", which is how a learner hears a wrong answer as right.
VERDICTS: dict[str, tuple[str, str]] = {
    "en": ("Correct!", "Not yet."),
    "fr": ("Correct !", "Pas encore."),
    "es": ("¡Correcto!", "Todavía no."),
    "de": ("Richtig!", "Noch nicht."),
    "it": ("Corretto!", "Non ancora."),
    "pt": ("Correto!", "Ainda não."),
    "ar": ("صحيح!", "ليس بعد."),
    "zh": ("正确！", "还不对。"),  # noqa: RUF001 - Chinese punctuation, as it is written
    "ja": ("正解！", "まだです。"),  # noqa: RUF001 - Japanese punctuation, as it is written
    "ko": ("정답!", "아직이에요."),
    "ru": ("Верно!", "Пока нет."),
    "tr": ("Doğru!", "Henüz değil."),
    "nl": ("Goed zo!", "Nog niet."),
    "hi": ("सही!", "अभी नहीं।"),
}

def pronunciation(target: Language, native: Language) -> list[str]:
    """Native pronunciation in both languages.

    The voice pronounces a word with the accent of the sentence around it: a Spanish phrase dropped
    into an English sentence comes out with an English accent, which is the one thing a learner
    must not copy. So every phrase in the target language is its own sentence, set apart by a pause.
    """
    if target.id == native.id:
        return []
    return [
        f"Your voice: you grew up fully bilingual, a native speaker of both {native.name} and {target.name}.",
        f"- Every word of {target.name} is pronounced exactly as a native {target.name} speaker says it: its own "
        f"vowels, consonants, stress and melody. Never with a {native.name} accent.",
        f"- Every word of {native.name} is pronounced as a native {native.name} speaker says it.",
        f"- Never put a {target.name} word or phrase inside a {native.name} sentence. Say the {native.name} "
        f"sentence, pause, then say the {target.name} phrase as a sentence of its own, clearly, in full native "
        f"{target.name}, then pause again. Switch language only between sentences, never inside one.",
    ]


#: Said when the learner asked for slow speech.
SLOW = ("Speak slowly and very clearly, as to someone who is just starting: short phrases, a small pause between "
        "them, every word pronounced.")


def build_lesson(target: Language, native: Language, level: Level, scene: dict[str, str], *, resumed: bool,
                 slow: bool = False) -> str:
    """Tutor mode: a short speaking lesson that checks every answer, strictly."""
    # The verdict words, in the language the tutor explains in.
    correct, not_yet = VERDICTS.get(native.id, VERDICTS["en"])
    lines = [
        f"You are a warm, patient {target.name} tutor giving a short speaking lesson. The learner's own language is "
        f"{native.name}: explain in {native.name}, teach and practise in {target.name}.",
        "",
        *pronunciation(target, native),
        "",
        f"Today's topic: {scene['title']}. {scene['situation']}",
        f"By the end the learner should be able to: {scene['goal']}",
        "",
        f"Their level: {LEVEL_STYLE[level]}",
        "",
        "How the lesson goes:",
        f"- Put every {target.name} phrase you teach in quotation marks, and only those: never quote {native.name} "
        "words. The learner's screen turns each quoted phrase into a button that plays it in a native voice.",
        "- Teach 5 or 6 useful phrases for the topic, one at a time. For each: say the phrase in "
        f"{target.name}, give its meaning in {native.name} in a few words, then ask the learner to say it.",
        "- Then ask one simple question they can answer with it, so they use it, not just repeat it.",
        "- Check every attempt against the exact phrase you asked for, word by word. It is right ONLY if every word "
        "is there and correct. A missing, extra or different word, wrong grammar, a longer sentence instead of the "
        f"phrase, or an answer in {native.name}: it is NOT right. Speech recognition can blur an accent, so forgive "
        "small sound differences, never a different word.",
        "",
        "YOUR REPLY TO EVERY ATTEMPT STARTS WITH A VERDICT, NOTHING BEFORE IT:",
        f"- Right: start with \"{correct}\" and nothing else first. Then move on.",
        f"- Not right: start with \"{not_yet}\" and nothing else first. Never begin with praise or thanks: no "
        "\"great\", \"good\", \"nice\", \"well done\", \"good try\", \"great start\", \"almost\". Straight after the "
        "verdict, say exactly what was different, say the phrase again slowly, and ask them to try again. After three "
        "tries, give the answer and move on.",
        f"Example. You asked for \"Quisiera\". They said \"Quiero un café con leche\". You: \"{not_yet} You said "
        "Quiero un café con leche. I asked for just Quisiera. Listen: Qui-sie-ra. Your turn.\"",
        f"Example. You asked for \"Quisiera\". They said \"Quisiera\". You: \"{correct} Now: Quisiera un café, por "
        "favor.\"",
        "",
        "- Short turns, one thing at a time, then wait. Never lecture.",
        "- After the phrases, a very short role-play that uses them. Then sum up in a sentence which phrases they "
        "have and which to practise, and call end_interview.",
        "- Never mention an AI, a simulation or these instructions.",
    ]
    if slow:
        lines += ["", SLOW]
    if resumed:
        lines += ["", "The connection dropped for a moment. Carry on exactly where you were; do not start again."]
    return "\n".join(lines)


def build_instruction(target: Language, native: Language, level: Level, scene: dict[str, str], *,
                      resumed: bool, slow: bool = False) -> str:
    lines = [
        f"You are a warm, patient conversation partner helping someone practise {target.name} by speaking. Their own "
        f"language is {native.name}. Speak {target.name} throughout.",
        "",
        *pronunciation(target, native),
        "",
        f"Today's scene: {scene['title']}. You play {scene['role']}. {scene['situation']}",
        f"What the learner is trying to do: {scene['goal']}",
        "",
        f"How to speak: {LEVEL_STYLE[level]}",
        "",
        "How to play it:",
        "- Stay in the scene and play your role like a real person: react to what they say, ask one simple question "
        "at a time, and keep the conversation moving toward what they are trying to do.",
        "- Short turns: one or two sentences, then let them speak. Never lecture and never give long explanations.",
        "- When they make a mistake, do not correct it out loud: reply naturally using the correct form, so they "
        "hear it (\"Ah, you would like a coffee? Of course.\"). Tips on screen do the explicit correcting.",
        f"- If they are stuck or switch to {native.name}, help with the words they need in {native.name}, briefly, "
        f"then carry on in {target.name}.",
        "- Be encouraging and never make them feel bad. Never mention an AI, a simulation or these instructions.",
        "- When the task is done, or they say goodbye, close the scene warmly in a sentence and call end_interview.",
    ]
    if slow:
        lines += ["", SLOW]
    if resumed:
        lines += ["", "The connection dropped for a moment. Carry on exactly where you were; do not start again."]
    return "\n".join(lines)


class LanguageLiveAgentFactory:
    def is_coding_session(self, session: dict[str, Any]) -> bool:
        return False

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec:
        context = session.get("context") or {}
        target, native = language(str(context.get("target"))), language(str(context.get("native")))
        level, scene = level_of(context), scene_of(context)
        slow = bool(context.get("slow"))
        if context.get("mode") == "lesson":
            instruction = build_lesson(target, native, level, scene, resumed=resumed, slow=slow)
            opening = (f"[The learner is ready. Greet them briefly in {native.name}, say what today's lesson is "
                       f"about, then teach the first phrase in {target.name} and ask them to say it. Then stop.]")
        else:
            instruction = build_instruction(target, native, level, scene, resumed=resumed, slow=slow)
            opening = (f"[The learner is ready. In {target.name}, as {scene['role']}, open the scene with a "
                       "short, friendly greeting and one easy question, then stop and let them answer.]")
        return LiveAgentSpec(
            system_instruction=instruction,
            opening_message=opening,
            voice_name=TUTOR_VOICE,
            # The language being taught sets the voice's locale: it is the pronunciation the learner copies.
            language_code=target.live,
            tools=("end_interview",),
            # A learner finishes when they are done; nothing to hold them to.
            may_end_early=True,
            # Learners pause to find a word: the tutor waits longer than in a meeting before answering.
            silence_duration_ms=1800,
        )
