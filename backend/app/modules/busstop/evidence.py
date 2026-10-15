"""The studies behind the bus stop's techniques, each checked in Crossref (DOI resolves, authors and year match)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Source:
    #: How it is named out loud and on the page.
    short: str
    title: str
    url: str


SOURCES: dict[str, Source] = {
    "epley2014": Source("Epley & Schroeder, 2014", "Mistakenly seeking solitude",
                        "https://doi.org/10.1037/a0037323"),
    "boothby2018": Source("Boothby et al., 2018",
                          "The liking gap in conversations: Do people like us more than we think?",
                          "https://doi.org/10.1177/0956797618783714"),
    "sandstrom2014weak": Source("Sandstrom & Dunn, 2014",
                                "Social interactions and well-being: The surprising power of weak ties",
                                "https://doi.org/10.1177/0146167214529799"),
    "huang2017": Source("Huang et al., 2017", "It doesn't hurt to ask: Question-asking increases liking",
                        "https://doi.org/10.1037/pspi0000097"),
    "levine2018": Source("Levine & Cohen, 2018",
                         "You can handle the truth: Mispredicting the consequences of honest communication",
                         "https://doi.org/10.1037/xge0000488"),
    "mastroianni2021": Source("Mastroianni et al., 2021", "Do conversations end when people want them to?",
                              "https://doi.org/10.1073/pnas.2011809118"),
    "flynn2008": Source("Flynn & Lake, 2008",
                        "If you need help, just ask: Underestimating compliance with direct requests for help",
                        "https://doi.org/10.1037/0022-3514.95.1.128"),
    "langer1978": Source("Langer, Blank & Chanowitz, 1978",
                         "The mindlessness of ostensibly thoughtful action: The role of 'placebic' information",
                         "https://doi.org/10.1037/0022-3514.36.6.635"),
    "speed2018": Source("Speed, Goldstein & Goldfried, 2018",
                        "Assertiveness training: A forgotten evidence-based treatment",
                        "https://doi.org/10.1111/cpsp.12216"),
    "givi2024": Source("Givi & Kirk, 2024",
                       "Saying no: The negative ramifications from invitation declines are less severe than we think",
                       "https://doi.org/10.1037/pspi0000443"),
    "milgram1986": Source("Milgram et al., 1986", "Response to intrusion into waiting lines",
                          "https://doi.org/10.1037/0022-3514.51.4.683"),
}


@dataclass(frozen=True, slots=True)
class Technique:
    id: str
    name: str
    #: How to do it, with a line the user can borrow.
    how: str
    #: What the studies found, in plain words, naming them.
    evidence: str
    sources: tuple[str, ...]


TECHNIQUES: dict[str, Technique] = {
    t.id: t
    for t in (
        Technique(
            "liking-gap", "They'll enjoy it more than you think",
            "Before you open, remind yourself the other person will probably be glad you did. Say the first line: "
            "'Is it always this late?'",
            "Commuters on buses and trains who were asked to talk to a stranger enjoyed the ride more than they "
            "predicted (Epley & Schroeder, 2014); after a first chat, people underestimate how much the other person "
            "liked them (Boothby et al., 2018).",
            ("epley2014", "boothby2018"),
        ),
        Technique(
            "weak-ties", "Small chats count",
            "Treat a two-minute chat with a stranger as worth having, not as filling time: look up from your phone "
            "and give it your attention.",
            "People felt happier and more like they belonged on days they talked with more acquaintances and "
            "passing contacts, not only close friends (Sandstrom & Dunn, 2014).",
            ("sandstrom2014weak",),
        ),
        Technique(
            "follow-up", "Ask follow-up questions",
            "Pick up on something they just said and ask about it: 'You're a teacher? What age do you teach?'",
            "People who asked more questions, especially follow-up questions, were liked more by their partners "
            "(Huang et al., 2017).",
            ("huang2017",),
        ),
        Technique(
            "honest-slip", "Admit the slip, lightly",
            "Own it early, with a smile, then use the name at once: 'I'm so sorry, your name's gone right out of my "
            "head. Tom! Of course. How's the dog?'",
            "People expected being honest to feel worse and hurt the relationship more than it really did; honest "
            "conversations turned out more pleasant than predicted (Levine & Cohen, 2018).",
            ("levine2018",),
        ),
        Technique(
            "end-well", "End it on purpose",
            "Don't wait for the perfect gap: break in kindly and name the reason: 'I'm so sorry to stop you, that's "
            "my bus!'",
            "Conversations almost never ended when both people wanted them to, usually because neither said so "
            "(Mastroianni et al., 2021).",
            ("mastroianni2021",),
        ),
        Technique(
            "warm-exit", "Leave on a warm note",
            "One line about the chat and one about next time: 'I loved hearing about your garden. Tell me the end "
            "of the story next time!'",
            "After a first conversation, people underestimate how much the other person liked them (Boothby et al., "
            "2018), so a warm goodbye lands better than you think.",
            ("boothby2018",),
        ),
        Technique(
            "just-ask", "Just ask, directly",
            "Get their attention, then say exactly what you need in one sentence: 'Excuse me, which bus goes to the "
            "central station?'",
            "People underestimated by about half how many strangers would say yes to a direct request (Flynn & Lake, "
            "2008).",
            ("flynn2008",),
        ),
        Technique(
            "because", "Give a reason",
            "Add 'because' and the real reason: 'Could you tell me where to get off, because I've just moved here?'",
            "Requests that came with a reason were granted far more often than the same request without one "
            "(Langer, Blank & Chanowitz, 1978).",
            ("langer1978",),
        ),
        Technique(
            "assertive", "Firm and friendly",
            "Say what you need calmly, and when they push, repeat it kindly instead of arguing or giving in: 'I'd "
            "rather not share that, but it was nice chatting.'",
            "Assertiveness training (saying what you want clearly and respectfully) has evidence behind it across "
            "decades of trials (Speed, Goldstein & Goldfried, 2018, a review).",
            ("speed2018",),
        ),
        Technique(
            "decline", "A clear, kind no",
            "Say no in the first sentence, briefly and warmly, without a 'maybe': 'I don't give my number out, but "
            "enjoy your day.'",
            "People who said no to an invitation expected the other person to be far more upset than they really "
            "were (Givi & Kirk, 2024).",
            ("givi2024",),
        ),
        Technique(
            "speak-up", "Speak up yourself, calmly",
            "Say it to them directly, without sarcasm: 'Excuse me, I was next. Would you mind going behind me?'",
            "When researchers cut into real queues in New York, objections came mostly from the person right behind "
            "them; others further back rarely spoke (Milgram et al., 1986). If it's your place, it's up to you.",
            ("milgram1986",),
        ),
    )
}
