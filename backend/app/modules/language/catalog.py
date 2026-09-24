"""The languages the Language Center teaches, the levels, and the ready-made scenarios.

Mirrored by `src/data/language.ts` (ids, names, flags), kept in step by tests on both sides.
`live` is the code the live voice speaks; the tutor's words come from the model, which speaks all
of these. Scenarios are written once, in English, and played in whatever language the learner
studies: the tutor takes the role and the setting and speaks the target language.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


@dataclass(frozen=True, slots=True)
class Language:
    id: str
    name: str
    #: What speakers call it.
    native: str
    flag: str
    #: BCP-47 code for the live voice.
    live: str


LANGUAGES: tuple[Language, ...] = (
    Language("en", "English", "English", "🇬🇧", "en-US"),
    Language("fr", "French", "Français", "🇫🇷", "fr-FR"),
    Language("es", "Spanish", "Español", "🇪🇸", "es-ES"),
    Language("de", "German", "Deutsch", "🇩🇪", "de-DE"),
    Language("it", "Italian", "Italiano", "🇮🇹", "it-IT"),
    Language("pt", "Portuguese", "Português", "🇧🇷", "pt-BR"),
    Language("ar", "Arabic", "العربية", "🇸🇦", "ar-XA"),
    Language("zh", "Chinese", "中文", "🇨🇳", "cmn-CN"),
    Language("ja", "Japanese", "日本語", "🇯🇵", "ja-JP"),
    Language("ko", "Korean", "한국어", "🇰🇷", "ko-KR"),
    Language("ru", "Russian", "Русский", "🇷🇺", "ru-RU"),
    Language("tr", "Turkish", "Türkçe", "🇹🇷", "tr-TR"),
    Language("nl", "Dutch", "Nederlands", "🇳🇱", "nl-NL"),
    Language("hi", "Hindi", "हिन्दी", "🇮🇳", "hi-IN"),
)

BY_ID = {lang.id: lang for lang in LANGUAGES}


def language(lang_id: str) -> Language:
    return BY_ID.get(lang_id, BY_ID["en"])


class Level(StrEnum):
    BEGINNER = "beginner"
    ELEMENTARY = "elementary"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


#: How the tutor speaks at each level.
LEVEL_STYLE: dict[Level, str] = {
    Level.BEGINNER: (
        "The learner is a complete beginner (A1). Speak slowly, in very short sentences with the most common words. "
        "After each line in the target language, add a short gloss in the learner's own language. Accept answers in "
        "their own language, and show them how to say it."
    ),
    Level.ELEMENTARY: (
        "The learner is elementary (A2). Speak slowly and simply, everyday words, one idea per sentence. Use their own "
        "language only when they are stuck, for a word or two."
    ),
    Level.INTERMEDIATE: (
        "The learner is intermediate (B1-B2). Speak naturally but clearly, at a moderate pace, with everyday idioms. "
        "Stay in the target language; explain a word only if asked."
    ),
    Level.ADVANCED: (
        "The learner is advanced (C1). Speak at a natural pace, as to a native speaker, with idioms and nuance. "
        "Stay in the target language."
    ),
}


@dataclass(frozen=True, slots=True)
class Scenario:
    id: str
    title: str
    #: One of the page's icons (see `src/data/language.ts`).
    icon: str
    #: Who the tutor plays.
    role: str
    #: Where it happens and what the learner wants.
    situation: str
    #: What getting it done looks like.
    goal: str


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("airport", "Arriving at the airport", "plane", "an airport information desk agent",
             "The learner has just landed and needs to get into the city centre.",
             "Find out how to get to the city centre, the price and where to buy a ticket."),
    Scenario("cafe", "Ordering at a café", "coffee", "a friendly barista",
             "A busy café in the morning. The learner wants a drink and something to eat.",
             "Order a drink and a snack, ask the price and pay."),
    Scenario("street-food", "Street food", "food", "a street-food vendor",
             "A lively food stall. The learner has never tried the local specialities.",
             "Ask what is good, order something, and ask how spicy it is."),
    Scenario("market", "Shopping at a market", "bag", "a market stallholder",
             "An open-air market with fruit, vegetables and local products.",
             "Buy three things, ask prices and quantities, and haggle a little."),
    Scenario("directions", "Asking for directions", "map", "a helpful local on the street",
             "The learner is lost and needs to get to a museum.",
             "Get directions, check the distance, and repeat them back."),
    Scenario("hotel", "Hotel check-in", "hotel", "a hotel receptionist",
             "Checking in after a long journey. The room was booked online.",
             "Check in, ask about breakfast and wifi, and request a late check-out."),
    Scenario("friends", "Making new friends", "people", "a friendly person at a language exchange evening",
             "An evening where people meet to practise languages.",
             "Introduce yourself, ask about them, find something in common, and swap contacts."),
    Scenario("family", "Family visit", "home", "the host at a family dinner",
             "The learner is visiting a friend's family for dinner for the first time.",
             "Greet everyone politely, compliment the food, and talk about your family."),
    Scenario("doctor", "At the doctor's", "health", "a doctor at a clinic",
             "The learner feels unwell and has a short appointment.",
             "Describe the symptoms, answer the doctor's questions and understand the advice."),
    Scenario("work", "Small talk at work", "briefcase", "a new colleague by the coffee machine",
             "The learner's first week in a new job abroad.",
             "Introduce yourself, talk about your role, and make plans for lunch."),
)

SCENARIO_BY_ID = {s.id: s for s in SCENARIOS}
